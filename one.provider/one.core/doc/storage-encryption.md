# Storage Encryption

Storage encryption is implemented for the browser platform only at this time. The storage backend
 is IndexedDB used as key/value store.

Relevant code files are system dependent `src/system-browser/storage-base.ts` as the file calling
the encryption functions and `src/system-browser/storage-encryption.ts` as the file implementing
them.

## First Start & Setup