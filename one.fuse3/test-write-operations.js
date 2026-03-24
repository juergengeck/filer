#!/usr/bin/env node

/**
 * WRITE Operations Test Suite for FUSE3
 * Tests creating files/directories, writing, deleting, renaming, etc.
 * All tests should FAIL as write operations are NOT yet implemented
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IFSFuse3Provider } from './IFSFuse3Provider.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TMP_DIR = path.join(__dirname, '.tmp');
const MOUNT_POINT = path.join(TMP_DIR, 'fuse-write-test');

/**
 * In-memory filesystem (read-only for now - write operations not implemented)
 */
class InMemoryFileSystem {
  constructor() {
    this.entries = new Map();
    const now = Date.now();

    // Root directory
    this.entries.set('/', {
      type: 'dir',
      mode: 0o040755,
      children: new Set(['existing.txt']),
      mtime: now,
      atime: now,
      ctime: now
    });

    // One existing file for testing
    this.entries.set('/existing.txt', {
      type: 'file',
      mode: 0o100644,
      content: Buffer.from('Existing content\n'),
      mtime: now,
      atime: now,
      ctime: now
    });
  }

  async stat(filepath) {
    const entry = this.entries.get(filepath);
    if (!entry) throw new Error('ENOENT');

    return {
      mode: entry.mode,
      size: entry.type === 'file' ? entry.content.length : 0,
      atime: entry.atime,
      mtime: entry.mtime,
      ctime: entry.ctime
    };
  }

  async readDir(dirpath) {
    const entry = this.entries.get(dirpath);
    if (!entry || entry.type !== 'dir') throw new Error('ENOTDIR');
    return { children: Array.from(entry.children) };
  }

  async readFile(filepath) {
    const entry = this.entries.get(filepath);
    if (!entry) throw new Error('ENOENT');
    if (entry.type !== 'file') throw new Error('EISDIR');
    return { content: entry.content };
  }

  async open(filepath, flags) {
    const entry = this.entries.get(filepath);
    if (!entry) throw new Error('ENOENT');
    return { fd: 0, entry };
  }

  async read(fd, buffer, offset, length, position) {
    const content = fd.entry.content;
    const bytesToRead = Math.min(length, content.length - position);
    content.copy(buffer, offset, position, position + bytesToRead);
    return bytesToRead;
  }

  async close(fd) {
    return;
  }

  // Write operations - NOT IMPLEMENTED (will throw errors)
  // These would need to be implemented in the FUSE layer
}

// Test state
let provider = null;
let memFS = null;
let testsPassed = 0;
let testsFailed = 0;

// Helper to run shell commands
async function runCmd(cmd) {
  const { stdout, stderr } = await execAsync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024
  });
  return { stdout, stderr };
}

