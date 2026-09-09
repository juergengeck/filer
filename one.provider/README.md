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

Legacy `path` or `endpoint`/`token` configurations are rejected without being
rewritten. Existing installations need an explicit storage/identity migration;
creating a new UUID domain does not adopt an existing external ONE instance.

## macOS icons

The menu bar uses `Resources/Assets.xcassets/MenuBarIcon.imageset/olive.svg`,
an exact copy of `../olive.svg`. Keep these in sync. AppKit supplies the template
tint; connection status changes the tooltip. The AppIcon set uses the olive on
white. Xcode must compile the asset catalog.

## Distribution

```bash
NODE_BINARY=/absolute/path/to/node npm run dist:mac
npm run publish:refinio
```

This is the existing Developer ID, notarized DMG pipeline. Mac App Store signing,
submission, privacy metadata, migration, and full Finder lifecycle validation
remain release work; a successful local build does not establish Store readiness.
