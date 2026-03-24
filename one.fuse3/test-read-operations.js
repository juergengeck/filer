#!/usr/bin/env node

/**
 * READ Operations Test Suite for FUSE3
 * Tests listing directories, reading files, stat, and various edge cases
 * All tests should PASS as read operations are fully implemented
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
const MOUNT_POINT = path.join(TMP_DIR, 'fuse-read-test');

/**
 * In-memory filesystem with read-only operations
 */
class InMemoryFileSystem {
  constructor() {
    this.entries = new Map();
    const now = Date.now();

    // Root directory
    this.entries.set('/', {
      type: 'dir',
      mode: 0o040755,
      children: new Set(['readme.txt', 'welcome.txt', 'docs', 'data']),
      mtime: now,
      atime: now,
      ctime: now
    });

    // Files in root
    this.entries.set('/readme.txt', {
      type: 'file',
      mode: 0o100644,
      content: Buffer.from('This is a test filesystem\nWith multiple lines\nFor testing read operations\n'),
      mtime: now,
      atime: now,
      ctime: now
    });

    this.entries.set('/welcome.txt', {
      type: 'file',
      mode: 0o100644,
      content: Buffer.from('Welcome to the FUSE3 filesystem!\n'),
      mtime: now,
      atime: now,
      ctime: now
    });

    // Subdirectory: docs
    this.entries.set('/docs', {
      type: 'dir',
      mode: 0o040755,
      children: new Set(['guide.txt', 'notes.md']),
      mtime: now,
      atime: now,
      ctime: now
    });

    this.entries.set('/docs/guide.txt', {
      type: 'file',
      mode: 0o100644,
      content: Buffer.from('This is a guide file\nIt has helpful information\nPlease read\n'),
      mtime: now,
      atime: now,
      ctime: now
    });

    this.entries.set('/docs/notes.md', {
      type: 'file',
      mode: 0o100644,
      content: Buffer.from('# Notes\nSome markdown notes here\n'),
      mtime: now,
      atime: now,
      ctime: now
    });

    // Subdirectory: data
    this.entries.set('/data', {
      type: 'dir',
      mode: 0o040755,
      children: new Set(['numbers.txt']),
      mtime: now,
      atime: now,
      ctime: now
    });

    this.entries.set('/data/numbers.txt', {
      type: 'file',
      mode: 0o100644,
      content: Buffer.from('1\n2\n3\n4\n5\n'),
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
}

// Test state
let provider = null;
let memFS = null;
let testsPassed = 0;
let testsFailed = 0;

// Helper to run shell commands
async function runCmd(cmd) {
  const { stdout } = await execAsync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024
  });
  return stdout;
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

// Test runner
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    testsFailed++;
  }
}

// Main test suite
async function runTests() {
  console.log('Starting FUSE3 Read Operations Tests...\n');

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

    // Directory Listing Tests
    console.log('Directory Listing:');
    await test('should list root directory', async () => {
      const output = await runCmd(`ls ${MOUNT_POINT}`);
      assert(output.includes('readme.txt'), 'readme.txt not found');
      assert(output.includes('welcome.txt'), 'welcome.txt not found');
      assert(output.includes('docs'), 'docs not found');
    });

    await test('should list subdirectory', async () => {
      const output = await runCmd(`ls ${MOUNT_POINT}/docs`);
      assert(output.includes('guide.txt'), 'guide.txt not found');
      assert(output.includes('notes.md'), 'notes.md not found');
    });

    await test('should fail to list non-existent directory', async () => {
      try {
        await runCmd(`ls ${MOUNT_POINT}/fakedir`);
        throw new Error('Should have failed');
      } catch (err) {
        assert(err.message.includes('No such file or directory'), 'Wrong error');
      }
    });

    // File Reading Tests
    console.log('\nFile Reading:');
    await test('should read file in root', async () => {
      const output = await runCmd(`cat ${MOUNT_POINT}/readme.txt`);
      assert(output.includes('test filesystem'), 'Wrong content');
    });

    await test('should read file in subdirectory', async () => {
      const output = await runCmd(`cat ${MOUNT_POINT}/docs/guide.txt`);
      assert(output.includes('guide file'), 'Wrong content');
    });

    await test('should fail to read non-existent file', async () => {
      try {
        await runCmd(`cat ${MOUNT_POINT}/nonexistent.txt`);
        throw new Error('Should have failed');
      } catch (err) {
        assert(err.message.includes('No such file or directory'), 'Wrong error');
      }
    });

    await test('should fail to cat a directory', async () => {
      try {
        await runCmd(`cat ${MOUNT_POINT}/docs`);
        throw new Error('Should have failed');
      } catch (err) {
        assert(err.message.includes('Is a directory'), 'Wrong error');
      }
    });

    // Stat Operations
    console.log('\nStat Operations:');
    await test('should stat file', async () => {
      const output = await runCmd(`stat ${MOUNT_POINT}/readme.txt`);
      assert(output.includes('regular file'), 'Wrong file type');
    });

    await test('should stat directory', async () => {
      const output = await runCmd(`stat ${MOUNT_POINT}/docs`);
      assert(output.includes('directory'), 'Wrong file type');
    });

    await test('should fail to stat non-existent path', async () => {
      try {
        await runCmd(`stat ${MOUNT_POINT}/fakedir`);
        throw new Error('Should have failed');
      } catch (err) {
        assert(err.message.includes('No such file or directory'), 'Wrong error');
      }
    });

    // File System Utilities
    console.log('\nFile System Utilities:');
    await test('should find all files', async () => {
      const output = await runCmd(`find ${MOUNT_POINT} -type f`);
      assert(output.includes('readme.txt'), 'readme.txt not found');
      assert(output.includes('guide.txt'), 'guide.txt not found');
    });

    await test('should find all directories', async () => {
      const output = await runCmd(`find ${MOUNT_POINT} -type d`);
      assert(output.includes('docs'), 'docs not found');
      assert(output.includes('data'), 'data not found');
    });

    await test('should grep through files', async () => {
      const output = await runCmd(`grep -r "test" ${MOUNT_POINT}`);
      assert(output.includes('test filesystem'), 'grep result not found');
    });

    await test('should detect file types', async () => {
      const output = await runCmd(`file ${MOUNT_POINT}/readme.txt`);
      assert(output.includes('ASCII text') || output.includes('text'), 'Wrong file type');
    });

    await test('should read first lines with head', async () => {
      const output = await runCmd(`head -1 ${MOUNT_POINT}/readme.txt`);
      assert(output.includes('test filesystem'), 'Wrong content');
    });

    await test('should read last lines with tail', async () => {
      const output = await runCmd(`tail -1 ${MOUNT_POINT}/data/numbers.txt`);
      assert(output.includes('5'), 'Wrong content');
    });

    await test('should count lines/words with wc', async () => {
      const output = await runCmd(`wc -l ${MOUNT_POINT}/readme.txt`);
      assert(output.includes('3'), 'Wrong line count');
    });

    // File Existence Tests
    console.log('\nFile Existence Tests:');
    await test('should confirm file exists', async () => {
      await runCmd(`test -f ${MOUNT_POINT}/readme.txt`);
    });

    await test('should confirm directory exists', async () => {
      await runCmd(`test -d ${MOUNT_POINT}/docs`);
    });

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log(`Total: ${testsPassed + testsFailed}`);
    console.log('='.repeat(50));

    if (testsFailed === 0) {
      console.log('\n✅ All tests passed!');
    } else {
      console.log(`\n❌ ${testsFailed} test(s) failed`);
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
