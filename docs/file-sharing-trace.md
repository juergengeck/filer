# File sharing trace — 12 September 2026

The findings below describe the original trace. The subsequent fix adds an
authenticated received-file projection and records under `ONE/System/Journal`,
and changes ordinary Signature arrivals to preserve existing verification results.
Real trust changes still invalidate both signing/encryption trust calculations and
the Fotos verification memo before consumers see the new authority.

## Remaining native latency — instrumented follow-up

[Saved native timelines and diagnostics](qa-evidence/file-sharing-native-latency-2026-09-12.json)
cover both paths through the installed signed extension. These are individual runs,
with exact original-byte checks, rather than a latency distribution. No blocking
`waitForFotos` QA call ran during these measured transfers.

| Boundary from grant start | Fotos, connected sender | Generic file, after trust preflight |
| --- | ---: | ---: |
| Manifest event / durable receipt notification | 2.68 s | 0.53 s |
| Final working-set page delivered | 3.48 s | 2.16 s |
| New object/collection children delivered | 5.09 s | 3.57 s |
| Hydration callback begins | 5.17 s | 4.00 s |
| Hydration callbacks complete | 5.22 s | 4.10 s |
| Mounted original-byte read completes | **6.00 s** | **4.85 s** |

Native signal completion was at most **7 ms** in these connected/preflight runs.
Fotos hydration took **54 ms**; the two concurrent generic hydration callbacks
finished within **105 ms** of the first start. The generic receipt was committed
well before the mounted file became readable. The gaps between working-set delivery,
child enumeration, hydration, and the completed mounted read are outside the
instrumented application callbacks; this trace does not identify a particular
macOS daemon implementation as their cause. Cross-process wall clocks differ by
about 15 ms; individual duration spans use monotonic clocks.

There is measurable avoidable application work:

- `PublishedWorkingSet.getChanges` expires the entire working-set anchor when any
  published root version changes. A new Fotos share produced 12 native signals
  and a full scan of 56 items. Its 527 ms scan spent 354 ms traversing contacts,
  111 ms traversing generic objects, and under 1 ms traversing the cached Fotos tree.
- Every published-tree page recollects every root before slicing its requested
  page. The connected generic run invalidated a scan while it was running:
  **779 ms discarded**, followed by **910 ms** for the replacement scan. Contacts
  consumed 523/538 ms of those scans. Even with fewer than 100 items this repeated
  work is visible; the implementation repeats it for every additional page too.
- All Finder and QA operations share `StdioTransportPlan.processingQueue`.
  `waitForFotos` traverses, reads, and hashes all projected Fotos files while
  holding that queue, so it can block native operations and warm their caches.
  The new measurements exclude that wait from their transfer interval.

The immediate-after-pair generic run was worse: **13.11 s** from grant to mounted
bytes. A working-set version check took **6.58 s**, overlapping four serialized
trust-cache refreshes (1,423, 1,422, 932, and 1,459 ms) and signature revalidation.
The longest shared trust barrier was 3,820 ms; parallel waiter durations must not
be summed. That check began roughly 0.5 s before grant and finished 6.08 s after it.
The receipt notification followed at 6.50 s. Hydration callbacks finished by
9.89 s, but the mounted read returned at 13.11 s. Draining pairing/trust work before
starting the next measured grant reduced the generic transfer to 4.85 s; that
preflight is a diagnostic separation, not a product fix or a claim that pairing
became faster. The clean Fotos run performed exactly **one** new signature check,
so the prior Signature-arrival cache fix remains effective.

### Cold startup gap

After a real host restart, Filer opened retained data but had **zero active CHUM
sessions and no selected peer route**. A fresh Fotos share timed out after 60 s.
Reconnecting the selected sender restored delivery, including that pending share.
`FilerRuntime.init` initializes connections but does not demand retained peers;
`FilerQAPlan.resumeNetwork` explicitly calls `enableConnectionsToPerson`, hiding
this gap in the full protocol. The failed cold-start run is preserved separately
from the successful transfer measurements.

