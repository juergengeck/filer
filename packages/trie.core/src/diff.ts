import type {Hash, TrieReader, DiffResult} from './types.js';

/**
 * Compute entries present in remote but missing from local.
 * Skips identical subtrees via hash comparison (Merkle optimization).
 * Complexity: O(changed nodes), not O(total nodes).
 */
export function diff(local: TrieReader, remote: TrieReader): DiffResult {
    const localRoot = local.getRoot();
    const remoteRoot = remote.getRoot();

    if (remoteRoot === null) return {missing: []};
    if (localRoot === remoteRoot) return {missing: []};
    if (localRoot === null) return {missing: collectAll(remote, remoteRoot)};

    return {missing: diffNodes(local, remote, localRoot, remoteRoot)};
}

function diffNodes(local: TrieReader, remote: TrieReader, localHash: Hash, remoteHash: Hash): Hash[] {
    if (localHash === remoteHash) return []; // Merkle skip

    const localNode = local.getNode(localHash);
    const remoteNode = remote.getNode(remoteHash);

    if (!remoteNode) return [];
    if (!localNode) return collectAll(remote, remoteHash);

    const missing: Hash[] = [];

    // Entries present in remote but not in local
    for (const entry of remoteNode.entries) {
        if (!localNode.entries.has(entry)) {
            missing.push(entry);
        }
    }

    // Walk children
    for (const [key, remoteChildHash] of remoteNode.children) {
        const localChildHash = localNode.children.get(key);
        if (!localChildHash) {
            // Entire subtree is new
            missing.push(...collectAll(remote, remoteChildHash));
        } else if (localChildHash !== remoteChildHash) {
            // Subtree differs — recurse
            missing.push(...diffNodes(local, remote, localChildHash, remoteChildHash));
        }
        // else: identical hash — skip entire subtree
    }

    return missing;
}

function collectAll(reader: TrieReader, nodeHash: Hash): Hash[] {
    const node = reader.getNode(nodeHash);
    if (!node) return [];

    const entries: Hash[] = [...node.entries];
    for (const childHash of node.children.values()) {
        entries.push(...collectAll(reader, childHash));
    }
    return entries;
}
