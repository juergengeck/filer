# Trie Sync Cold-Cut Plan

Status: approved migration plan for filer.

Decision: cold cut. No legacy mode, no dual write, no fallback read path.

## Scope

This plan covers:

- `one.provider`
- `one.projfs`
- `one.fuse3`
- `one.filer`
- the shared sync and projection layer those adapters depend on

The platform adapters stay thin. The new sync substrate belongs in the shared `../one` workspace, not in the platform-specific bridges.

Repository policy:

- do cleanup and evolution work in `../one`
- use `../vger` only as a reference while understanding target architecture
- leave `../one-experimental` untouched; it remains the base for Flexibel only

## Current State

Canonical-base validation (2026-08-31): Filer dependencies, build orchestration,
and integration tests now target `../one`. The shared packages and local macOS
packages build. `../one/packages/refinio.api` now emits its CLI, exposes the
`refinio-api` executable, and supports `REFINIO_API_HOST`. The API connection
test remains blocked on the owning runtime and Swift provider's authenticated
`/filer/rpc` contract. Complete that runtime integration
in `../one`; `../one-experimental` remains reserved for Flexibel.

The remaining notes below describe the earlier provider-local migration stage;
the current Swift adapter delegates runtime ownership to `refinio.api`.

The repository already has the right outer boundary:

- `one.provider` maps File Provider calls to `IFileSystem`
- `one.projfs` maps ProjFS callbacks to `IFileSystem`
- `one.fuse3` maps FUSE operations to `IFileSystem`

The coupling we need to remove is above that boundary:

- `one.provider/node-runtime/index.ts` now registers `chat.core` recipes, creates
  `ChatTrieManager`, and mounts a provider-local trie-backed `/chats`
  projection
- `one.filer` is the legacy FUSE-facing package and is not part of the macOS
  File Provider runtime
- legacy chat reads still depend on `TopicRoom` and `channelEntryHash` in
  `one.provider/one.models/src/fileSystems/ChatFileSystem.ts`, but the macOS
  provider runtime no longer mounts that class for `/chats`
- persistent filesystem writes still assume "update the channel with the updated root directory" in `one.provider/one.models/src/fileSystems/PersistentFileSystem.ts`
- access control still grants `ChannelInfo` ids in `one.filer/src/AccessRightsManager.ts`
- pairing still creates shared 1:1 channels in `one.provider/packages/connection.core/src/ConnectionManager.extended.ts`

That means the platform bridges are already close to done, but the shared model and projection layer are not.

## Target State

The target shape is:

- immutable domain atoms
- persisted trie nodes
- persisted trie roots
- scoped trie roots for partial sharing
- sync driven by root exchange plus subtree diff
- filesystem projections reading directly from trie state
- sharing driven by root grants, not channel creation

There is no `TopicRoom`, no `ChannelInfo`, no linked-list message surface, and no transport-specific sync history layer.

## Non-Negotiables

- No compatibility path in product code.
- No dual write from channels to tries.
- No runtime feature flag that keeps the old path alive.
- No adapter-specific data model.
- No new filesystem code that reads from channel entries.

We can use short-lived migration scripts and branch-local tooling during development, but the merged runtime must contain only the trie-based path.

## Execution Model

We do this on a branch and merge only when the new path is complete. The cut can be staged in development, but the product cut is atomic.

Recommended branch structure:

1. shared substrate branch in `../one`
2. filer integration branch that consumes that substrate
3. merge only when all three platform adapters run on the new projections

## Workstreams

### 1. Shared Trie Substrate

Build the canonical sync layer in `../one/packages`:

- define immutable trie entry recipes for chat, devices, discovery, and file events
- define persisted trie node and root recipes
- define stable domain root objects for each shareable graph
- define scoped root objects for partial sharing
- define services for insert, query, diff, hydrate, and version traversal

This is where `trie.core`, `MultiTrie`, `diff()`, persisted stores, and root version history live.

Current repository reality:

- `../one/packages/trie.core` already exists and should be evolved in place
- `../one/packages/chat.core` already exists and should be cleaned up in place
- `../one/packages/trie.fs` already exists; evolve it there rather than copying it into filer

Exit criteria:

- a topic or graph can be created, updated, queried, and diffed without `ChannelManager`
- all sharing boundaries are expressible as root ids
- all history is recoverable from root and node versions

### 2. Filesystem Projection Rewrite

Replace channel-backed filesystem readers with trie-backed readers.

Primary replace targets:

- `one.provider/one.models/src/fileSystems/ChatFileSystem.ts`
- `one.provider/one.models/src/fileSystems/PersistentFileSystem.ts`
- any projection that still renders channel entries, topic rooms, or linked-list semantics