### Owners and next fixes

- Restore retained peer demand in the application's startup ownership path:
  [FilerRuntime](/Users/gecko/src/one/packages/refinio.api/src/filer/FilerRuntime.ts:241)
  and [explicit QA peer demand](/Users/gecko/src/one/packages/refinio.api/src/filer/FilerQAPlan.ts:145).
- Produce stable publication snapshots and actual changed-item deltas, retaining
  a snapshot across pages instead of expiring and scanning the whole working set:
  [PublishedWorkingSet](/Users/gecko/src/one/packages/refinio.api/src/filer/PublishedWorkingSet.ts:25).
- Remove duplicate trust refresh work at its producer while preserving the awaited
  trust barrier and real authority invalidation:
  [TrustedKeysManager](/Users/gecko/src/one/packages/one.models/src/models/Leute/TrustedKeysManager.ts).
- Keep long-lived QA observations from monopolizing the filesystem operation queue:
  [StdioTransportPlan](/Users/gecko/src/one/packages/refinio.api/src/transports/StdioTransportPlan.ts:155).

Only observational spans were added in this follow-up. Native instrumentation
covers notification receipt/signaling, enumeration callbacks, and bridge RPCs.
The signed Xcode build passed. Runtime scan counters were applied to the frozen
retained-store generation as an explicit diagnostic overlay; its source and hashes
are in the evidence directory below. No storage-format migration or new performance
fix was applied. The installed diagnostic app retains the spans; the packaging
input is restored to its pre-trace runtime after capture.

Diagnostic scripts, full logs, and per-run artifacts: `/tmp/filer-native-latency`.

## Fixed build verification

- [Fotos native evidence](qa-evidence/file-sharing-fotos-fixed-2026-09-12.json):
  one new verification instead of 17, **72 ms** synchronous crypto instead of
  2,051 ms, verified projection **2,760 ms** instead of 5,309 ms. Exact mounted
  196,992-byte PNG verified after **5,599 ms** total. Finder enumeration/hydration
  still added 2,839 ms after the application projection; that time was not removed
  by the signature fix.
- [Generic integration evidence](qa-evidence/file-sharing-generic-fixed-2026-09-12.json):
  `/objects/document.bin` is now byte-exact and read-only; the receipt and mounted
  JSON journal entry survive revocation and receiver restart. The private `/Files`
  import root remains owned by the local person. The authenticated receipt was
  committed 2,383 ms after grant start in this isolated run.
- [Installed File Provider evidence](qa-evidence/file-sharing-native-generic-fixed-2026-09-12.json):
  a fresh authenticated sender's 220,000-byte file was read from Finder's mounted
  `Objekte` folder, with its exact JSON receipt under `ONE/System/Journal` and the
  migrated earlier QA report beside it. Mounted bytes took 8,253 ms from grant;
  this proves native delivery, not a sub-second native latency claim.

The system journal is included in the native working set and strict notification
allowlist, including its exact parent containers. The native notification path
regression passed. Stale registrations for backup/development copies were removed
before selecting the installed app; all existing domains and stored data remain.

The upgraded native runner completed **11 stages and 52 assertions in 29,245 ms**
(run `1257e03c-636d-4dee-b9f8-285a421ef614`). Its new 146,079-byte report was read
from `ONE/System/Journal/qa-1257e03c-636d-4dee-b9f8-285a421ef614.json` and matched
the completed runner report exactly. The generic received file and its journal
receipt remained byte-exact after the protocol's runtime restart. See the
[system journal and restart proof](qa-evidence/file-sharing-system-journal-proof-2026-09-12.json).

Two paths were traced separately: a first Fotos collection share into the installed native Filer, and an owned Filer file shared by copying a contact into `Shared with`.

## Generic Filer `Shared with`

