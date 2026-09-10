# Persistent Filer items and change enumeration

`../one/packages/filer.core` owns the reusable item identity, version, snapshot,
and change-feed contract. The model library in `llm.one` is its first producer.
`refinio.api` supplies the native operations; Swift consumes the same descriptors
and anchors. Existing mutable mounts have not been migrated to this contract.

## Identity and atomic visibility

A `FilerItem` identity consists of its canonical Person owner, projection namespace,
and producer-supplied logical key. Paths and names are versioned properties, not
identity fields. External identifiers use `filer:<ONE ID hash>`; adapters resolve
these identifiers through the owning projection before reading content.

A file's content version comes from its owner (the complete file SHA-256 for model
weights). Its exact `FilerItem` version hash supplies the metadata version. Directory
versions reflect their child versions. Tracked items do not invent timestamps when
the owner has no dates. Model revisions and their files remain read-only.

`FilerSnapshot` selects exact item versions and references its previous snapshot and
a typed `FilerDelta` of updates and deletions. Preparing a snapshot does not make it
visible. `ModelWeightsPlan` commits the snapshot reference in the same version of
`ModelWeightLibrary` as accepted revision membership. Readers follow that committed
root, never the independently advancing item version heads. Notifications follow
this commit. Re-publishing identical content leaves the snapshot and anchor intact.

Libraries created before this contract receive an explicit schema upgrade: the
owner constructs an initial snapshot from the revisions already referenced by its
library and commits the new optional `projection` field. It does not scan storage,
download weights, or fabricate historical arrival events. Old synthetic anchors
expire and require a fresh enumeration.

## Enumeration contract

The private runtime exposes:

| Operation | Request | Response |
| --- | --- | --- |
| `filer:getItem` | `id` | Persistent item descriptor |
| `filer:enumerateItems` | `container`, optional `page`, `limit` | `items`, optional `nextPage` |
| `filer:getCurrentAnchor` | `container` | `anchor` |
| `filer:getChanges` | `container`, `since`, optional `limit` | `updated`, `deleted`, `newAnchor`, `moreComing` |
| `filer:readItemContent` | `id`, `version`, `position`, `length` | Verified content range |

Containers are persistent item identifiers, `root`, or `workingSet`. Folder feeds
report immediate children; a tracked file feed reports that file's changes. Moves
retain identity, remove membership from the old parent, and update membership in the
new parent. The working set contains the tracked model tree and sees a move as an
update of the same item. Deletion records retain IDs after the item disappears.

Cursors bind the container, base snapshot, fixed target snapshot, and pagination
offset. Pages cannot drift when newer commits arrive. Change enumeration reads the
stored deltas and coalesces them against those snapshots. Malformed, foreign,
non-ancestral, and uncommitted snapshot cursors return `-32020`, mapped to File
Provider's `syncAnchorExpired`. Anchors are at most 500 bytes. Pages default to 100
items and are limited to 500; the native adapter requests 100.

The root still browses existing unconverted mounts, but its change feed covers only
the tracked projection. Unconverted mount change requests return an explicit
unsupported error, not an empty successful feed. Their mutable identity/version and
rename/move contracts remain separate adoption work.

## Native notification path

After a committed projection update, the Node owner emits a typed `filerChanged`
frame over its inherited stdout pipe. The host validates the frame independently of
request replies and signals affected container/file enumerators and the working set
using `NSFileProviderManager`. Domain configuration is checked again after suspension
so retired storage cannot signal a replacement domain. A storage owner backing
multiple configured domains signals each matching domain.

Bootstrap signals the persisted tracked containers as well, so a missed in-process
notification does not erase changes committed while the host was closed. The feed
and its anchors survive process restart; notifications are wakeups, not history.
There are no polling loops or synthetic clock anchors. Signal failures are logged;
the persisted history remains available on the next signal or enumeration.

Swift forwards server pagination, item versions, deletions, and anchors without
synthesizing missing fields. Invalid feed responses fail enumeration. Hydration
checks the requested content version and uses bounded reads. See Apple's
[change-tracking contract](https://developer.apple.com/documentation/fileprovider/tracking-your-file-provider-s-changes)
and [change observer](https://developer.apple.com/documentation/fileprovider/nsfileproviderchangeobserver).

## Limits and verification

Snapshots currently retain their full history. Retention/compaction would require
an explicit oldest-valid-anchor policy. The host still needs to remain running for
live synchronization; host launch/recovery work is not part of this change.

Tests cover identity across rename/move, content and metadata versions, deletion,
atomic root visibility, deterministic publication, page consistency under new
commits, expired cursors, native observers, typed pipe notifications, and real
multi-process CHUM model sharing with item IDs and anchors preserved across restart.
Installed Finder lifecycle behavior still requires a deployment test; a signed build
or a temporary runtime does not replace the installed app or its domains.

The existing Spark Qwen 27B publication also passed the schema upgrade and a second
open: its manifest, stable item ID, content and metadata versions, and 140-byte
anchor remained identical across restart. ID-based range reads matched Spark's
source files. The full Qwen snapshot remains only partially cached locally.
The development-signed Release build passed recursive strict signature verification.
