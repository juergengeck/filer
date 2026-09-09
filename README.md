# filer

Monorepo for the current Filer workspace and platform-specific filesystem providers.

The root workspace consumes and evolves the shared ONE packages in `../one/packages/*`. This is Filer's canonical platform base, including `one.core`, `trie.core`, `chat.core`, and `refinio.api`. `../one-experimental` remains the base for Flexibel only; Filer must not depend on or make shared-platform changes there.

## Workspace Commands

The repository root provides pnpm entrypoints for the active platform packages:

```bash
pnpm install
pnpm build
pnpm test
pnpm clean
```

`pnpm build` builds sibling `../one` dependencies first (`one.core`, `one.models`, `trie.core`, `chat.core`, `refinio.api`), then the local Filer packages. The workspace runner skips packages whose `os` field does not match the current machine, so macOS builds `one.filer` and `one.provider` while leaving the Linux FUSE3 and Windows ProjFS native addons alone.

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