The receiver gets the original bytes, but its filesystem does not expose them. The saved two-instance run transferred a new **220,000-byte file** and verified the exact receiver BLOB. Both receiver listings remained empty (`/Files=[]`, `/objects=[]`); reading `/objects/document.bin/document.bin` failed with `Object folder does not exist`.

| Observation | Time |
| --- | ---: |
| Owner grant RPC | 919 ms |
| Owner authoritative IdAccess stored | +911 ms from grant start |
| Receiver FilerObjectRoot head arrives over CHUM | +1,598 ms |
| Receiver root → entry → original BLOB read | 4.45 ms internal / 7.26 ms IPC |
| Owner revoke RPC | 85.48 ms |
| Post-revoke effective access check | 1.27 ms IPC |

Before revocation, ID, root, entry and BLOB access were all true. After revocation, all were false on the owner. Previously transferred immutable bytes are not remotely erased. An earlier exploratory run also reproduced the empty receiver listings (2,213 ms root arrival, 72 ms revoke); only the subsequent run above has a saved artifact, and timings are not performance guarantees.

```text
Owner copies completed contact HTML into object/Shared with
  → ObjectFolderFileSystem validates contact and dispatches grant
  → FilesObjectPlan stores FilerObjectRoot + IdAccess
  → CHUM transfers root → stored entry → original BLOB
  → receiver storage read succeeds
  → receiver Files/Object listings omit the received root
```

This gap is in the projection contract. [FilesObjectPlan.entries](/Users/gecko/src/one/packages/filer.core/src/FilesObjectPlan.ts:36) derives descriptors exclusively from the local owner's files. [FilesFileSystem.snapshot](/Users/gecko/src/one/packages/filer.core/src/FilesFileSystem.ts:60) reads that owner's `FilerFilesRoot`. Importing a remote `FilerObjectRoot` never makes it part of those listings. The grant itself publishes a root and its recipe graph through [FilesObjectPlan.grant](/Users/gecko/src/one/packages/filer.core/src/FilesObjectPlan.ts:80).

The required app extension is an explicit received-file projection that retains the issuer's ownership. Adding remote data to the receiver's owned file root would incorrectly conflate ownership and receipt. A test must verify the received file through the filesystem surface in addition to proving raw storage transfer. This trace records the missing surface without making absence an expected product contract.

[Saved generic transfer and revocation evidence](qa-evidence/file-sharing-generic-2026-09-12.json). The full isolated integration script passed, including subsequent Fotos membership changes, restart and revocation. It exercises production `FileProviderOperations.handle` through test IPC, **not native Finder drag-and-drop**. Worker runtime was Node 24.19.0 with `--jitless`, using fresh stores and canonical package builds. Consequently its latency cannot be directly compared with the frozen retained-store native Fotos experiment below.

To reproduce after coherent package builds:

```sh
FILER_TEST_NODE=/Users/gecko/src/filer/one.provider/build/toolchain/node \
FILER_TEST_NODE_ARGS='["--jitless"]' \
node scripts/test-files-collections-integration.mjs
```

Normal invocation preserves the calling Node executable and arguments; diagnostic runtime overrides are explicit.

## Fotos → Filer

The new 196,992-byte PNG reached Filer's verified filesystem projection in **5,309 ms**. One new `Signature` caused all cached signatures to be invalidated: **17 synchronous verifications took 2,051 ms**, including 16 historical signatures. There was no full trust refresh or profile refresh during this share; the 17 trust barriers together took **1 ms**.

| Observation | Time |
| --- | ---: |
| Sender sharing operation returns | 1,231 ms after start |
| Selected photo synchronization within sender operation | 1,078 ms |
| Certificate/access scope commit within sender operation | 88 ms |
| New Signature invalidates receiver trust cache | +1,715 ms |
| Historical signature verification begins | +1,731 ms |
| Last new signature verification finishes | +3,904 ms |
| BLOB import notifications | +5,038 to +5,071 ms |
| Manifest head event | +5,267 ms |
| Verified receiver projection and original-byte check complete | +5,309 ms |

