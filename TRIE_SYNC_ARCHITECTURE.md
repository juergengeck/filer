# Trie Sync Architecture

Status: proposed common architecture for `one.provider`, `one.fuse3`, `one.projfs`, and browser-facing sync.

## Decision

Filer should use `trie.core` as the canonical sync and indexing substrate across all platforms.

We should not build new features on top of:

- `ChannelInfo`
- `ChannelRegistry`
- `LinkedListEntry`
- `TopicRoom`
- bespoke per-feature tries like `GlueContentTrie`
- deprecated `TimeTrie`

Instead, filer should treat content as immutable atoms that are indexed into one or more persisted content-addressed tries using `trie.core`.

The access boundary is a trie root, not a channel head.

## Why

The old channel model mixes several concerns into one structure:

- append order
- access control
- query shape
- sync traversal
- history

That makes the system hard to share partially and hard to reuse across platforms.

`trie.core` already gives us a cleaner split:

- `ContentAddressedTrie` stores the DAG
- `MultiTrie` updates multiple query/sync views atomically
- `diff()` computes missing entries by comparing Merkle roots
- `createOneCoreTrieStore()` persists nodes and roots into ONE objects
- `createPersistedTrieNodeRecipe()` and `createPersistedTrieRootRecipe()` define the ONE recipe layer
- `loadTrieSubtree()` hydrates a subtree directly from persisted state

This is a better fit for:

- browser-to-browser sync
- partial sharing
- time-based queries
- subject/tag/device views
- filesystem projections that should not care about transport details

## Canonical Building Blocks

These are the standard primitives we should use:

- `../vger/packages/trie.core/src/trie.ts`
- `../vger/packages/trie.core/src/multi-trie.ts`
- `../vger/packages/trie.core/src/diff.ts`
- `../vger/packages/trie.core/src/persisted-store.ts`

These are the existing examples to follow:

- `../vger/packages/chat.core/src/recipes/ChatTrieRecipes.ts`
- `../vger/packages/chat.core/src/services/ChatTrieManager.ts`
- `../vger/packages/chat.core/src/services/ChatTrieOneCoreStore.ts`
- `../vger/packages/one.models/src/recipes/ChatRecipes.ts`
- `../vger/packages/connection.core/src/plans/ConnectionPlan.ts`

## Core Model

### 1. Immutable content atoms

The trie should point at durable leaf atoms, not at channel entries.

Examples:

- `ChatTrieEntry`
- a future `DeviceTrieEntry`
- a future `DiscoveryTrieEntry`
- a future `FileEventTrieEntry`

Leaf atoms should contain exactly the metadata needed for direct rendering or projection:

- stable subject identifier such as `topicId`, `deviceId`, or `pathId`
- content reference such as `messageHash`, `objectHash`, or `descriptorHash`
- author or owner
- timestamp
- optional indexing metadata needed by higher layers

Leaf atoms are immutable. If content changes, we create a new atom and index it into the trie.

### 2. Persisted trie nodes

Trie nodes are versioned ONE objects created through `createPersistedTrieNodeRecipe()`.

They already have the correct shape:

- `id`: deterministic node identity
- `children`: content-addressed child edges
- `childIds`: id references to child nodes
- `entries`: object references to leaf atoms

This gives us:

- Merkle-style subtree identity
- traversal through ONE references
- direct subtree addressing

### 3. Persisted trie roots

Trie roots are versioned ONE objects created through `createPersistedTrieRootRecipe()`.

They already support:

- stable root identity via `id`
- current subtree hash via `root`
- current subtree node id via `rootId`

This is the important architectural boundary:

- a root object is what we grant access to
- a root object is what we version over time
- a root object is what we share across devices or peers

## Required Pattern

Every syncable domain should follow this pattern:

1. Define immutable leaf atoms.
2. Define one or more trie views using `trie.core`.
3. Persist them through `createOneCoreTrieStore()`.
4. Expose stable root ids from the owning domain object.
5. Share and sync by sharing root ids or scoped share-root ids.

For chat-like data, the standard layout is:

