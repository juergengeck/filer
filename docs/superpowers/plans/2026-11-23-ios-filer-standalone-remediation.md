# Standalone iOS Filer (`one.filer.expo`) — Review Remediation Plan

**Status:** Completed (`../one` `30778a3d6`, `filer` `48308d4`)  
**Date:** 2026-11-23 (closed 2026-11-24)  
**Parent plan:** [2026-11-23-ios-filer-standalone-expo.md](2026-11-23-ios-filer-standalone-expo.md)  
**Scope:** Fix all blockers and high-impact bugs found in the Phase 1 (`../one/packages/filer.expo`) and Phase 2 (`filer/one.filer.expo`) review before Xcode archive, TestFlight upload, and Phase 3 (`vger.expo` cleanup). All 6 tasks plus the 3 review follow-ups (`Model.ts` partial-init teardown, hidden-on-boot skip, `useFilerStatus.ts` sync) are committed and verified.

---

## Task 1 — Fix Metro iOS Bundling & Singleton Resolution (Blocker #1)

**Problem:** `npx expo export --platform ios` currently fails with `Unable to resolve module @refinio/one.core-expo/load-expo from bootstrap.ts`. `@refinio/one.core-expo/package.json` only declares an `"import"` export condition (no `"default"` / `"require"`), while `bootstrap.ts` calls CJS `require('@refinio/one.core-expo/load-expo')`. In addition, `metro.config.js` does not pin `tweetnacl` as a singleton (which `one.core-expo/src/system/crypto-helpers.ts` requires so `tweetnacl.setPRNG(customPRNG)` patches the same NaCl instance used by `@refinio/one.core`).

**No Node `crypto` shim or stubs:** `@refinio/one.core-expo` already implements `one.core`'s crypto abstraction directly over `expo-crypto` (`createCryptoHash`, `getRandomBytes`, `sha256`, `customPRNG`). Do **not** add `shims/crypto.js` or `stubs/node-only-stub.js`. If Metro reports any `crypto`/`fs`/`path` import during `expo export`, fix the leaking import in the offending package instead of shimming around it.

**Changes:**
1. Fix `@refinio/one.core-expo/load-expo` resolution at the source:
   - In `../one/packages/one.core-expo/package.json`, add `"default": "./dist/*.js"` under `exports["./*"]` (or use ESM `import` in `one.filer.expo` bootstrap) so Metro resolves `@refinio/one.core-expo/load-expo` without a custom alias hack.
2. Update `filer/one.filer.expo/metro.config.js`:
   - Enforce single-instance resolution from `projectRoot` for `react`, `react-native`, `react-native-safe-area-context`, `react-native-svg`, and **`tweetnacl`**.
3. Add `"verify:bundle": "expo export --platform ios --output-dir .expo/bundle-check"` to `one.filer.expo/package.json` so Metro bundling is a repeatable gate alongside `tsc --noEmit`.

**Verification:**
```bash
cd /Users/gecko/src/filer/one.filer.expo
pnpm run verify:bundle
```
Must exit 0 and emit a complete Hermes/iOS JS bundle with zero Node shims/stubs and no unresolved module errors.

---

## Task 2 — Fix `Model.ts` Lifecycle: `reset()`, Post-Login `init()` Errors, and CHUM Sync Rules (Blockers #2 & #3, Bug #6)

**Problem:**
- `Model.reset()` deletes `group.one.filer/one-storage` via `clearFilerHostStorage()` **before** `this.one.logoutAndErase()` closes the active ONE instance.
- `this.one.onLogin(() => { void this.init().catch(...) })` swallows `init()` errors, leaving the user stuck on `LoginScreen` with no error message when domain registration or runtime startup fails.
- `ConnectionsModel` never receives `chumSyncOptions` (`priorityWakeupObjectTypes` for `GraphReleaseSelectionHead` / `Assembly` from `createFilerFilesSyncRules()`), and the hand-rolled `NEVER_SYNC_TYPES` filter omits `FilerReceivedObjectReceipt`, `FilerReceivedObjectsRoot`, and `hasRecipe(type)`.

