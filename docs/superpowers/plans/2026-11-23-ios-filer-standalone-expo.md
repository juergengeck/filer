# Standalone iOS Filer App (Expo + Shared File Provider)

**Status:** Approved direction, ready for execution  
**Date:** 2026-11-23  
**Supersedes:** iOS sections of [`specs/001-apple-file-provider/plan.md`](../../../specs/001-apple-file-provider/plan.md) and Section 5 of [`filer-native-settings.md`](filer-native-settings.md)

## Architectural Decision

Ship **standalone `one.filer` for iOS** (and Android via the same Expo stack) as a thin Expo host app (`one.filer.expo/`) built on the canonical shared packages in `../one`:

- **`@refinio/filer.swift`** (`OneFilerCore`, iOS 16+ / macOS 13.5+) — shared Swift File Provider extension core.
- **`@refinio/filer.expo`** — Expo native module + config plugin + App Group SQLite WAL snapshot catalog + sandboxed `NSFileProviderReplicatedExtension` (`OneFilerExtension`) and Android `DocumentsProvider`.
- **`@refinio/filer.core`** — `FilerSnapshotStore`, `FilerProjectionHead`, `AcceptedSharesProjection`, `FilerFolderSettings`, `CategoryDemandPlan`.
- **`@refinio/one.core-expo`** + `@refinio/connection.core` / `@refinio/device.core` / `@refinio/settings.core` / `@glueone/auth.core` — in-process ONE runtime storing objects directly in the App Group container (`group.one.filer/one-storage`).

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

### Phase 1 — Extract shared Expo Filer host runtime into `../one/packages/filer.expo`
Move the reusable share-receiver and projection-publisher services currently living inside `vger.expo` into `@refinio/filer.expo` so `one.filer.expo` stays a thin shell and no host duplicates share verification logic:

1. Move and generalize from `../vger/packages/vger.expo/ios-ui/services/`:
   - `vger-file-sharing.ts` → `@refinio/filer.expo/share-receiver` (`createFilerFilesSyncRules`, `startFilerShareReceiver`): verifies `GraphReleaseState` / `GraphReleaseSelectionHead` against trusted publisher keys and feeds `AcceptedSharesProjection`.
   - `vger-files.ts` → `@refinio/filer.expo/host` (`getFilerOneStorageUri`, `clearFilerHostStorage`, `startFilerHostProjection`): manages App Group `one-storage`, `ProjectionPublisher`, domain registration, reactive `FilerProjectionHead` updates, and catalog clearing on share withdrawal.
2. Port the unit tests (`filer-share-receiver.test.mjs`, `filer-withdrawal.test.mjs`) into `../one/packages/filer.expo/test/`.
3. Verify `pnpm build && pnpm test` and `swift test` in `../one/packages/filer.expo`.

### Phase 2 — Scaffold standalone `filer/one.filer.expo` (v1 Read-Only)
Create the minimal standalone mobile Filer app following the `fotos.expo` vendor-pack and Expo SDK 57 pattern:

1. **Project & packaging setup:**
   - `one.filer.expo/package.json`, `.vendorrc.json`, `scripts/vendor-pack.js`, `scripts/verify-vendor-install.js` (vendoring canonical `../one/packages/*` including `@refinio/filer.expo` with `stage-swift-core.cjs`).
   - `one.filer.expo/app.json` with:
     - `ios.bundleIdentifier: "one.filer"`, `ios.appleTeamId: "26W8AC52QS"`, `NSBonjourServices: ["_one-refinio._udp"]`, `ITSAppUsesNonExemptEncryption: false`.
     - Plugins: `expo-router`, `expo-secure-store`, `./plugins/withIosSceneLifecycle`, and `@refinio/filer.expo` configured with `appGroupIdentifier: "group.one.filer"`, `iosExtensionBundleIdentifier: "one.filer.extension"`, `iosDisplayName: "ONE Filer"`.
   - Reuse the olive Filer app icon (`olive.svg` → Expo icon assets).
2. **Runtime boot (`src/runtime/`):**
   - Resolve `storageDirectory` from `getFilerOneStorageUri()` (`group.one.filer/one-storage`) **before** `MultiUser` / `one.core-expo` initializes.
   - Register Filer, Files, Assembly, Tag, Device, and Settings recipes + reverse maps.
   - Start `ConnectionsModel` / IoM + Glue passkey login / pairing invite acceptance + direct QuicVC / mDNS discovery (reusing `fotos.expo` / `vger.expo` login & transport setup).
   - Wire `startFilerShareReceiver` + `startFilerHostProjection` so received shares and owned Filer projections publish straight into the App Group SQLite WAL catalog.
   - Subscribe to `filer.folders` (`settings.core`) so remote IoM edits from desktop VGER/Cube/Akte update folder visibility on the phone, and local toggles sync back.
