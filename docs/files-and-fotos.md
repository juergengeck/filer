# Files and shared Fotos collections

The native Filer runtime exposes two separate root folders:

- `/Files` accepts dropped files and folders. Every imported file is a typed
  `FilerStoredEntry` with a native `referenceToBlob`; `FilerFilesRoot`, addressed
  by the instance owner, retains the exact entry versions. Original bytes are
  preserved, including non-photo files. Reimporting the same bytes at the same
  path is idempotent. A different file at an occupied path is rejected. Imported
  entries are read-only; directory capabilities permit adding children.
- `/Fotos` lists **collections shared from fotos.one**. It does not create or
  expose a local Fotos library, gallery-wide share, or person scope. Each
  collection folder is addressed by its scope ID and issuer, keeping different
  senders' collections separate. Folder contents follow the sender's current
  `FotosShareManifest` and explicit original BLOB variants.

Use the existing Filer pairing controls to pair Filer with fotos.one, then share
an individual collection to that Filer identity from fotos.one. Pairing alone
shares no collection. Before a share arrives, `/Fotos` is an empty folder.

The shared receiver in `fotos.core` verifies the recipient, issuer, scope,
certificate chain, and signature with the runtime's trusted keys. Revoked or
invalid shares are excluded. Every content read checks current sharing state.
Changes to manifests and certificates invalidate observed Finder directories;
committed file imports do the same for `/Files`. Received shares and imported
file references survive runtime restarts.

No live account is connected by a source build. The installed native app needs
a rebuilt runtime bundle to pick up these mounts. `prepare:runtime` includes
`fotos.core` in the native dependency closure.

## Validation

```sh
pnpm test:files
```

This uses disposable independent ONE instances and a local relay to test BLOB
references, byte equality, repeated imports, concurrent folder imports, signed
collection sharing through CHUM, collection-only filtering, live membership,
restart, and revocation. It does not use a live fotos.one account.
