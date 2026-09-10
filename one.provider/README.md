# OneFiler for macOS

OneFiler bundles a Swift host, a Swift File Provider extension, Node.js, and the
canonical `../../one/packages/refinio.api` runtime with its ONE dependencies.
The application is **not Swift-only**. Each registered domain owns one ONE
instance in a Node child managed by the host.

```text
Finder
  -> File Provider extension (Swift, sandboxed)
  -> private app-group Unix socket, mutual code-signature validation
  -> OneFiler host (Swift, sandboxed)
  -> inherited stdin/stdout, refinio.api StdioTransportPlan
  -> ONE filesystem operations, models, synchronization and storage (Node.js)
```

The native path opens no HTTP server. Kernel-provided peer audit tokens and
Apple code-signature validation restrict the socket to the intended host and
extension from team `26W8AC52QS`. File permissions alone do not authenticate a
caller. The extension has no network entitlement. Node inherits the host sandbox,
runs with `--jitless`, and receives credentials only through its inherited pipe.
The host stores instance secrets in Keychain; domain configuration contains a
local storage UUID and email, separate from ONE's actual SHA256 identities.

The shared operation registry authorizes explicit filesystem and device
capabilities using the initialized ONE owner. Request-supplied tokens, identities,
and capabilities do not establish authority. Domain errors retain their existing
RPC representation. See [native runtime and hash audit](../docs/native-runtime-audit.md).

## Build and test

Build the canonical shared dependencies in `../../one` first. Select a maintained
Node 22 or 24 executable for the target architecture; it is copied into the app.

```bash
NODE_BINARY=/absolute/path/to/node npm run prepare:runtime
swift test
npm run test:connection
npm run test:private-ipc
xcodegen generate
xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Release build
```

`test:connection` starts the packaged Node/ONE runtime and exercises the Swift
bridge without a port. `test:private-ipc` requires a local signing identity and
checks valid peers, wrong bundle identities, and an ad-hoc-signed impostor.
For provisioned sandbox checks, including the bundled Node child:

```bash
FILER_PROFILE_APP=/path/to/signed/OneFiler.app \
FILER_TEST_RUNTIME="$PWD/build/native-runtime" npm run test:private-ipc
```

The signed app supplies matching host/extension provisioning profiles. Tests use
disposable processes and storage; they do not install an app or register domains.
Existing Fotos and read-only HTTP fixtures remain test adapters, independent of
the production native transport.

## Run

Install and open the signed app, then select **Register Domain** and enter a name.
Keep OneFiler open while using the domain. The host starts each runtime on demand
and closes its input pipe on shutdown so ONE can drain operations and close storage.
Removing a domain retires its runtime through configuration-directory observation.
Concurrent domain operations preserve unrelated configuration, and replacement
runtimes wait until the previous owner finishes shutting down.

Legacy `path` or `endpoint`/`token` configurations are rejected without being
rewritten. Existing installations need an explicit storage/identity migration;
creating a new UUID domain does not adopt an existing external ONE instance.

## Pair with Cube or another ONE device

Register a domain with the same identity email as Cube for device enrollment.
Choose **Pair with Another Device…** in that domain's menu and paste the complete
invitation link. Keep both apps open. If Finder shows an **Activate** banner,
activate OneFiler to allow enumeration.

The installed signed host also provides these commands:

```bash
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --register-domain "Cube" --email demo@demo.de
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --pair-domain "Cube" < invitation.txt
```

The invitation file contains a secret: keep it private and use a fresh invitation
from the peer. The command contacts the running host through the same authenticated
socket used by the extension; it does not start another storage owner. Pairing
success is distinct from completion of domain-specific data synchronization.
See [Cube integration evidence](../docs/flexibel-cube-integration.md) for the live
Finder check and the remaining clinical filesystem boundary.

## macOS icons

The menu bar uses the SVG template at
`Resources/Assets.xcassets/MenuBarIcon.imageset/olive.svg`, an exact copy of
`../olive.svg`. Keep these in sync. AppKit supplies its tint; connection status
changes the tooltip.

Finder's path bar needs the named asset declared by `CFBundleIconName`:
`FilerIcon.imageset`. It supplies original-color SVG renditions for light (black)
and dark (white) appearance, rather than depending on template tinting. Both
preserve the transparent background and cutout of `../olive.svg`, without a stroke.
`CFBundleIconFile` separately points to `Resources/Olive.icns` for icon-file
consumers. Regenerate the image-set renditions and that file together with
`swift scripts/generate-app-icons.swift`.

Keep `ASSETCATALOG_COMPILER_APPICON_NAME` explicitly empty: XcodeGen otherwise
defaults it to `AppIcon` and overrides the explicit `CFBundleIconName=FilerIcon`.
Keep both icon plist keys: removing the named asset leaves Finder's path bar with
a generic package icon. Xcode must compile the asset catalog for the named icon,
menu-bar template, and sidebar symbol.

Finder's sidebar uses the separate `FilerSidebar.symbolset`, declared through
`CFBundleIcons/CFBundlePrimaryIcon/CFBundleSymbolName` in the extension's plist.
The extension must also compile the asset catalog. Its monochrome symbol preserves
the path from `../olive.svg` at every weight and scale; Finder supplies the tint.
The glyph uses 150% optical sizing around its center to match neighboring sidebar
symbols rather than appearing as a small dot at text cap height.
Keep that path synchronized when changing the logo.

Installed check on 2026-09-09: the compiled extension symbol loads through AppKit
and renders the olive in black and white. Existing `ONE-Test` and other legacy
Finder locations belong to `com.one.filer.extension`, whereas this app provides
`one.filer.extension`. Those locations still report a missing app. Finder does pick
up the new sidebar artwork after refreshing its bundle metadata; the icon update
does not resolve or migrate the old provider domains.

## Distribution

```bash
NODE_BINARY=/absolute/path/to/node npm run dist:mac
npm run publish:refinio
```

This is the existing Developer ID, notarized DMG pipeline. Mac App Store signing,
submission, privacy metadata, migration, and full Finder lifecycle validation
remain release work; a successful local build does not establish Store readiness.
