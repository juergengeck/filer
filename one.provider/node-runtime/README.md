# Node.js IPC Runtime for one.provider

This directory contains the Node.js IPC server that bridges Swift File Provider to one.core/one.models.

## Status

✅ **Implementation complete** - The IPC bridge fully initializes ONE.core and delegates to IFileSystem.

## Architecture

The IPC server:
1. Accepts JSON-RPC 2.0 messages over stdin/stdout
2. Initializes ONE.core instance with all recipes and models
3. Creates complete filesystem structure with 7 mounted filesystems:
   - `/chats` - Chat/topic filesystem
   - `/debug` - Debug filesystem
   - `/invites` - Pairing invites
   - `/objects` - ONE objects
   - `/types` - Recipe definitions
   - `/profiles` - User profiles
   - `/questionnaires` - Questionnaires
4. Delegates all file operations to IFileSystem interface

## Implementation Pattern

Follows the pattern from refinio.api/src/index.ts:
- Import all recipes (core, stable, experimental)
- Initialize ONE.core instance with initInstance()
- Initialize all required models (LeuteModel, ChannelManager, TopicModel, etc.)
- Mount all filesystems into root TemporaryFileSystem
- Handle JSON-RPC calls and delegate to filesystem

## Building

```bash
npm install
npm run build
```

Output: `lib/index.js`

## Testing

```bash
npm run test:ipc
```

This spawns the Node.js process and verifies JSON-RPC communication.
