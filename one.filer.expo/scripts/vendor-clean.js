#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor');

console.log('🧹 Cleaning vendor directory...\n');

if (fs.existsSync(VENDOR_DIR)) {
  fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  console.log(`✓ Removed ${VENDOR_DIR}`);
  console.log(`\n✅ Vendor directory cleaned!`);
} else {
  console.log(`ℹ️  Vendor directory doesn't exist - nothing to clean`);
}
