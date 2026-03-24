#!/usr/bin/env node
/**
 * Create a test ONE instance for File Provider testing
 * Uses vendored packages from packages/
 */
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Import from vendored packages using file:// URLs
const coreLib = `file://${join(projectRoot, 'packages/one.core/lib')}`;

await import(`${coreLib}/system/load-nodejs.js`);
const {initInstance, closeInstance} = await import(`${coreLib}/instance.js`);
const {setBaseDirOrName} = await import(`${coreLib}/system/storage-base.js`);

const instancePath = process.argv[2] || '/tmp/one-test-instance';

console.log(`Creating test ONE instance at: ${instancePath}`);

try {
    // Set storage directory BEFORE importing load-nodejs
    // (load-nodejs calls initStorage which needs the base dir set)

    // Initialize instance with minimal config
    // initInstance will call setBaseDirOrName with the name parameter
    await initInstance({
        name: instancePath,  // Use full path as name
        wipeStorage: true,
        encryptStorage: false
    });

    console.log('✅ Test instance created successfully');
    console.log(`   Path: ${instancePath}`);

    // Clean shutdown
    await closeInstance();
    process.exit(0);
} catch (error) {
    console.error('❌ Failed to create instance:', error);
    console.error(error.stack);
    process.exit(1);
}
