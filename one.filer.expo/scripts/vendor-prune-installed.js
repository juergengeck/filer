#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_RC = path.join(PROJECT_ROOT, '.vendorrc.json');
const NODE_MODULES_DIR = path.join(PROJECT_ROOT, 'node_modules');

console.log('🧹 Pruning installed vendored packages...\n');

if (!fs.existsSync(VENDOR_RC)) {
  console.error(`✗ Missing vendor config: ${VENDOR_RC}`);
  process.exit(1);
}

if (!fs.existsSync(NODE_MODULES_DIR)) {
  console.log('ℹ️  node_modules does not exist yet - nothing to prune');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(VENDOR_RC, 'utf8'));

for (const pkg of [...(config.packages ?? []), ...(config.transitivePackages ?? [])]) {
  if (!pkg.name || !pkg.name.includes('/')) {
    continue;
  }

  const [scope, name] = pkg.name.split('/');
  const installedPath = path.join(NODE_MODULES_DIR, scope, name);

  if (fs.existsSync(installedPath)) {
    fs.rmSync(installedPath, { recursive: true, force: true });
    console.log(`✓ Removed ${path.relative(PROJECT_ROOT, installedPath)}`);
  }
}

console.log('\n✅ Installed vendored packages pruned');