These are nested or overlapping observations, not additive timings. The remaining time includes publication, CHUM dependency transfer, storage, projection, and command overhead; this trace does not attribute all of it to network latency. This is one local run with retained share history, not a latency distribution or a cold-account benchmark.

The causal path is:

```text
Fotos setCollectionRecipients
  → synchronize selected original/variants
  → store certificate, signature, chain and manifest access
  → CHUM transfers allowed dependency graph
  → Filer receives Signature and clears every signature memo
  → serial synchronous crypto rechecks historical signatures
  → chain/manifest and original bytes finish importing
  → verified SharedFotosFileSystem projection
  → native File Provider enumeration and hydration
```

Source owners:

- [Sender publication spans](/Users/gecko/src/fotos/fotos.browser/browser-ui/src/App.tsx:1334).
- [Signature treated as a global trust invalidation](/Users/gecko/src/one/packages/refinio.api/src/filer/FilerRuntime.ts:207).
- [Global signature cache clearing](/Users/gecko/src/fotos/fotos.core/src/shared-fotos-file-system.ts:102).
- [Trusted key lookup and synchronous crypto measured separately](/Users/gecko/src/one/packages/one.models/src/models/Leute/TrustedKeysManager.ts:871).

The next performance change should distinguish a newly available signature from a change to the trusted keys used by existing signatures. Actual key, identity membership, and trust changes must still invalidate affected verification results. No such optimization was applied in this trace.

### Finder failure and recovery

The initial mounted-file check failed after 60 seconds even though the production projection already contained the correct bytes. The native host logged failed change signals, and an explicit domain refresh returned File Provider errors `-2001` / `-2014`.

`pluginkit` had selected the extension inside a moved backup app (`/private/var/folders/.../T/filer-reconnect-backup-r7smcvw4/OneFiler.app/...`), rather than the installed `/Applications/OneFiler.app`. Re-registering the installed app with LaunchServices and its extension with `pluginkit`, then refreshing `Filer QA`, succeeded. Reading the actual mounted path subsequently returned all **196,992 bytes**, exactly matching SHA-256 `5e768ac19f2b5cc885003ae51db52afa8d370bfb907c35678132ece7edff657d`.

The [installation script](/Users/gecko/src/filer/one.provider/scripts/rebuild-and-install.sh:20) now explicitly registers the installed destination before opening it. The temporary diagnostic installer received the same correction. Domains and stored data were retained. The original failed trace remains failed; recovery is recorded separately, and no post-repair end-to-end latency is claimed.

### Evidence and runtime provenance

- [Derived timings, original failure, recovered mounted bytes, and runtime provenance](qa-evidence/file-sharing-fotos-summary-2026-09-12.json).
- [Full before/after app and native diagnostics](qa-evidence/file-sharing-fotos-raw-2026-09-12.json).
- Trace ID: `951aa719-d41f-48e2-997c-5eafe7d89397`.
- Unauthorized Charlie's received-share snapshot remained empty.

The native runtime used Node 24.19 with `--jitless`. During the investigation, a concurrent ONE reference-codec migration changed canonical build outputs and prevented the retained browser stores from booting against those outputs. To keep the experiment coherent, the installed storage-format generation was frozen, with only the two timing-instrumented compiled modules overlaid (`TrustedKeysManager` and `FilerRuntime`). Fotos QA servers resolved core/models from that same diagnostic snapshot. The evidence includes SHA-256 provenance. This run does **not** validate the pending codec migration; retained stores were not reset or migrated.

Instrumentation validation: `one.models` source/test and `refinio.api` builds passed; 9 trust tests passed. Fotos browser typecheck/build and 199 tests passed. Installer shell syntax passed, and the registration commands were verified on the installed app.
