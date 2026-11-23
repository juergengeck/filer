# one.filer.expo — standalone ONE Filer mobile host

Thin Expo host app for the ONE Filer File Provider. It runs ONE in-process,
publishes the owned Filer projection plus accepted shares into the App Group
SQLite catalog (`group.one.filer`), and the native `OneFilerExtension` (embedded
by `@refinio/filer.expo`) surfaces it in Apple Files / Android DocumentsProvider
as **ONE Filer**.

This directory is the app shell. The reusable native/runtime pieces live in
`../one/packages/filer.expo` (`share-receiver`, `host`, config plugin).

## Setup

Requires Node 22+, `corepack`, Xcode 15+ (iOS), and the sibling `../one`
checkout (vendored packages resolve from `../../one/packages/*`).

```bash
pnpm run vendor:setup   # pack workspace deps -> vendor/, install, verify pins
pnpm run build          # tsc --noEmit
npx expo prebuild --platform ios --clean
```

Verify the generated `ios/OneFilerExtension` embeds `OneFilerCore`,
`group.one.filer`, `one.filer.extension` and `UIApplicationSceneManifest`,
then open `ios/*.xcworkspace` in Xcode.

## App structure

- `app/_layout.tsx` — boot: resolves App Group `one-storage` via
  `getFilerOneStorageUri()` before `MultiUser` opens it, local sign-in,
  then the tab stack.
- `app/(tabs)/files.tsx` — runtime/peer status, folder modes, Open in Files.
- `app/(tabs)/devices.tsx` — paired devices, create/accept pairing invitations.
- `app/(tabs)/settings.tsx` — `filer.folders` visibility toggles
  (`files`, `fotos`, `health.flexibel`), identity, storage reset.
- `src/runtime/Model.ts` — lean runtime: `MultiUser` auth, `LeuteModel` +
  `ConnectionsModel` on the comm-server relay with a Filer CHUM prefilter,
  `startFilerShareReceiver` + `startFilerHostProjection`, `SettingsPlan` with
  `filer.folders` subscription.
- Local sign-in only in v1 (see the note in `app/_layout.tsx`): Glue passkey
  login is blocked on `@glueone/auth.core` generalizing its mobile login past
  the hardcoded `https://fotos.one` client / `fotosone://` return URL, plus
  authority-side registration of a filer client.

## Branding assets

`assets/icon.png` (1024, opaque), `splash-icon.png` (1024, white olive on
black, splash background `#000000`), `adaptive-icon.png` (1024 foreground) and
`favicon.png` (64) are exported from `assets/olive.svg` (ImageMagick MSVG
renderer, pixel-verified). Re-export from the SVG if the artwork changes.

## Deferred to follow-ups (explicit)

- **Direct transports**: QuicVC dial/listen + mDNS discovery are not wired yet.
  v1 pairs and syncs over the comm-server relay. Port
  `FotosDirectTransports`/`iOSMDNSDiscoveryAdapter`-equivalents (needs
  `react-native-udp`, zeroconf deps and a transport matcher) into
  `src/runtime/` and supply them to `ConnectionsModel`.
- **Channel-demand import gating**: the CHUM prefilter in `Model.ts` enforces
  the trust-free subset of `createFilerFilesSyncRules` (receiver-local
  projection types + `Access`/`IdAccess`/`Group` never import). Authoritative
  share verification is the `AssemblyPlan` admission in `share-receiver`.
  Per-channel trust gating arrives with the module-graph connection stack.
- **GlueModule IoM settings sync**: `filer.folders` is local-first with a live
  subscription; remote IoM edits from desktop flow once the settings sync lane
  is attached.
- **Write-back (Phase 4)**: v1 is read-only in Apple Files.

## Handoff: Xcode archive, TestFlight, on-device smoke

`expo prebuild` and `tsc` are runnable here. The Xcode archive, TestFlight
upload and the on-device smoke test (sign in, share a folder cut, browse in
Files with the app force-quit, withdraw the share) need Apple signing assets
and a device, and stay with you.
