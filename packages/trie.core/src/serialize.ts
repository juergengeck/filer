import type {Hash, TrieConfig, TrieNodeData, TrieReader} from './types.js';
import {ContentAddressedTrie} from './trie.js';

/**
 * Serialized snapshot of a trie — JSON-safe, preserves all structure.
 */
export interface TrieSnapshot {
    root: string | null;
    nodes: SnapshotNode[];
}

interface SnapshotNode {
    hash: string;
    children: [string, string][];
    entries: string[];
}

/**
 * Serialize a trie into a JSON-safe snapshot.
 * Walks all reachable nodes from the root.
 */
export function serializeTrie(trie: TrieReader): TrieSnapshot {
    const root = trie.getRoot();
    if (root === null) return {root: null, nodes: []};

    const nodes: SnapshotNode[] = [];
    const visited = new Set<string>();

    function walk(hash: Hash): void {
        if (visited.has(hash)) return;
        visited.add(hash);

        const node = trie.getNode(hash);
        if (!node) throw new Error(`Node not found: ${hash}`);

        nodes.push({
            hash,
            children: [...node.children.entries()],
            entries: [...node.entries]
        });

        for (const childHash of node.children.values()) {
            walk(childHash);
        }
    }

    walk(root);
    return {root, nodes};
}

/**
 * Deserialize a snapshot back into a ContentAddressedTrie.
 * Populates the store directly, then sets the root.
 */
export async function deserializeTrie(snapshot: TrieSnapshot, config: TrieConfig): Promise<ContentAddressedTrie> {
    const trie = new ContentAddressedTrie(config);

    if (snapshot.root === null) return trie;

    // Rebuild by re-inserting all entries.
    // The trie is deterministic — inserting the same entries produces the same root.
    const allEntries = collectEntriesFromSnapshot(snapshot);
    for (const entry of allEntries) {
        await trie.insert(entry as Hash);
    }

    return trie;
}

function collectEntriesFromSnapshot(snapshot: TrieSnapshot): string[] {
    const entries: string[] = [];
    for (const node of snapshot.nodes) {
        entries.push(...node.entries);
    }
    return entries;
}
