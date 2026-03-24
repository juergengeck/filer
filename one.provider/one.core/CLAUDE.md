# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ONE.core is a TypeScript library implementing a content-addressable object storage system with versioning, synchronization, and CRDT support. It supports multiple platforms (Node.js, browser, React Native) through platform-specific implementations.

## Build and Test Commands

### Building
```bash
npm run build          # Clean build from scratch
```
Build process:
- Cleans existing `lib/` folder and tsbuildinfo cache files
- Runs TypeScript compiler in build mode
- Uses project references (see `tsconfig.json`)
- Output goes to `lib/` directory

### Testing
```bash
npm test               # Run all tests (mocha)
```
- Tests run against built files in `lib/`, not `src/`
- Always build before testing
- Individual test files in `test/src/` (e.g., `*-test.ts`)
- Browser tests: open `test/index.html` in WebStorm

### Documentation
```bash
npm run make-docs      # Generate API documentation
```
- Output: `doc/API/index.html`
- Uses JSDoc comments from source code

### Development Server
```bash
npm run comm-server    # Start communication server for tests
```

## Code Style

From `.cursorrules`:
- Use TypeScript for all code
- **Prefer types over interfaces**
- **Avoid enums; use maps instead**
- **Avoid arrow functions when possible**
- Always write TSDoc for functions
- Use naming conventions:
  - `is` prefix for type guards
  - `get/set` prefix for getters/setters
  - `create/update/delete` prefixes for CRUD operations
- Use concise checks for null/undefined/empty values
- Use `function` keyword for pure functions
- **Import files with `.js` extension** (even for TypeScript files)
- Avoid unnecessary curly braces in conditionals

## Architecture

### Core Concepts

**ONE Objects**: Content-addressable objects stored as microdata (HTML-based format) on disk, JavaScript objects in memory. Each object is identified by SHA-256 hash of its microdata representation.

**Recipes**: Define object schemas (type name, property names/types). Located in `src/recipes.ts` as `CORE_RECIPES`.

**Versioning**:
- **ID Objects**: Virtual objects using only `isId: true` properties, stored with `data-id-object="true"` attribute
- **Version Maps**: Track all versions of an object, stored at ID-hash location
- **Reverse Maps**: Track references from referenced objects back to referencing objects

**Plans**: All object creation goes through Plans. Plans are idempotent - same parameters = same results returned from cache.

### Platform Support

Multi-platform through `src/system/` abstraction:
- `src/system/nodejs/` - Node.js implementations
- `src/system/browser/` - Browser implementations
- `src/system/load-*.ts` - Platform loaders

Build system copies appropriate platform folder to `lib/system/` based on `refinio.platform` in package.json (default: `nodejs`).

Platform-specific modules:
- Storage (filesystem vs IndexedDB)
- Crypto (Node crypto vs WebCrypto API)
- WebSocket handling
- Settings storage
- QUIC transport (Node.js only)

### Key Modules

**Storage Layer**:
- `storage-versioned-objects.ts` - Versioned object storage with CRDT support
  - `storeVersionedObject()` - Main API with `STORE_AS` strategies
  - `STORE_AS.CHANGE` (default) - Sequential updates
  - `STORE_AS.MERGE` - Combining changes from multiple sources
  - `STORE_AS.NO_VERSION_MAP` - Skip version trees
- `storage-unversioned-objects.ts` - Unversioned object storage
- `storage-blob.ts` - BLOB/CLOB storage
- `storage-base-common.ts` - Common storage utilities

**Object Conversion**:
- `object-to-microdata.ts` - JavaScript → microdata
- `microdata-to-object.ts` - microdata → JavaScript
- `microdata-to-json.ts` - Direct microdata → JSON (performance)
- `microdata-exploder.ts` / `microdata-imploder.ts` - Nested object handling

**Instance Management**:
- `instance.ts` - Main instance initialization and management
- `instance-creator.ts` - Create new instances
- `instance-updater.ts` - Update existing instances
- `instance-change-password.ts` - Password changes

**Synchronization**:
- `chum-sync.ts` - CHUM synchronization with optional `objectFilter`
- `chum-exporter.ts` / `chum-importer.ts` - Export/import logic
- `chum-base.ts` - Base CHUM functionality

**CRDTs** (`src/crdts/`):
- `CrdtAlgorithmRegistry.ts` - Algorithm registry
- `VersionTree.ts` - Version tree management
- `diff-objects.ts` / `merge-objects.ts` - Object diff/merge
- `algos/` - CRDT algorithm implementations (Set, Register, OptionalValue, ReferenceToObj)

**Cryptography**:
- `crypto/encryption.ts` - Encryption/decryption
- `crypto/sign.ts` - Signing/verification
- `keychain/` - Key management (master keys, keychain, key storage)

**Utilities** (`src/util/`):
- `sorted-stringify.ts` - Deterministic JSON serialization
- `clone-object.ts` / `clone-one-object.ts` - Deep cloning
- `promise.ts` - Promise utilities with deadlock detection
- `queue.ts` - Queue implementation
- `lru-map.ts` - LRU cache
- `semaphore.ts` - Concurrency control

### TypeScript Type System

ONE.core uses ambient module declaration merging for extensible type definitions:

**@OneObjectInterfaces** (in `@OneObjectInterfaces.d.ts`):
- Empty interfaces that other code augments via declaration merging
- `OneUnversionedObjectInterfaces` - Unversioned object types
- `OneVersionedObjectInterfaces` - Versioned object types
- `OneIdObjectInterfaces` - ID object types

Applications extending ONE.core should create their own `.d.ts` file declaring the same module namespace and adding their types.

## Testing Strategy

- Test files: `test/src/*-test.ts`
- Tests compile to `test/build/*-test.js`
- Run via Mocha with source map support
- Browser testing via `test/index.html`
- Test databases created in `test/testDB/`, `test/Alice/`, `test/Bob/`
- Large DB tests: `test/large-db-*.ts`

## Object Filter for Chum Synchronization

`chum-sync.ts` supports custom filtering via `objectFilter` callback:
```typescript
objectFilter: async (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>
```
- Returns `true` to share object, `false` to filter out
- Default behavior blocks Group/Access/IdAccess objects for security
- Use for certificate-based sharing, custom access control

## Important Notes

- **Always build before testing** - tests run against `lib/`, not `src/`
- **Microdata format is strict** - no spaces/newlines, exact format required for consistent hashing
- **Property order matters** - defined by recipe rules for deterministic hashing
- **Multi-value properties** use `ORDERED_BY.ONE` (sorted by ONE) or `ORDERED_BY.APP` (preserve order)
- **Plans are idempotent** - same inputs always return same results
- **Objects are immutable** - never modified, only new versions created
- **Platform-specific code** in `src/system/[platform]/` folders
