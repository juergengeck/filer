export interface InputHistoryEntry {
    text: string;
    timestamp: number;
}

/**
 * Platform-agnostic service for per-topic input history.
 * Storage is injected via constructor to support ONE.core or other backends.
 */
export class InputHistoryService {
    private static readonly MAX_ENTRIES = 100;

    /**
     * Storage adapter for persisting history.
     * Implementations provided by platform layer (browser/electron).
     */
    constructor(
        private readonly storage: InputHistoryStorage
    ) {}

    /**
     * Get history entries for a topic, most recent first.
     */
    async getHistory(topicId: string): Promise<InputHistoryEntry[]> {
        const data = await this.storage.load(topicId);
        if (!data) {
            return [];
        }
        return data;
    }

    /**
     * Add a new entry to the topic's history.
     * Deduplicates consecutive identical entries.
     * Prunes to MAX_ENTRIES.
     */
    async addEntry(topicId: string, text: string): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }

        const entries = await this.getHistory(topicId);

        // Skip if same as most recent entry
        if (entries.length > 0 && entries[0].text === trimmed) {
            return;
        }

        const newEntry: InputHistoryEntry = {
            text: trimmed,
            timestamp: Date.now()
        };

        // Add to front, prune old entries
        const updated = [newEntry, ...entries].slice(
            0,
            InputHistoryService.MAX_ENTRIES
        );

        await this.storage.save(topicId, updated);
    }
}

/**
 * Storage adapter interface.
 * Implemented by platform layer using ONE.core versioned objects.
 */
export interface InputHistoryStorage {
    load(topicId: string): Promise<InputHistoryEntry[] | undefined>;
    save(topicId: string, entries: InputHistoryEntry[]): Promise<void>;
}
