# Windows ProjFS provider

Explorer → ProjFS → `one.projfs` → canonical ONE filesystem owners.
The provider projects the same namespace as macOS, including `/Files`, `/Fotos`,
`/Gesundheit`, `/ONE/invites`, and `/ONE/System/models`. It does not read ONE's
storage files directly.

## Build and test

Requires Windows with ProjFS enabled, Node 22, Python, VS2022 C++ tools and the
Windows SDK. The shared platform lives in `../../one/packages`, and Fotos core
must be present at `../../fotos/fotos.core` for the full runtime.

```powershell
pnpm --dir ../one/packages/one.core build
pnpm --dir ../one/packages/filer.core build
pnpm --dir one.projfs build
pnpm --dir one.projfs test

# Optional full 5 GiB hydration test; allow at least 6 GiB of free temporary disk.
$env:FILER_LARGE_READ_TEST = '1'
pnpm --dir one.projfs test
Remove-Item Env:FILER_LARGE_READ_TEST
```

Run commands above from the Filer repository root. Native tests use isolated
temporary mounts and a deterministic filesystem. They do not claim ONE/CHUM or
Fotos integration. After building the canonical runtime and Fotos dependencies,
`pnpm test:windows:runtime` tests the actual launcher, Devices API, native imports
and restart. `pnpm test:windows:collections` tests paired ONE instances, native
Fotos hydration, membership updates and revocation. All use disposable storage.

## Run the development host

Build the canonical runtime and its dependencies first (`pnpm build`). Create a
configuration file outside the mount and outside ONE storage:

```json
{
  "directory": "C:/Users/me/AppData/Local/Filer/storage",
  "mountPoint": "C:/Users/me/Filer",
  "email": "me@example.com",
  "name": "Windows Filer",
  "commServerUrl": "wss://comm10.dev.refinio.one",
  "inviteUrlPrefix": "https://refinio.one/invite"
}
```

Set `REFINIO_INSTANCE_SECRET` in the launching environment, then run:

```powershell
node scripts/windows-filer.mjs C:/path/to/filer.json
```

The host remains running until Ctrl+C or its input pipe closes. It uses the same
private, owner-authenticated stdin/stdout API as the macOS host, including pairing,
model publication, and Devices list/rename/remove operations. Logs go to stderr;
no REST port is opened. Production packaging still needs a Windows credential
store, tray/settings host, installer and service lifecycle.

## Read, refresh and import behavior

`filer.core/reads` limits each transport range to 1 MiB, admits four simultaneous
reads per process and queues at most 64. Reservations include the native copy or
RPC encoding. Model owners fetch and verify their existing 4 MiB shards. Desktop
BLOB ranges seek directly; the bridge retains no whole-file content cache.

ProjFS can request an entire file even for a small application read. The bridge
must hydrate the OS-requested range completely, in bounded pieces. Memory limits
do not imply a limit on downloaded bytes or Windows' disk cache.

Metadata failures complete with errors instead of populating speculative empty
results. Publication changes evict clean placeholders and notify Explorer. Local
full files and dirty entries are retained. Imports commit after the creating
application closes the file, through ONE BLOB storage and the owning `/Files`
filesystem; accepted local files become read-only. An import failure preserves
the local bytes and emits `operationError`. A successful OS copy alone does not
mean the asynchronous ONE commit has completed; `imported` reports acceptance.

See [the update plan and validation record](../docs/windows-update.md).
