# Standalone iOS Filer App (Expo + Shared File Provider)

**Status:** Phases 1 & 2 shipped to TestFlight (`1.0.0`, build `2026112402`); awaiting on-device smoke test, Phase 3 (`vger.expo` cleanup), and Phase 4 (v2 write-back)  
**Date:** 2026-11-23 (updated 2026-11-24)  
**Supersedes:** iOS sections of [`specs/001-apple-file-provider/plan.md`](../../../specs/001-apple-file-provider/plan.md) and Section 5 of [`filer-native-settings.md`](filer-native-settings.md)  
**Remediation log:** [2026-11-23-ios-filer-standalone-remediation.md](2026-11-23-ios-filer-standalone-remediation.md) (completed)

## Architectural Decision

Ship **standalone `one.filer` for iOS** (and Android via the same Expo stack) as a thin Expo host app (`one.filer.expo/`) built on the canonical shared packages in `../one`:

- **`@refinio/filer.swift`** (`OneFilerCore`, iOS 16+ / macOS 13.5+) — shared Swift File Provider extension core.
- **`@refinio/filer.expo`** — Expo native module + config plugin + App Group SQLite WAL snapshot catalog + sandboxed `NSFileProviderReplicatedExtension` (`OneFilerExtension`) and Android `DocumentsProvider`.
- **`@refinio/filer.core`** — `FilerSnapshotStore`, `FilerProjectionHead`, `AcceptedSharesProjection`, `FilerFolderSettings`, `CategoryDemandPlan`.
- **`@refinio/one.core-expo`** + `@refinio/connection.core` / `@refinio/device.core` / `@refinio/settings.core` — in-process ONE runtime storing objects directly in the App Group container (`group.one.filer/one-storage`). (`@glueone/auth.core` passkey login is deferred past v1.)

### Why this fixes the previous wrong turns

1. **No Node subprocess on iOS:** Instead of macOS `one.provider`'s bundled Node child process, the Expo JS host runs ONE in-process, writes projection snapshots to the App Group SQLite WAL catalog, and the Swift File Provider extension reads that catalog offline—even when the host app is suspended or closed.
2. **One canonical `"ONE Filer"` location in Apple Files:** Filer remains a separate application on iOS just like macOS (`one.filer` / `one.filer.extension` / `group.one.filer`, Team `26W8AC52QS`). `@refinio/filer.expo` stays a reusable library in `../one`, while the embedded File Provider extension is removed from `vger.expo` so Apple Files never shows duplicate `"ONE Filer"` roots.
3. **Incremental delivery:** v1 ships **read-only** Apple Files browse/hydrate on top of the already-tested `@refinio/filer.expo` SQLite projection. v2 adds an App Group SQLite write-back outbox so edits/drops in Apple Files commit into ONE when the host runs.

---

## Target Identifiers & Boundaries

| Setting | Value | Notes |
|---|---|---|
| App directory | `filer/one.filer.expo` | Distinct from library `../one/packages/filer.expo` |
| iOS bundle ID | `one.filer` | Matches macOS `one.provider` App ID |
| iOS extension bundle ID | `one.filer.extension` | Matches macOS `one.provider` extension ID |
| App Group | `group.one.filer` | Shared between host (`one-storage/`, `filer/`) and extension |
| Apple Team ID | `26W8AC52QS` | Same signing team as macOS Filer, `one.vger`, `one.fotos` |
| Display name in Files | `ONE Filer` | Canonical single location in Apple Files |
| Expo SDK / RN | Expo ~57.0.8 / RN 0.86 | Matches `fotos.expo` & `vger.expo`, includes Xcode 27 `withIosSceneLifecycle` |

---

## Delivery Phases

### Phase 1 — Extract shared Expo Filer host runtime into `../one/packages/filer.expo` ✅ Done (`30778a3d6`, `04b294b18`)
Committed on `../one` (`feat/expo-plan-surface`):

- [x] Extracted `@refinio/filer.expo/share-receiver` (`createFilerFilesSyncRules`, `createFilerChumSyncOptions`, `createFilerBasicImportFilter`, `createFilerBasicExportFilter`, `startFilerShareReceiver`) and `@refinio/filer.expo/host` (`getFilerOneStorageUri`, `clearFilerHostStorage`, `startFilerHostProjection` with `keepDomainRegisteredWhenEmpty`) in `30778a3d6`.
- [x] Ported and expanded unit tests (`filer-share-receiver.test.mjs`, `filer-withdrawal.test.mjs`); `pnpm build && pnpm test` and `swift test` green.
- [x] Follow-up iOS fix `04b294b18` (*Resolve App Group aliases for new Filer domains* in `packages/filer.expo/ios/FilerPaths.swift`) and `5c83f925b` in `packages/filer.swift`.

### Phase 2 — Standalone `filer/one.filer.expo` (v1 Read-Only) 🟡 Uploaded to TestFlight (`1.0.0` / `2026112402`) — Awaiting On-Device Smoke Test
Committed on `filer` (`main`, `48308d4`, re-vendored `c84dd41`) including all remediation items from [2026-11-23-ios-filer-standalone-remediation.md](2026-11-23-ios-filer-standalone-remediation.md):

