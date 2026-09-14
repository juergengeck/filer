# Fotos integration

The native app exposes `/Fotos` for collections shared from fotos.one through
ONE pairing. In the default `auto` mode the mount appears only while at least
one verified collection exists. It composes the shared collection adapter from
`fotos.core` into its bundled refinio.api runtime. See [Files and Fotos](files-and-fotos.md)
and [Dynamic folder configuration](dynamic-folder-configuration.md).

The HTTP flows below remain external integration fixtures for the original
writable `/fotos` library adapter. They do not select the native `/Fotos`
collection mount. The native host owns its instance over private IPC and does
not accept an endpoint or token when registering a domain.

Run from the Filer workspace:

```sh
pnpm install
pnpm test:fotos
```

The test command builds the affected shared packages from `../one` and the
Fotos filesystem export from `../fotos/fotos.core`, then tests these flows in order:

1. Enumerate `/fotos` through the Swift File Provider bridge, read a PNG original,
   compare every byte, and check stable item identifiers and versions.
2. Import a JPEG through the same Swift creation method used by the extension.
   The fixture contains valid JPEG metadata segments making it larger than 180 KB.
   Verify exact bytes, Fotos' metadata-independent content identity, repeat-import
   idempotence, and rejection of an overwrite with different content.
3. Pair two independent ONE instances through a local communication server.
   Verify the recipient cannot browse the manifest before sharing. Grant only
   the Fotos manifest's stable id, verify initial transfer through the recipient's
   Swift bridge, and import another image while CHUM is running. Compare the new
   original's bytes on the recipient and verify its mount is read-only.

Instances, credentials, ports, and storage are disposable. No live Fotos library
or remote deployment is used. The runner shuts down its processes and local relay.

## Running a Fotos filesystem endpoint

```sh
pnpm build:fotos
export REFINIO_INSTANCE_SECRET='your-instance-secret'
export REFINIO_FILER_TOKEN='your-dedicated-token-at-least-32-characters'
pnpm dev:fotos --directory /absolute/path/to/fotos-instance \
  --email your-instance-email --port 49498
```

The endpoint is `http://127.0.0.1:49498/filer/rpc`. The default manifest identity
is `fotos`; `--manifest` selects an explicit FotosManifest identity. `--read-only`
disables imports and requires that the manifest arrives from a peer or already
exists. `--import /absolute/path/to/photo.jpg` imports a starting fixture.

The instance must be owned by this runtime; do not concurrently open storage
already used by another ONE process.

`FotosFileSystem` is owned by `fotos.core` and exported as
`@refinio/fotos.core/filesystem`. The application composes it with
`@refinio/api/filer`. No ONE instance runs inside the Swift extension.
The projection reads Fotos entries and explicit original variant BLOBs. A runtime
with device-local originals can supply its owning byte resolver. Missing originals
and conflicting source paths produce errors. Imports currently accept individual
files into the `/fotos` root; folder creation, renaming, and deletion are not
implemented. This is not a Fotos browser/iOS UI test.
The HTTP write request limit is 64 MB including base64 encoding, so individual
originals must be smaller than roughly 48 MB for this import path.

## Native Finder validation, 2026-09-05

The Swift bridge integration, large JPEG import, pairing, initial transfer, and
live transfer passed. The Swift suite passed with 46 tests and three integration
tests skipped outside their dedicated runners. The signed Xcode development
build also passed.

An actual Finder mount was attempted but is not validated. macOS rejected domain
registration with File Provider error `-2003`, reporting that the older installed
`/Applications/OneFiler.app` is in use. That installation uses legacy `path`-based
domain configuration; the new host requires `endpoint` and `token`.

The attempt exposed a pre-existing destructive config-read behavior: decode
failure returned an empty dictionary before registration wrote a new one. The
three existing domain entries were restored from the retained migration-source
copy in `group.com.one.filer`. The fix now propagates decode errors before any
write, rolls back config changes when macOS rejects registration, and reports
asynchronous registration failure to the host UI. Regression tests cover both
legacy-config preservation and rejected-registration rollback.

The installed app was not replaced. Completing the native Finder test requires
a coordinated installed-app update and explicit configuration of RPC endpoints
for retained legacy domains. Automatic Finder change notifications are also not
implemented by the existing generic RPC change API; this suite verifies fresh
enumeration and content reads after sync, not background Finder refresh.

The current signed host supports `--register-domain NAME` for a new local owned
instance. The endpoint/token command described by this historical validation is
no longer a supported native configuration. Existing domain configuration is
preserved and rejected until explicitly migrated.