**Changes:**
1. In `../one/packages/filer.expo/src/share-receiver.ts`:
   - Export `createFilerChumSyncOptions()` derived from `createFilerFilesSyncRules()` (computing `priorityWakeupObjectTypes`, `traceObjectTypes`, `importBatchContextObjectTypes` consistently with `SyncFilterFactory.createChumSyncOptions()`).
   - Export `createFilerBasicImportFilter()` / `createFilerBasicExportFilter()` blocking `FilerProjectionHead`, `FilerSnapshot`, `FilerDelta`, `FilerItem`, `FilerReceivedObjectReceipt`, `FilerReceivedObjectsRoot`, `Access`, `IdAccess`, `Group`, and checking `hasRecipe(type)` on import.
   - Rebuild & re-test `../one/packages/filer.expo`, then re-run `pnpm run vendor:setup` in `one.filer.expo`.
2. In `filer/one.filer.expo/src/runtime/Model.ts`:
   - Pass `chumSyncOptions: createFilerChumSyncOptions()`, `importFilter: createFilerBasicImportFilter()`, and `objectFilter: createFilerBasicExportFilter()` to `ConnectionsModel`.
   - In `loginOrRegister()` and `login()`, explicitly `await this.init()` (deduplicated via `this.initInFlight`) so any post-login initialization error rejects back to `LoginScreen` and surfaces in the UI banner instead of being swallowed by `onLogin`.
   - Fix `reset()` ordering:
     1. `await this.teardown()` (stop share receiver, stop/remove host projection, shut down `ConnectionsModel` and `LeuteModel`).
     2. `await this.one.logoutAndErase()` (close and erase the open ONE instance cleanly).
     3. `if (hasNativeFilerHost(filerHostPlatform)) await clearFilerHostStorage(filerHostPlatform)` (remove remaining App Group `filer/` and `one-storage/` directories).
     4. Guard against double-teardown triggered by `onLogout` during `reset()`.

**Verification:**
- Unit tests in `../one/packages/filer.expo/test/` covering `createFilerChumSyncOptions()` and `createFilerBasicImportFilter()`.
- Unit test in `filer/one.filer.expo/test/` verifying `Model.reset()` call ordering and `loginOrRegister()` error propagation when `init()` rejects.

---

## Task 3 — Fix Domain Visibility on Share Withdrawal in Standalone Mode (Bug #8)

**Problem:** In `../one/packages/filer.expo/src/host.ts`, when all shares are withdrawn (`!snapshot && previous`), `startFilerHostProjection` calls both `clearFilerProjection(domain.id)` and `removeFilerDomain(domain.id)`. That makes sense for embedded `vger.expo`, but for standalone **ONE Filer** it causes the **ONE Filer** location to vanish from Apple Files whenever the last share is withdrawn.

**Changes:**
1. In `../one/packages/filer.expo/src/host.ts`:
   - Add `keepDomainRegisteredWhenEmpty?: boolean` (default `false` to preserve existing `vger.expo` test semantics; `true` for standalone `one.filer.expo`).
   - When `keepDomainRegisteredWhenEmpty` is `true` and `!snapshot && previous`: call `clearFilerProjection(domain.id)` and ensure the domain remains registered (`registerFilerDomain(domain)` if not visible) instead of removing it.
2. Add a test in `../one/packages/filer.expo/test/filer-withdrawal.test.mjs` covering `keepDomainRegisteredWhenEmpty: true`.
3. Pass `keepDomainRegisteredWhenEmpty: true` from `filer/one.filer.expo/src/runtime/Model.ts`.

**Verification:** `pnpm --dir ../one/packages/filer.expo test` passes all existing + new withdrawal cases.

---

## Task 4 — Wire Pairing Invitation URLs & Share Sheet in `DevicesTab` (Bug #4)

**Problem:** `app/(tabs)/devices.tsx` calls `JSON.parse(invitationInput)` directly, which rejects standard ONE invitation URLs (`https://.../#<url-encoded-json>` or `one://...#<encoded-json>`) produced by desktop OneFiler, VGER, and Fotos. Created invitations are also raw JSON with no share/copy affordance or IoM/IoP selector.

**Changes in `filer/one.filer.expo/`:**
1. Add `src/runtime/invitation-codec.ts` with pure, tested helpers:
   - `parseInvitationInput(raw: string): Invitation` — trims input, extracts and `decodeURIComponent`s the `#` fragment when a URL is pasted (falling back to raw JSON), validates required fields (`token`, `publicKey`, `url`), and throws a clear error otherwise.
   - `formatInvitationUrl(invitation: Invitation, mode: 'IoM' | 'IoP'): string` — formats a standard URL (`https://one.filer/invites/inviteDevice/?invited=true#<encoded>` for IoM, `invitePartner` for IoP) compatible with desktop Filer, VGER, and Fotos.