- [x] Project, vendor-pack setup (20 vendored packages, zero Node shims/stubs in `metro.config.js`), `app.json` (`one.filer` / `one.filer.extension` / `group.one.filer` / Team `26W8AC52QS` / `LSApplicationQueriesSchemes: ["shareddocuments"]`), Xcode 27 `withIosSceneLifecycle`, and exported olive icon set.
- [x] Runtime boot (`src/runtime/Model.ts`, `filer-platform.ts`, `filer-runtime-recipes.ts`, `invitation-codec.ts`): App Group `one-storage` resolved before `MultiUser`, `ConnectionsModel` on comm-server relay with `createFilerChumSyncOptions()` + prefilters, `startFilerShareReceiver` + `startFilerHostProjection` (`keepDomainRegisteredWhenEmpty: true`), `filer.folders` settings & pause/resume, clean `reset()` order, and partial-init teardown.
- [x] Minimal UI (`app/_layout.tsx`, `files.tsx`, `devices.tsx`, `settings.tsx`) with local sign-in, standard ONE invitation URL create/share/accept (IoM `same-person` / IoP `distinct-person`), reactive `useFolderModes`/`useOnlineState`, and Open in Files.
- [x] Automated verification green: `tsc --noEmit`, `node --test`, `pnpm run verify:bundle` (Hermes iOS export), `expo prebuild --platform ios --clean`, and unsigned `xcodebuild` simulator build.
- [x] Re-vendored (`c84dd41`) and prebuilt with `../one` `04b294b18` (`FilerPaths.swift` App Group alias fix) and `5c83f925b` (`filer.swift`).
- [x] Archived (`~/Library/Developer/Xcode/Archives/2026-11-24/ONEFiler-2026112402.xcarchive`) and uploaded to App Store Connect / TestFlight (`one.filer` `1.0.0`, build `2026112402`, with `one.filer.extension`).
- **Explicit v1 deferrals (post-TestFlight):**
  - Glue passkey login (blocked on `@glueone/auth.core` generalizing past hardcoded `https://fotos.one` / `fotosone://` plus authority registration).
  - Direct QuicVC / mDNS transports (v1 uses comm-server relay).
  - Full `SyncFilterFactory` per-channel trust gating and remote IoM settings sync lane.
- **Remaining to close Phase 2:**
  - [ ] On-device TestFlight smoke test: sign in, pair with macOS Filer or VGER via invitation URL, share a folder cut, open Apple **Files → ONE Filer**, verify browse + hydrate + thumbnails while the app is force-quit, then withdraw the share and confirm the domain clears cleanly.

### Phase 3 — Clean up `vger.expo` (single canonical Files provider) ⬜ Not Started
Note: `../vger` commit `57ed15a00` linked `vger.expo` to EAS (`one-vger`) with `one.vger.OneFilerExtension` still registered while standalone `one.filer` is validated. Once standalone `one.filer.expo` passes on-device TestFlight smoke testing:

1. [ ] Remove the `@refinio/filer.expo` plugin entry and `group.vger.ios.filer` / `one.vger.OneFilerExtension` config from `../vger/packages/vger.expo/app.json`.
2. [ ] Remove `vger-files.ts` / `vger-file-sharing.ts` File Provider registration and App Group `one-storage` redirection from `../vger/packages/vger.expo/app/_layout.tsx`, `Model.ts`, and `settings/index.tsx` (preserving normal VGER CHUM/IoM sharing with Filer).
3. [ ] Regenerate `vger.expo/ios` (`expo prebuild --platform ios --clean`) so `OneFilerExtension` is no longer embedded in `one.vger`.
4. [ ] Handle existing TestFlight testers on `one.vger`: decide whether they reset/re-pair or need a one-time storage migration out of `group.vger.ios.filer/one-storage` before removing the App Group entitlement.

### Phase 4 — v2 Write-Back from Apple Files (Outbox in `@refinio/filer.expo`) ⬜ Not Started
After v1 is live on TestFlight:

1. [ ] **Outbox schema in `../one/packages/filer.expo/projection.sql`:** Add a `pending_writes` table and an App Group staging directory (`filer/<domain>/pending/`) writable by `IOSFileProviderExtension`.
2. [ ] **Swift extension write handlers (`IOSFileProviderExtension.swift`):**
   - Implement `createItem`, `modifyItem`, and `deleteItem` for writable containers (e.g. `/Files`) instead of returning `.fileWriteNoPermission`.
   - Stage file bytes into `pending/` (APFS clone/copy), record the intent row in `pending_writes`, return optimistic item metadata to Files, and post a Darwin notification / mark dirty state for the host.
   - Keep read-only views (`Geteilt/<person>/`, retired cuts) strictly non-writable.
3. [ ] **Host outbox drainer (`@refinio/filer.expo` + `one.filer.expo`):**
   - On foregrounding, background refresh (`BGAppRefreshTask`), or notification while active, drain `pending_writes` into ONE (`FilerStoredEntry` / `FilerFilesRoot` / `TagBinding`), republish the committed snapshot, and signal enumerators to reconcile versions.
4. [ ] **Native iOS Settings (optional follow-up):** Add `Settings.bundle` only if OS-level preferences are still needed beyond the in-app Settings tab and IoM `Your devices` settings.

---

## Open Checks Before Phase 3 / TestFlight
- **App Store Connect App ID for `one.filer`:** Confirm whether `one.filer` (currently registered for macOS TestFlight) already has the iOS platform enabled under the same App Store Connect app record, and ensure `group.one.filer` is enabled for both `one.filer` and `one.filer.extension`.
- **Existing `vger.expo` TestFlight storage:** Before stripping `group.vger.ios.filer` from `vger.expo` in Phase 3, confirm whether existing `one.vger` testers can reset/re-pair or need a one-time storage migration from App Group back to app sandbox.
