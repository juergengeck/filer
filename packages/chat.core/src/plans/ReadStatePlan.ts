/**
 * ReadStatePlan — ChannelReadState tracking + seenBy resolution.
 *
 * Platform-agnostic business logic for:
 *  - Computing a snapshot hash from a set of P2P message hashes
 *  - Storing/loading ChannelReadState objects (one per person per topic)
 *  - Resolving which peers have "seen" a given message (timestamp comparison)
 *  - Detecting CRDT merges (messages that arrived after a snapshot changed)
 *
 * Consumers (glue.browser, vger.browser, vger.cube) wrap this in a thin
 * UI hook or IPC handler.
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { Topic, ChannelReadState } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getAllIdObjectEntries } from '@refinio/one.core/lib/reverse-map-query.js';
import { createCryptoHash } from '@refinio/one.core/lib/system/crypto-helpers.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal message descriptor — only the fields ReadStatePlan needs. */
export interface ReadStateMessage {
    /** SHA256 hash of the message (dataHash from TopicRoom). Only valid for P2P messages. */
    hash: string;
    /** Epoch-ms timestamp of the message. */
    timestamp: number;
}

/** A peer's last-known read position. */
export interface PeerReadState {
    personId: SHA256IdHash<Person>;
    personName: string;
    /** Snapshot hash at the time of the peer's last read. */
    snapshot: SHA256Hash;
    /** Epoch-ms when the peer last opened the channel. */
    timestamp: number;
}

/** Entry returned by getSeenBy — who saw a message. */
export interface SeenByEntry {
    name: string;
    personId: string;
}

// ---------------------------------------------------------------------------
// ReadStatePlan
// ---------------------------------------------------------------------------

export class ReadStatePlan {
    private peerStates = new Map<string, PeerReadState>();

    constructor(
        private topicIdHash: SHA256IdHash<Topic>,
        private myPersonId: SHA256IdHash<Person>,
        private resolvePersonName: (id: SHA256IdHash<Person>) => string,
    ) {}

    // ---- Hydration --------------------------------------------------------

    /**
     * Load all ChannelReadState objects for this topic from ONE.core.
     * Call once on mount / when topicIdHash changes.
     * Returns the number of peer states loaded.
     */
    async hydrate(): Promise<number> {
        try {
            const idHashes = await getAllIdObjectEntries(
                this.topicIdHash,
                'ChannelReadState',
            );

            const results = await Promise.all(
                idHashes.map(async (idHash) => {
                    try {
                        return await getObjectByIdHash(idHash);
                    } catch {
                        return null;
                    }
                }),
            );

            let loaded = 0;
            for (const result of results) {
                if (!result) continue;
                const obj = result.obj as ChannelReadState;
                // Skip own read state — we only care about peers
                if (obj.person === this.myPersonId) continue;

                const key = obj.person as string;
                const existing = this.peerStates.get(key);
                // Keep the most recent state
                if (existing && existing.timestamp >= obj.timestamp) continue;

                this.peerStates.set(key, {
                    personId: obj.person,
                    personName: this.resolvePersonName(obj.person),
                    snapshot: obj.snapshot,
                    timestamp: obj.timestamp,
                });
                loaded++;
            }
            return loaded;
        } catch (err) {
            console.warn('[ReadStatePlan] hydration skipped:', err);
            return 0;
        }
    }

    // ---- Snapshot computation ---------------------------------------------

    /**
     * Compute a SHA256 snapshot hash from a sorted list of P2P message hashes.
     * Deterministic: same set of messages always produces the same hash.
     */
    async computeSnapshot(p2pMessages: ReadStateMessage[]): Promise<SHA256Hash> {
        const hashes = p2pMessages
            .map(m => m.hash)
            .sort();
        const payload = hashes.join(':');
        return createCryptoHash(payload);
    }

    // ---- Mark as read -----------------------------------------------------

    /**
     * Store a ChannelReadState for the current user.
     * Also returns detected CRDT merges (message hashes that appeared after
     * the snapshot changed vs. the previous read).
     */
    async markAsRead(
        p2pMessages: ReadStateMessage[],
    ): Promise<{ snapshot: SHA256Hash; merges: string[] }> {
        const snapshot = await this.computeSnapshot(p2pMessages);
        const now = Date.now();

        // Detect merges: messages with timestamp < our last read that
        // weren't in the previous snapshot (i.e., arrived via CRDT merge).
        const myKey = this.myPersonId as string;
        const prev = this.peerStates.get(myKey);
        let merges: string[] = [];
        if (prev && prev.snapshot !== snapshot) {
            // Snapshot changed — any P2P message with timestamp < prev.timestamp
            // that we haven't seen before is a CRDT merge.
            merges = p2pMessages
                .filter(m => m.timestamp < prev.timestamp)
                .map(m => m.hash);
        }

        // Store in ONE.core
        const readState: ChannelReadState = {
            $type$: 'ChannelReadState',
            topic: this.topicIdHash,
            person: this.myPersonId,
            snapshot,
            timestamp: now,
            ...(merges.length > 0 ? { pendingMerges: merges as SHA256Hash[] } : {}),
        };

        try {
            await storeVersionedObject(readState);
        } catch (err) {
            console.error('[ReadStatePlan] Failed to store ChannelReadState:', err);
        }

        // Update our own entry so getSeenBy can use it
        this.peerStates.set(myKey, {
            personId: this.myPersonId,
            personName: this.resolvePersonName(this.myPersonId),
            snapshot,
            timestamp: now,
        });

        return { snapshot, merges };
    }

    // ---- SeenBy resolution ------------------------------------------------

    /**
     * Return the list of peers who have "seen" a message.
     * A message is considered seen by peer X if
     *   message.timestamp <= peerReadState.timestamp
     *
     * Excludes the current user from the list.
     * O(P) where P = peer count (typically < 50).
     */
    getSeenBy(messageTimestamp: number): SeenByEntry[] {
        const result: SeenByEntry[] = [];
        for (const [key, state] of this.peerStates) {
            if (key === (this.myPersonId as string)) continue;
            if (messageTimestamp <= state.timestamp) {
                result.push({
                    name: state.personName,
                    personId: state.personId as string,
                });
            }
        }
        return result;
    }

    // ---- Accessors --------------------------------------------------------

    getPeerStates(): PeerReadState[] {
        return Array.from(this.peerStates.values()).filter(
            s => s.personId !== this.myPersonId,
        );
    }

    /** Ingest a peer's read state (e.g. received via CHUM sync). */
    updatePeerState(state: PeerReadState): void {
        const key = state.personId as string;
        const existing = this.peerStates.get(key);
        if (existing && existing.timestamp >= state.timestamp) return;
        this.peerStates.set(key, state);
    }
}