3. **Minimal UI (`app/`):**
   - **Sign-in / Pair screen:** Glue passkey sign-in or device pairing / IoM invitation acceptance.
   - **Files / Status tab:** File Provider domain status, connected peers, active shared roots, and quick "Open in Files" / troubleshooting state.
   - **Devices tab:** Paired IoM devices + accept/create pairing invitations.
   - **Settings tab:** `filer.folders` visibility toggles (`Files`, `Fotos`, `Health/Flexibel`), account/identity info, and reset/clear storage.
4. **Native iOS verification:**
   - `pnpm run vendor:setup`
   - `npx expo prebuild --platform ios --clean` — verify generated `ios/OneFilerExtension` embeds `OneFilerCore`, `group.one.filer`, `one.filer.extension`, and `UIApplicationSceneManifest`.
   - Build & archive in Xcode for iOS device / TestFlight (`one.filer` + `one.filer.extension`).
   - On-device smoke test: sign in / pair with macOS Filer or VGER, share a folder cut, open Apple **Files → ONE Filer**, verify browse + hydrate + thumbnails work while the Filer app is force-quit, then withdraw the share and verify removal.

### Phase 3 — Clean up `vger.expo` (single canonical Files provider)
Once standalone `one.filer.expo` is running and verified:

1. Remove the `@refinio/filer.expo` plugin entry and `group.vger.ios.filer` / `one.vger.OneFilerExtension` config from `../vger/packages/vger.expo/app.json`.
2. Remove `vger-files.ts` / `vger-file-sharing.ts` File Provider registration and App Group `one-storage` redirection from `../vger/packages/vger.expo/app/_layout.tsx`, `Model.ts`, and `settings/index.tsx` (preserving normal VGER CHUM/IoM sharing with Filer).
3. Regenerate `vger.expo/ios` (`expo prebuild --platform ios --clean`) so `OneFilerExtension` is no longer embedded in `one.vger`.
4. Note for existing TestFlight testers on `one.vger`: verify whether any existing `vger.expo` install needs storage migration out of `group.vger.ios.filer/one-storage` before removing the App Group entitlement.

### Phase 4 — v2 Write-Back from Apple Files (Outbox in `@refinio/filer.expo`)
After v1 is live on TestFlight:

1. **Outbox schema in `../one/packages/filer.expo/projection.sql`:** Add a `pending_writes` table and an App Group staging directory (`filer/<domain>/pending/`) writable by `IOSFileProviderExtension`.
2. **Swift extension write handlers (`IOSFileProviderExtension.swift`):**
   - Implement `createItem`, `modifyItem`, and `deleteItem` for writable containers (e.g. `/Files`) instead of returning `.fileWriteNoPermission`.
   - Stage file bytes into `pending/` (APFS clone/copy), record the intent row in `pending_writes`, return optimistic item metadata to Files, and post a Darwin notification / mark dirty state for the host.
   - Keep read-only views (`Geteilt/<person>/`, retired cuts) strictly non-writable.
3. **Host outbox drainer (`@refinio/filer.expo` + `one.filer.expo`):**
   - On foregrounding, background refresh (`BGAppRefreshTask`), or notification while active, drain `pending_writes` into ONE (`FilerStoredEntry` / `FilerFilesRoot` / `TagBinding`), republish the committed snapshot, and signal enumerators to reconcile versions.
4. **Native iOS Settings (optional follow-up):** Add `Settings.bundle` only if OS-level preferences are still needed beyond the in-app Settings tab and IoM `Your devices` settings.

---

## Open Checks Before Phase 3 / TestFlight
- **App Store Connect App ID for `one.filer`:** Confirm whether `one.filer` (currently registered for macOS TestFlight) already has the iOS platform enabled under the same App Store Connect app record, and ensure `group.one.filer` is enabled for both `one.filer` and `one.filer.extension`.
- **Existing `vger.expo` TestFlight storage:** Before stripping `group.vger.ios.filer` from `vger.expo` in Phase 3, confirm whether existing `one.vger` testers can reset/re-pair or need a one-time storage migration from App Group back to app sandbox.
