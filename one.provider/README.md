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
universal Node 22 or 24 executable containing both `arm64` and `x86_64`; it is
copied into the app. The bundled Node 24 release requires macOS 13.5 or later.

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

## Folder language

Finder uses the macOS preferred language (English or German) for OneFiler's
mounted folder names: Contacts/Kontakte, Files/Dateien, Photos/Fotos,
Health/Gesundheit, and the folders under ONE. Other languages use English.
Restart OneFiler after changing the preferred language. Localized names have
language-aware enumeration anchors so Finder refreshes cached folder labels.
Internal RPC paths and item identifiers remain stable; user-created folder and
file names are preserved. Contacts is the single contact view; there is no
separate Profiles root.

## Pair with Cube or another ONE device

Register a domain with the same identity email as Cube for device enrollment.
Choose **Pair with Another Device…** in that domain's menu and paste the complete
invitation link. Keep both apps open. If Finder shows an **Activate** banner,
activate OneFiler to allow enumeration.

The installed signed host also provides these commands:

```bash
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --register-domain "Cube" --email demo@demo.de
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --enroll-domain "Cube" --owner PERSON_ID < invitation.txt
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --list-domains
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --inspect "Cube"
```

`PERSON_ID` is the Cube owner's 64-character lowercase hex person id. Invoking
`--enroll-domain` with it is the CLI's device-enrollment consent, matching the
Pair dialog's Enroll confirmation; the invitation's enrollment owner must equal
`--owner` and its account email must match the domain's stored email.
`--pair-domain` is partner-only and rejects Cube IoM device-enrollment
invitations. `--list-domains` and `--inspect` are read-only. Every new command
prints one machine-readable JSON envelope with the host protocol version.

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

The application icon is `Resources/AppIcon.icon`, an Icon Composer document with
black/light and white/dark olive renditions. Xcode 26 or later compiles it using
`ASSETCATALOG_COMPILER_APPICON_NAME=AppIcon` and generates the bundle's icon keys,
including the compatibility ICNS for older macOS releases. Do not point those keys
at an ordinary image set or copy the document as an uncompiled folder. See
[Apple's Icon Composer integration](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer).

Dialogs explicitly use `FilerIcon.imageset`, whose light and dark SVG renditions
preserve the transparent background and cutout without the system app-icon plate.
Regenerate the SVG copies with `swift scripts/generate-app-icons.swift`. The
Composer copy omits the SVG's invisible artboard rectangle so layer coloring
applies only to the olive path. The original path and transforms stay unchanged.

The File Provider extension declares `ProviderIcon.icns` through
`CFBundleIconFile` and `CFBundleIcons/CFBundlePrimaryIcon/CFBundleIconFile`.
This is the provider's root icon, separate from the host application icon and
the sidebar symbol. Keep the file in the extension's resource build phase:
shipping an icon only in the host does not supply this extension resource.
`swift scripts/generate-app-icons.swift` generates it from `../olive.svg` with
a transparent background and cutout, black in light mode and white in dark mode.
The ICNS includes the native dark variant used by macOS system icons; an ordinary
macOS appiconset discards dark appearance entries.

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

## Auditing an unstamped canonical store

If the current runtime reports `SF-OPEN2`, quit Filer and verify that all of its
previous Node runtime processes have exited before running this explicit
maintenance command:

```bash
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost --admit-domain Gecko
```

The signed command resolves the configured store itself and holds the host lock
until its sole maintenance child has exited. The operator must keep all other
writers stopped throughout the audit. Ordinary startup never enables admission.
The audit checks exact content addresses and canonical object syntax, without
rewriting objects or identities. Only a successful audit adds the format marker;
different recorded formats, corruption, changing stores, and unsupported layouts
are rejected. This maintenance mode does not start models or network connections.

## Distribution

Install dependencies and complete the root workspace builds in `../../one`
and the Fotos workspace first. Packaging consumes that canonical installed and
built dependency graph; this provider package has no separate Node dependencies.

```bash
NODE_BINARY=/absolute/path/to/node npm run dist:mac
npm run publish:refinio
```

This is the existing Developer ID, notarized DMG pipeline. Mac App Store signing,
submission, privacy metadata, migration, and full Finder lifecycle validation
remain release work; a successful local build does not establish Store readiness.

The archive builds both architectures. Packaging and publication reject any
bundled Mach-O file (including native Node modules) that lacks either slice,
requires a newer macOS than the app advertises, or links to a library outside the
bundle and macOS system libraries. Publication also checks the mounted app's
version and signature and the disk image's notarization ticket.
Run `python3 scripts/test-macos-runtime.py` to check this gate with native fixtures.

`npm run dist:mac -- --build-only` prepares and verifies a signed app without
submitting to Apple or creating a disk image. This is useful when notarization
credentials or agreements need attention; its output is not a public release.
