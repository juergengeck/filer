# Windows Filer update

The Windows product uses native ProjFS and the canonical runtime in
`../one/packages/refinio.api`. WSL installation is retired. Linux uses FUSE.
Windows must project the same `/Files`, `/Fotos`, `/Gesundheit`, and `/ONE`
namespace as macOS; adapters must not interpret ONE's storage layout themselves.

## Implementation

1. Put bounded reads and admission control in `filer.core`, shared by ProjFS,
   FUSE3 and File Provider RPC. Read model shards through their owning model plan.
   Read local BLOB ranges through ONE storage, without loading the complete BLOB.
   Hold a read reservation until the native consumer has consumed the bytes;
   bound both active bytes and queued work and expose usage for verification.
2. Replace ProjFS's speculative cache misses and whole-file cache with completed
   asynchronous metadata, enumeration and range requests. Preserve 64-bit sizes,
   support cancellation, and drain requests before disposing callbacks.
3. Wire publication notifications to placeholder invalidation. Propagate failures;
   never silently present failed reads as empty directories or missing files.
4. Provide a Windows launcher using the shared Filer runtime. Support file/folder
   imports through the owning filesystem operations. Keep secrets out of command
   arguments. Document deployment prerequisites and the missing native installer.
5. Verify with shared read-contract tests and disposable native mounts, including
   cold access, enumeration, concurrent range reads above 4 GiB, errors, refresh,
   imports and shutdown. Full ONE/Fotos integration additionally requires the
   canonical Fotos source checkout and its built dependencies.

## Baseline (2026-09-10)

The native addon builds with VS2022 and loads under Node 22.19.0. The old bridge
hardcodes `/invites` and `/objects`, reads complete files, returns not-found while
metadata is still loading, and has a detached polling thread. Its connection test
launches an API CLI that no longer mounts ProjFS. At the start of this work,
the required Fotos source and built canonical API CLI were unavailable.

## Scope of memory guarantees

Transport ranges and concurrency have one shared policy. Underlying domain
owners must also be bounded: model reads verify existing 4 MiB shards, while
desktop BLOB reads seek directly. This does not change stored identities or
introduce a second sharding format. Browser IndexedDB's existing whole-record
storage needs a separate storage migration for equivalent large-BLOB guarantees.

Fotos now verifies a local original's existing normalized content identity in
1 MiB pieces before serving ranges. At most four verifications run concurrently;
the cache holds at most 64 verification results, never original bytes. Subsequent
reads seek directly into the immutable BLOB. Sharing authorization is rechecked
on every range. The first verification still reads the original's media payload.
Whole-file adapter callbacks remain a separate API; bounded range reads require
a local original BLOB. Native content versions include the entry's exact variant
references, so JPEG metadata changes cannot reuse stale hydrated bytes.

## Native contract reference

ProjFS pending requests must be completed and cancellations tracked; directory
enumeration completion carries its buffer handle. See Microsoft's
[asynchronous callback contract](https://learn.microsoft.com/en-us/windows/win32/projfs/asynchronous-callback-handling).

## Implemented and verified

- Replaced the native storage/cache stack with `native_provider.cpp`. Cold stat,
  case-insensitive owner-name resolution, directory enumeration, explicit I/O
  errors, content-version checks, cancellation and draining use OS command IDs.
- ProjFS, FUSE3 and private File Provider RPC use `filer.core/reads`. Legacy RPC
  whole-file requests are limited to the same 1 MiB transport budget. Imports
  share admission and use backpressured ONE BLOB streams.
- `/Files` now reads byte ranges directly from desktop storage. Model sharding
  remains with its existing domain owner. No stored recipe or hash format changes.
- Native publication wiring lives in canonical `NativeFilerMount`. Failed
  invalidation stops the native view. Read-only placeholders use ProjFS's explicit
  read-only eviction permission; local full/dirty entries remain intact.
- `scripts/windows-filer.mjs` reuses the private macOS runtime composition,
  including owner authentication, pairing, model operations and Devices
  list/rename/remove. It reads its secret from the environment and exposes no
  REST listener. The runtime must remain open.
- Windows-safe build/copy commands and a current native test entry replace the
  retired connection harness and detached polling/cache implementation.
- ONE BLOB publication waits for the write handle to close and serializes
  same-content commits, fixing concurrent Windows imports. Native invalidation
  resolves only physical parent directories, fixing refresh before first browse.

Validation on this Windows machine: native addon build; two real ProjFS tests
(cold access, case folding, exact bytes, 5 GiB hydration, refresh, file/folder
imports from another process, overwrite rejection, restart, pending-read drain);
six `filer.core` tests; one ONE storage range/import integration test; 21 focused
API tests; 114 Fotos tests; the full canonical API build; a live Windows launcher
test covering native browsing, Devices API, BLOB import and durable restart; and
the real paired ONE/Fotos integration with native collection hydration,
membership removal, offline restart and revocation.

The 5 GiB test confirms that ProjFS can request the entire file despite small
application reads. The bridge supplies those bytes in bounded pieces. This is a
memory bound, not a guarantee of partial download or a small disk cache.

The supplied Fotos checkout now contains the required implementation at commit
`6d0fb17`. Local junctions expose the nested checkout's `fotos.core` and
`fotos.browser` at the canonical sibling paths; installed package links target
canonical ONE. These are local checkout setup, not new source-layout conventions.
No installed application or user storage was replaced.

Reproduce runtime validation after building canonical dependencies:

```powershell
pnpm --dir ../fotos/fotos.core build
pnpm --dir ../one/packages/refinio.api build
pnpm test:windows
pnpm test:windows:runtime
pnpm test:windows:collections
```

## Remaining release gates

The native per-user [Windows package](../windows/README.md) now includes Node,
ProjFS, a compiled desktop host, DPAPI-protected configuration, Start menu and
optional login startup shortcuts, graceful shutdown, and visible import errors.
Settings → Devices uses the canonical inventory with Refresh, Rename and Forget.
Uninstall removes package-owned files and preserves profile/storage/mount content.
A relocated installation test passes, including two runtime boots and uninstall
preservation checks. Platform-selection regression coverage preserves Linux FUSE
and macOS builds. WSL installation is retired; Linux code and Debian packaging
remain supported.

Linux/macOS kernel tests, interactive desktop UI review, an upgrade UI and a
dedicated invitation-paste UI remain release work. Windows packages are
distributed unsigned by decision, with an archive SHA-256 checksum and installer
file-hash manifest. Signing is not a release gate. Current imports commit asynchronously after OS close;
failed commits preserve local bytes and report an error rather than discarding
the user's file. Browser whole-record storage still needs its own migration for
bounded large-BLOB access. Generated documents and directory metadata have their
own materialization costs; the BLOB/shard limits do not bound total process RSS.

Automatic approval review blocked removal of five temporary directories left by
interrupted test runs (only the reason “blocked by policy” was supplied). They
remain under `C:/Users/juerg/AppData/Local/Temp`: `filer-native-2IOuot`,
`filer-native-CqTWKQ`, `filer-native-GCFnUI`, `filer-native-gpnHwJ`, and
`one-blob-range-lmMkkl`. Completed tests removed their own temporary directories.
