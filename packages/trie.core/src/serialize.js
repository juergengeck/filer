import { ContentAddressedTrie } from './trie.js';
/**
 * Serialize a trie into a JSON-safe snapshot.
 * Walks all reachable nodes from the root.
 */
export function serializeTrie(trie) {
    const root = trie.getRoot();
    if (root === null)
        return { root: null, nodes: [] };
    const nodes = [];
    const visited = new Set();
    function walk(hash) {
        if (visited.has(hash))
            return;
        visited.add(hash);
        const node = trie.getNode(hash);
        if (!node)
            throw new Error(`Node not found: ${hash}`);
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
    return { root, nodes };
}
/**
 * Deserialize a snapshot back into a ContentAddressedTrie.
 * Populates the store directly, then sets the root.
 */
export async function deserializeTrie(snapshot, config) {
    const trie = new ContentAddressedTrie(config);
    if (snapshot.root === null)
        return trie;
    // Rebuild by re-inserting all entries.
    // The trie is deterministic — inserting the same entries produces the same root.
    const allEntries = collectEntriesFromSnapshot(snapshot);
    for (const entry of allEntries) {
        await trie.insert(entry);
    }
    return trie;
}
function collectEntriesFromSnapshot(snapshot) {
    const entries = [];
    for (const node of snapshot.nodes) {
        entries.push(...node.entries);
    }
    return entries;
}