2. Update `app/(tabs)/devices.tsx`:
   - Add an `IoM` (own device) / `IoP` (partner) mode toggle when creating invitations (passing `mode` or `setMode` as supported by `PairingManager.createInvitation`).
   - Display the formatted invitation URL with a native **Share** button (`Share.share({message: url})`).
   - Parse pasted URLs or raw JSON via `parseInvitationInput()` in `acceptInvitation()`.
3. Add `test/invitation-codec.test.mjs` covering desktop URLs, `one://` URLs, raw JSON, and malformed inputs.

**Verification:** `pnpm --dir one.filer.expo test` passes URL/JSON round-trip tests.

---

## Task 5 — Fix `Open in Files`, Live UI Subscriptions, and Folder Visibility Wiring (Bugs #5 & #7)

**Problem:**
- `Linking.canOpenURL('shareddocuments://')` always returns `false` on iOS without `LSApplicationQueriesSchemes: ["shareddocuments"]`.
- Neither `files.tsx` nor `settings.tsx` subscribes to `model.onFolderModesChange`, and `files.tsx` doesn't subscribe to `model.connections.onOnlineStateChange`.
- `settings.tsx` shows toggles for `files`, `fotos`, and `health.flexibel`, none of which affect the iOS projection.

**Changes in `filer/one.filer.expo/`:**
1. In `app.json`, add `"LSApplicationQueriesSchemes": ["shareddocuments"]` under `expo.ios.infoPlist` (and assert it in `test/app-config.test.mjs`).
2. Add reactive hooks (`useFolderModes(model)` subscribing to `model.onFolderModesChange`, and `useOnlineState(model)` subscribing to `model.connections.onOnlineStateChange`) and use them in `files.tsx` and `settings.tsx`.
3. Wire `files` visibility into `Model.ts` / `startFilerHostProjection`:
   - When `folderModes.files === 'hidden'`, pause/clear the Files projection (`clearFilerProjection`); when `auto` or `visible`, publish normally.
   - In `settings.tsx`, clearly label `fotos` and `health.flexibel` as *synced preference (desktop / upcoming on iOS)* so users aren't misled into thinking v1 projects Fotos or Health on iOS yet.

**Verification:**
- Regenerate `ios/` via `npx expo prebuild --platform ios --clean` and verify `LSApplicationQueriesSchemes` contains `shareddocuments` in `ios/ONEFiler/Info.plist`.
- Verify `files: hidden` clears the catalog and switching back to `auto`/`visible` republishes it.

---

## Task 6 — Cleanup, Branding Assets, and Native Build Check

1. **Delete untracked test artifact:** Remove `/Users/gecko/src/one/packages/filer.expo/OneDB/`.
2. **Trim unused deps & fix README drift in `one.filer.expo/`:**
   - Remove unused `@glueone/auth.core` and `expo-web-browser` from `.vendorrc.json` and `package.json` (until Glue passkey login is generalized), re-run `pnpm run vendor:setup`.
   - Fix `one.filer.expo/README.md` line 30 so it accurately says *local sign-in* (matching line 40).
3. **Export real olive Filer icon PNGs from `assets/olive.svg`:**
   - Generate `assets/icon.png` (1024×1024), `assets/splash-icon.png`, `assets/adaptive-icon.png`, and `assets/favicon.png` from `assets/olive.svg` so the app does not ship with `fotos.expo` placeholder icons.
4. **Full end-to-end verification before handoff:**
   ```bash
   cd /Users/gecko/src/one/packages/filer.expo
   pnpm build && pnpm test && swift test

   cd /Users/gecko/src/filer/one.filer.expo
   pnpm run vendor:setup
   pnpm run build
   pnpm test
   pnpm run verify:bundle
   npx expo prebuild --platform ios --clean
   ```
   - Run an unsigned iOS Simulator build via `xcodebuild -workspace ios/ONEFiler.xcworkspace -scheme ONEFiler -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build` to confirm both `ONEFiler` and `OneFilerExtension` compile and link `OneFilerCore` cleanly under the installed Xcode.

---

## Follow-Up (After On-Device Smoke Test Passes)
- **Phase 3 (`vger.expo` cleanup):** Remove `@refinio/filer.expo` and `OneFilerExtension` from `../vger/packages/vger.expo` per [2026-11-23-ios-filer-standalone-expo.md](2026-11-23-ios-filer-standalone-expo.md#phase-3--clean-up-vgerexpo-single-canonical-files-provider).
- **Phase 4 (v2 write-back):** Add App Group SQLite `pending_writes` outbox in `@refinio/filer.expo`.