// Cleanup function
async function cleanup() {
  // Unmount if mounted
  try {
    await execAsync(`fusermount3 -uz "${MOUNT_POINT}" 2>/dev/null || fusermount -uz "${MOUNT_POINT}" 2>/dev/null || true`);
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (e) {
    // Ignore
  }

  // Remove directory tree using shell command (more robust than fs.rmSync for mount points)
  try {
    await execAsync(`rm -rf "${TMP_DIR}" 2>/dev/null || true`);
  } catch (e) {
    // Ignore
  }
}

// Test assertion
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Test runner (expects failure for write operations)
async function test(name, fn, shouldFail = true) {
  try {
    await fn();
    if (shouldFail) {
      console.log(`✗ ${name} (should have failed but passed - write operations not implemented)`);
      testsFailed++;
    } else {
      console.log(`✓ ${name}`);
      testsPassed++;
    }
  } catch (err) {
    if (shouldFail) {
      console.log(`✓ ${name} (correctly failed: ${err.message.split('\n')[0]})`);
      testsPassed++;
    } else {
      console.error(`✗ ${name}`);
      console.error(`  ${err.message}`);
      testsFailed++;
    }
  }
}

// Main test suite
async function runTests() {
  console.log('Starting FUSE3 Write Operations Tests...');
  console.log('NOTE: All tests should FAIL as write operations are NOT implemented\n');

  try {
    // Setup
    await cleanup();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(MOUNT_POINT, { recursive: true });

    memFS = new InMemoryFileSystem();
    provider = new IFSFuse3Provider({
      fileSystem: memFS,
      virtualRoot: MOUNT_POINT,
      debug: false
    });

    await provider.start(MOUNT_POINT);
    await new Promise(resolve => setTimeout(resolve, 200));

    // File Creation Tests
    console.log('File Creation:');
    await test('should fail to create new file with touch', async () => {
      await runCmd(`touch ${MOUNT_POINT}/newfile.txt`);
      // Verify it doesn't exist
      await runCmd(`test -f ${MOUNT_POINT}/newfile.txt`);
    }, true);

    await test('should fail to create file with echo redirect', async () => {
      await runCmd(`echo "test" > ${MOUNT_POINT}/created.txt`);
    }, true);

    // Directory Creation Tests
    console.log('\nDirectory Creation:');
    await test('should fail to create directory', async () => {
      await runCmd(`mkdir ${MOUNT_POINT}/newdir`);
      await runCmd(`test -d ${MOUNT_POINT}/newdir`);
    }, true);

    await test('should fail to create nested directories', async () => {
      await runCmd(`mkdir -p ${MOUNT_POINT}/path/to/dir`);
    }, true);

    // File Writing Tests
    console.log('\nFile Writing:');
    await test('should fail to write to existing file', async () => {
      await runCmd(`echo "new content" > ${MOUNT_POINT}/existing.txt`);
      const result = await runCmd(`cat ${MOUNT_POINT}/existing.txt`);
      assert(result.stdout.includes('new content'), 'Content not updated');
    }, true);

    await test('should fail to append to file', async () => {
      await runCmd(`echo "appended" >> ${MOUNT_POINT}/existing.txt`);
    }, true);

    // File Deletion Tests
    console.log('\nFile Deletion:');
    await test('should fail to delete file', async () => {
      await runCmd(`rm ${MOUNT_POINT}/existing.txt`);
      // Verify it's gone
      try {
        await runCmd(`test -f ${MOUNT_POINT}/existing.txt`);
        throw new Error('File still exists');
      } catch (e) {
        // File should be gone, so this error is expected
      }
    }, true);

    // Copy/Move Tests
    console.log('\nCopy/Move Operations:');
    await test('should fail to copy file', async () => {
      await runCmd(`cp ${MOUNT_POINT}/existing.txt ${MOUNT_POINT}/copy.txt`);
      await runCmd(`test -f ${MOUNT_POINT}/copy.txt`);
    }, true);

    await test('should fail to move/rename file', async () => {
      await runCmd(`mv ${MOUNT_POINT}/existing.txt ${MOUNT_POINT}/renamed.txt`);
      await runCmd(`test -f ${MOUNT_POINT}/renamed.txt`);
    }, true);

    // Permissions Tests
    console.log('\nPermissions:');
    await test('should fail to change file permissions', async () => {
      await runCmd(`chmod 777 ${MOUNT_POINT}/existing.txt`);
      const result = await runCmd(`stat -c "%a" ${MOUNT_POINT}/existing.txt`);
      assert(result.stdout.trim() === '777', 'Permissions not changed');
    }, true);

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log(`Total: ${testsPassed + testsFailed}`);
    console.log('='.repeat(50));

    if (testsPassed === (testsPassed + testsFailed) && testsFailed === 0) {
      console.log('\n✅ All tests correctly failed (write operations not implemented)');
    } else if (testsFailed > 0) {
      console.log(`\n❌ ${testsFailed} test(s) behaved unexpectedly`);
    }

  } finally {
    // Cleanup
    if (provider) {
      try {
        await provider.stop();
      } catch (e) {
        console.warn('Warning: failed to stop provider');
      }
    }
    await cleanup();
  }

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests();
