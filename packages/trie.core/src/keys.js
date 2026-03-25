/**
 * Predefined key derivation functions for ContentAddressedTrie.
 *
 * hashPrefixKeyFn — splits entry hash into fixed-size chunks (existing behaviour).
 * timePathKeyFn — derives path from context.timestamp for time-indexed queries.
 * timePathLeafKeys — enumerates all leaf-level paths in a date range.
 */
// ---------------------------------------------------------------------------
// Hash-prefix key function (default — extracts existing keyChunks logic)
// ---------------------------------------------------------------------------
/**
 * Split the entry hash into fixed-size chunks for trie navigation.
 * E.g. chunkSize=2, maxDepth=4: 'a3f8b201...' → ['a3','f8','b2','01']
 */
export function hashPrefixKeyFn(chunkSize, maxDepth) {
    return (entryHash) => {
        const chunks = [];
        const key = entryHash;
        for (let i = 0; i < key.length && chunks.length < maxDepth; i += chunkSize) {
            chunks.push(key.slice(i, i + chunkSize));
        }
        return chunks;
    };
}
// ---------------------------------------------------------------------------
// Time-path key function
// ---------------------------------------------------------------------------
function pad2(n) {
    return String(n).padStart(2, '0');
}
const DEPTH_LEVELS = {
    day: 3,
    hour: 4,
    minute: 5
};
function dateToSegments(date, trieId) {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const h = pad2(date.getHours());
    const min = pad2(date.getMinutes());
    return [
        `${trieId}:${y}`,
        `${trieId}:${y}-${m}`,
        `${trieId}:${y}-${m}-${d}`,
        `${trieId}:${y}-${m}-${d}T${h}`,
        `${trieId}:${y}-${m}-${d}T${h}:${min}`
    ];
}
/**
 * Derive trie path from context.timestamp (Date).
 * Path segments are prefixed with trieId for instance isolation.
 *
 * Throws if context.timestamp is missing — no fallbacks.
 */
export function timePathKeyFn(depth, trieId) {
    const levels = DEPTH_LEVELS[depth];
    return (_entryHash, context) => {
        const timestamp = context.timestamp;
        if (!(timestamp instanceof Date)) {
            throw new Error(`timePathKeyFn requires context.timestamp (Date), got: ${typeof timestamp}`);
        }
        return dateToSegments(timestamp, trieId).slice(0, levels);
    };
}
// ---------------------------------------------------------------------------
// Leaf key enumeration for range queries
// ---------------------------------------------------------------------------
const MAX_LEAF_KEYS = 10_000;
/**
 * Enumerate all full leaf-level chunk arrays in a date range.
 * Each result is a complete path from root to leaf.
 * Used by callers to drive collectEntriesAtPath.
 */
export function timePathLeafKeys(from, to, trieId, depth) {
    const levels = DEPTH_LEVELS[depth];
    const results = [];
    if (depth === 'day') {
        const current = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
        while (current <= end && results.length < MAX_LEAF_KEYS) {
            results.push(dateToSegments(current, trieId).slice(0, levels));
            current.setDate(current.getDate() + 1);
        }
    }
    else if (depth === 'hour') {
        const current = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), to.getHours());
        while (current <= end && results.length < MAX_LEAF_KEYS) {
            results.push(dateToSegments(current, trieId).slice(0, levels));
            current.setTime(current.getTime() + 60 * 60 * 1000);
        }
    }
    else {
        const current = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), to.getHours(), to.getMinutes());
        while (current <= end && results.length < MAX_LEAF_KEYS) {
            results.push(dateToSegments(current, trieId).slice(0, levels));
            current.setTime(current.getTime() + 60 * 1000);
        }
    }
    return results;
}
