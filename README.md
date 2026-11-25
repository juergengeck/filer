# filer

Monorepo for the current Filer workspace and platform-specific filesystem providers.

The root workspace consumes and evolves the shared ONE packages in `../one/packages/*`. This is Filer's canonical platform base, including `one.core`, `trie.core`, `chat.core`, and `refinio.api`. `../one-experimental` remains the base for Flexibel only; Filer must not depend on or make shared-platform changes there.

Native Windows development uses ProjFS and the same private runtime as macOS.
See the [Windows update and validation record](docs/windows-update.md) and
[build/run instructions](one.projfs/README.md). `pnpm test:windows` runs disposable
native mounts; the full host additionally requires the canonical Fotos checkout.
The [native Windows package](windows/README.md) includes the desktop host and
per-user installer. Linux continues to use FUSE; WSL Windows installation is retired.

## Filesystem Layout

The root exposes content folders dynamically. `Files` is visible by default for BLOB-backed imports, while `Fotos` and `Gesundheit/Flexibel` appear when their verified publications contain content. See [Files and Fotos](docs/files-and-fotos.md) and [Dynamic folder configuration](docs/dynamic-folder-configuration.md).
The `/objects` catchall belongs to the vger.headless API and is deliberately not mounted in the Filer UI.

System folders live under `ONE`:

```text
ONE/
├── System/
│   ├── debug/
│   ├── models/
│   ├── objects/
│   ├── settings/
│   │   └── Filer/
│   │       ├── folders.json
│   │       └── status.json
│   └── types/
└── invites/
```

`ONE/System/settings/Filer/folders.json` is the writable settings-book projection for folder visibility. `status.json` reports the configured mode, detected content, and effective mount state. Chats, contacts, and visible domain folders remain at the filesystem root. Existing model libraries migrate to the new path on startup while preserving item identities and file content.

## Workspace Commands

The repository root provides pnpm entrypoints for the active platform packages:

```bash
pnpm install
pnpm build
pnpm test
pnpm clean
```

`pnpm build` builds sibling `../one` dependencies first, then the local packages for the current platform. Linux retains `one.filer` and `one.fuse3`; macOS retains `one.filer` and `one.provider`; Windows builds `one.projfs`.

`pnpm test` runs the macOS provider IPC smoke test. The legacy FUSE tests are available as `pnpm test:filer`, but they require a working `fuse-native` build for the current Node/platform combination.

The macOS app bundles Node.js and the canonical `refinio.api` runtime. Swift talks to the host through authenticated private IPC, and the host uses refinio.api's existing stdio operation interface. The native path has no HTTP listener. See [provider build and runtime instructions](one.provider/README.md).

`pnpm test:fotos` builds and tests Fotos browsing, importing, pairing, and sync through the Swift bridge. See [Fotos integration](docs/fotos-integration.md) for coverage, the runtime command, and the remaining native Finder installation blocker.

Focused macOS File Provider commands are also available from the root:

```bash
pnpm build:provider
pnpm build:provider:swift
pnpm test:provider:ipc
pnpm test:provider:connection
```

## Projects

- `one.filer`
- `one.fuse3`
- `one.projfs`
- `one.provider`
- `specs`
