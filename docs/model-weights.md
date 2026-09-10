# Model weights through Filer

Filer exposes shared model revisions at `/ONE/System/models/<encoded-model>/<revision>-<manifest-hash>/`.
Each directory contains the original relative filenames, including tokenizer and configuration
files. Revision files are read-only. Model names are encoded as one directory component;
the manifest hash distinguishes different packages of the same upstream revision.

## Data and access

The permanent owner is `../one/packages/llm.one`. `ModelWeightsPlan` publishes snapshots,
maintains the local library and its atomic filesystem snapshot, verifies content,
pins revisions, and grants sharing access.
`refinio.api` supplies its filesystem projection and local management operations. All new
shared implementation lives in the canonical `../one` workspace.

- `ModelWeightRevision` references portable file metadata and the identity of a bulk content root.
- `ModelWeightFile` records a relative filename, byte length, and SHA-256 of the complete file.
- `ModelWeightContent` versions reference ordered `ModelWeightChunks` objects, which reference
  4 MiB BLOBs. Its deterministic identity binds the ordered chunk manifests, including their file metadata and BLOB hashes.
- `ModelWeightLibrary` persists this instance's accepted revisions and completed pins.

Sharing grants the exact immutable revision root and the independently scheduled bulk root's
`IdAccess`. There are no individual chunk grants. Background CHUM imports metadata and content
identities; its import filter excludes bulk versions. An explicit pin resolves the selected
current bulk root through the authenticated CHUM lane, expands its declared access graph,
downloads missing chunks, and checks chunk lengths, chunk hashes, and whole-file hashes.
Only then does the owning plan commit the content closure and completed pin.

Completed chunks are resume state. A restarted pin reuses and rechecks them. Corruption fails
visibly; it is never silently discarded or replaced. A pinned recipient can share the same
revision onward, including when the original publisher is offline.

## First implementation scope

Publication copies the selected snapshot into ONE's chunk store. It does not modify the HF
cache or create links into mutable cache files. `allowedRoot` is an explicit symlink boundary;
for a Hugging Face snapshot, use its enclosing repository cache so snapshot links can resolve
to the repository's `blobs` directory. Shared objects contain no local source paths.

Browsing and stat calls read metadata only. A pin downloads the **complete revision**. Reading
an unpinned revision downloads only the verified chunks intersecting the requested range. Native hydration
writes bounded 1 MiB RPC reads directly to a temporary file, removes incomplete output after
failure/cancellation, and returns the finished file to File Provider. Model items request lazy
download policy, use the complete file checksum as their content version, and use
the persistent item version as their metadata version. The operating system
owns the replicated on-disk copies ([Apple's replicated provider contract](https://developer.apple.com/documentation/fileprovider/replicated-file-provider-extension)).

This first slice has no eviction policy or durable partial-revision offline state. A complete pin
provides offline access; unpinned reads require a connected peer for their chunk manifest. Cancelling
native hydration stops further reads and removes the incomplete file; the current chunk request
may finish and its verified bytes remain available for reuse.
It uses the runtime's existing authenticated CHUM connections; it adds no HTTP weight endpoint.
The model library now commits persistent filesystem snapshots and emits native
change notifications after commit; see [the shared change-feed contract](filer-change-feed.md). The installed signed application must be rebuilt with the updated runtime to use
the new projection; a separate test instance does not change an existing File Provider domain.

## Local management

The canonical private stdio runtime exposes these explicitly authorized operations:

| Operation | Request |
| --- | --- |
| `modelWeights:list` | `{}` |
| `modelWeights:publish` | `directory`, optional `allowedRoot`, `model`, `revision`, `format`, `source`, optional `quantization` |
| `modelWeights:pin` | `hash` (exact revision manifest) |
| `modelWeights:share` | `hash`, `person` (recipient's canonical Person ID hash) |
| `modelWeights:waitForRevision` | `hash`, optional bounded `timeoutMs` |
| `pairing:createInvitation` | `{}` |
| `pairing:connectUsingInvitation` | `invitation` |
| `modelWeights:waitForPeer` | `person`, optional bounded `timeoutMs` |

`scripts/model-weights-host.mjs RUNTIME_DIRECTORY CONFIGURATION_PATH` supplies the protected
configuration to the canonical child runtime through its inherited pipe. The configuration
file must have mode `0600` and contain `directory`, `email`, `secret`, `name`, `commServerUrl`,
and `inviteUrlPrefix`. Do not check it into source control.

`scripts/model-weights-session.mjs` provides a private local/SSH management client. A session
description contains `node`, `runtime`, `config`, and `hostScript`, plus `ssh` for a remote
session. These are paths and connection settings, not credentials. Runtime bundles must be
copied with symlinks preserved; the package closure contains deliberate dependency cycles.

Use the transfer driver with two explicit session descriptions:

```sh
node scripts/model-weights-transfer.mjs \
  --source /path/source-session.json --target /path/target-session.json \
  --publish docs/spark-qwen27b-snapshot.json --evidence /path/evidence --pin
```

Both runtimes must reach their configured communication server. The driver publishes or selects
the matching immutable revision, pairs the instances, shares metadata, verifies an on-demand
range against the source, optionally pins all content, and records exact file hashes in `result.json`. Session closure stops the temporary
runtime processes; their stores and completed pins remain durable.

## Selected Spark snapshot

`docs/spark-qwen27b-snapshot.json` selects the installed
`RadixArk/Qwen3.8-27B-NVFP4-BF16-LMHead` revision
`009632fef96dd349150baa780c984e62e70e91fe` used by Spark's current Qwen 27B configuration.
The snapshot contains 22 files totaling 23,772,921,363 bytes. It does not include the separately
versioned DFlash2 drafter or an inference runtime/container.

## Verification

```sh
pnpm build:models
node scripts/test-model-weights-integration.mjs
pnpm --dir ../one/packages/llm.one exec vitest run src/recipes/ModelWeightRecipes.test.ts
pnpm --dir one.provider test:ipc
```

`build:models` builds `one.core` before the model and API packages. The transport fix
in `one.core/src/websocket-promisifier.ts` removes a second offset application after
`getArrayBuffer()` has already normalized a binary view. Its regression test is in
`one.core/test/src/websocket-promisifier-handoff-test.ts` (build core and tests first).

The multi-process integration test covers stable publication, symlink-boundary rejection,
metadata-only sharing, selective on-demand reads, resumed pinning, full hashes, reads across chunk boundaries, read-only
filesystem operations, restart without the source, corruption rejection, altered chunk-manifest rejection, and onward sharing.