- sync trie: hash-prefix view for diff/sync
- time trie: ordered query view
- subject trie: semantic or subject-range view

Those three tries should be updated together using `MultiTrie`.

## Sharing Model

### Full share

To share a whole topic, device graph, or file graph:

- create or load the stable root objects
- grant access to those root ids
- let sync traverse from the roots into the DAG

This is already the pattern used in `../vger/packages/connection.core/src/plans/ConnectionPlan.ts`.

### Partial share

Partial sharing should not introduce a new channel abstraction.

Instead, partial sharing should create a scoped root object that points at an interior node.

Recommended shape:

```ts
type ScopedTrieRoot = {
    $type$: 'ScopedTrieRoot';
    id: string;
    trie: 'sync' | 'time' | 'subject' | 'devices';
    owner: string;
    subjectId: string;
    root?: string | null;
    rootId?: string | null;
};
```

Notes:

- `id` should be a stable share identifier, not the underlying topic id.
- `root` and `rootId` may point at any subtree, not only the full root.
- granting access to the scoped root is the entire capability.

This keeps sharing at the DAG layer where it belongs.

## Sync Model

Sync should work like this:

1. Exchange or resolve the root ids that define the share boundary.
2. Load local and remote root hashes.
3. Use `diff(local, remote)` to compute missing leaf atoms.
4. Load only the required subtrees with `loadTrieSubtree()` when needed.
5. Transfer the missing atoms and any required node/root versions.
6. Update local root versions to reflect the new DAG state.

This is much simpler than replaying or merging channel heads because:

- identical subtrees are skipped by hash
- subtree boundaries are explicit
- partial sync is natural
- sync state is the DAG itself

## Versioning Model

If we want "all versions", the version history should live in the root and node objects, not in a parallel channel log.

Rules:

- roots are versioned
- nodes are versioned
- leaf atoms are immutable
- edits create new atoms and new root versions
- deletes or hides are represented by new atoms or policy objects, not by mutating old atoms

That means history becomes:

- "what was the root at time T?"
- "what nodes and atoms were reachable from that root?"

This maps cleanly onto ONE's existing versioned object APIs.

## Read Model

Readers should read directly from trie-backed state.

That means:

- UI and filesystem projections should query trie-backed managers
- local caches and dimensions may exist, but only as derived accelerators
- derived indices must rebuild from trie state

They must not be the source of truth.

## Cross-Platform Rule

The sync architecture must live above the platform bridges.

This means:

- `one.provider`, `one.fuse3`, and `one.projfs` should all consume the same trie-backed model layer
- platform adapters should project shared state into native filesystem APIs
- platform adapters must not invent their own sync model
- browser consumers should use the same roots and leaf atoms

Platform differences belong in projection and transport, not in sync semantics.

## Migration Rules

No-legacy target:

1. New features must use `trie.core`.
2. New sync surfaces must be rooted at trie roots.
3. New read paths must read from trie-backed managers.
4. New sharing flows must grant roots or scoped roots.

Legacy removal target:

1. Remove `Topic.channel` and `channelCertificate` dependencies.
2. Remove `ChannelInfo`, `ChannelRegistry`, and `LinkedListEntry` from active sync design.
3. Remove channel-based bootstrap paths once trie-backed reads and writes are complete.
4. Keep any temporary compatibility code isolated and marked for deletion.

## Explicitly Rejected

We should explicitly avoid:

- creating another `ChannelManager`-style abstraction
- encoding access control in append-log structure
- building new one-off tries when `trie.core` already covers the need
- using deprecated `TimeTrie` for new work
- making platform bridges responsible for sync semantics

## Practical Outcome For Filer

For filer specifically, this means:

- discovered devices can be represented as trie-backed atoms
- file events can be represented as trie-backed atoms
- browser sync can share roots directly
- filesystem implementations on macOS, Linux, and Windows can all mount the same logical state

The common design is:

- atoms
- tries
- roots
- grants
- projection

Not:

- channels
- heads
- linked lists
- per-platform sync logic