Required outcomes:

- topic directories are derived from trie views, not topic rooms
- message files are derived from immutable trie entries
- attachment listings are derived from trie-indexed content references
- persistent filesystem root updates publish new trie root versions

Exit criteria:

- no projection code calls `enterTopicRoom()`
- no projection code reads `channelEntryHash`
- no projection code talks about "updating the channel"

### 3. Sharing and Access Rewrite

Replace channel-based sharing and post-pairing channel creation with root grants.

Primary replace targets:

- `one.filer/src/AccessRightsManager.ts`
- `one.provider/packages/connection.core/src/ConnectionManager.extended.ts`
- any connection or sharing helper that computes sync state from channel history

Required outcomes:

- pairing yields shareable root ids or scoped root ids
- access control grants root objects, not `ChannelInfo` ids
- instance sync status is computed from root versions and trie traversal state

Exit criteria:

- no code creates shared 1:1 channels after pairing
- no code grants access to `ChannelInfo`
- no code uses channel sync history as the system of record

### 4. Composition Root Cutover

After the shared substrate and projections exist, replace the runtime boot paths.

Primary cutover targets:

- [x] `one.provider/node-runtime/index.ts`
- [ ] shared non-macOS adapter composition roots, when those platforms are in scope

Required outcomes:

- startup initializes trie-backed services instead of `ChannelManager` and `TopicModel`
- mounted filesystems come from trie-backed projections
- browser-facing and provider-facing views expose the same data model

Exit criteria:

- no filer startup path instantiates `ChannelManager`
- no filer startup path instantiates `TopicModel`
- the mounted roots are served entirely by trie-backed filesystems

### 5. Platform Adapter Validation

Keep the adapters thin and validate them against the new shared projections.

Targets:

- `one.provider`
- `one.projfs`
- `one.fuse3`

Required outcomes:

- no adapter contains trie business logic
- all adapter tests pass with the trie-backed `IFileSystem`
- Finder, Explorer, and Linux file managers see equivalent structures

Exit criteria:

- `one.provider` passes IPC and connection tests
- `one.projfs` passes its integration tests
- `one.fuse3` passes its integration tests

### 6. Legacy Deletion

Delete the old model once the new stack is green.

Delete or rewrite references to:

- `ChannelManager`
- `TopicModel`
- `TopicRoom`
- `ChannelInfo`
- linked-list entry assumptions in sync or projection code
- tests that exist only to validate the old channel behavior

The delete step is part of the cut, not a later cleanup.

## Suggested Order

1. Finish the shared trie substrate outside the platform adapters.
2. Rewrite chat and persistent filesystem projections against the trie substrate.
3. Rewrite sharing and pairing to issue root grants.
4. Cut over `one.provider` first because it has the clearest composition root and the browser-facing surface.
5. Cut over `one.projfs` and `one.fuse3` to the same trie-backed `IFileSystem`.
6. Delete legacy channel code before merge.

## one.provider First-Cut Checklist

`one.provider` is the best first integration target because it already centralizes model boot, filesystem composition, and browser-facing APIs.

Concrete actions:

- [x] create trie-backed chat read services in `one.provider/node-runtime/index.ts`
- [x] mount trie-backed `/chats` via `one.provider/node-runtime/chat-trie-filesystem.ts`
- [ ] move the trie-backed projection into the shared layer used by all adapters
- replace persistent root update behavior in `one.provider/one.models/src/fileSystems/PersistentFileSystem.ts`
- update any REST or browser projection that reports sync state from old channel concepts

Gate:

- `npm run build`
- `npm run test:ipc`
- `npm run test:connection`
- `swift build`

## Cross-Platform Acceptance

The migration is done when all of the following are true:

- the same logical graph can be mounted through File Provider, ProjFS, and FUSE3
- partial sharing is implemented by scoped trie roots only
- pairing and sharing exchange roots, not channels
- sync uses trie diff and subtree hydration
- no product code in filer depends on channel-era objects

## Explicitly Out of Scope

- preserving channel-era runtime behavior behind a flag
- backporting the old model into new code
- adapter-specific branching for macOS, Windows, or Linux data semantics

## Immediate Next Step

Start in `../one/packages` and do not touch the adapters first.

The first implementation milestone is:

1. create trie-backed domain services and recipes
2. make chat projection read from them
3. make pairing share roots instead of creating shared channels

Only after that should `one.provider/node-runtime/index.ts` and `one.filer/src/Replicant.ts` be cut over.
