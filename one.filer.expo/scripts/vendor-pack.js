#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor');
const VENDOR_RC = path.join(PROJECT_ROOT, '.vendorrc.json');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');

console.log('📦 Vendoring monorepo packages...\n');

// Read configuration
const config = JSON.parse(fs.readFileSync(VENDOR_RC, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
const allPackages = [...config.packages, ...(config.transitivePackages ?? [])];
const [selection, ...extraArgs] = process.argv.slice(2);
if (extraArgs.length || (selection && !selection.startsWith('--packages='))) {
  throw new Error('Usage: vendor-pack.js [--packages=name,name]');
}
const selectedNames = selection ? new Set(selection.slice('--packages='.length).split(',')) : undefined;
const packages = selectedNames ? allPackages.filter(pkg => selectedNames.has(pkg.name)) : allPackages;
if (selectedNames && packages.length !== selectedNames.size) {
  throw new Error('Every selected package must be listed in .vendorrc.json');
}

// Never write through another application's vendor cache.
if (fs.existsSync(VENDOR_DIR) && fs.lstatSync(VENDOR_DIR).isSymbolicLink()) {
  throw new Error('Filer vendor must be a local directory; run vendor:clean before vendor:pack');
}

// Create vendor directory
if (!fs.existsSync(VENDOR_DIR)) {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  console.log(`✓ Created ${VENDOR_DIR}`);
}

// Track all packed tarballs
const packedTarballs = new Map();

// PHASE 1: Pack all packages
console.log('Phase 1: Packing all packages...\n');
for (const pkg of packages) {
  const pkgPath = path.resolve(PROJECT_ROOT, pkg.path);

  console.log(`Packing ${pkg.name} from ${pkg.path}...`);

  if (!fs.existsSync(pkgPath)) {
    console.error(`✗ Package path does not exist: ${pkgPath}`);
    process.exit(1);
  }

  try {
    // Run pnpm pack (resolves catalog: references)
    const env = pkg.workspace
      ? {...process.env, NPM_CONFIG_WORKSPACE_DIR: path.resolve(PROJECT_ROOT, pkg.workspace)}
      : process.env;
    const output = execFileSync('corepack', ['pnpm@9.15.0', 'pack', '--pack-destination', VENDOR_DIR],
      { cwd: pkgPath, encoding: 'utf8', env }
    );

    // Extract tarball filename from output (last line)
    // pnpm pack returns full path, npm pack returns just filename
    const lines = output.trim().split('\n');
    const tarballPath = lines[lines.length - 1].trim();

    if (!tarballPath.endsWith('.tgz')) {
      console.error(`✗ Unexpected pack output: ${tarballPath}`);
      process.exit(1);
    }

    // Extract just the filename from the path
    const tarballName = path.basename(tarballPath);
    // A version label does not identify a local rebuild. pnpm can reuse cached
    // metadata for the old bytes at an unchanged file: path, even with --force.
    const packedPath = path.join(VENDOR_DIR, tarballName);
    const digest = createHash('sha256').update(fs.readFileSync(packedPath)).digest('hex').slice(0, 16);
    const snapshotName = tarballName.replace(/\.tgz$/, `-${digest}.tgz`);
    fs.renameSync(packedPath, path.join(VENDOR_DIR, snapshotName));
    packedTarballs.set(pkg.name, snapshotName);
    console.log(`  ✓ Created vendor/${snapshotName}`);

  } catch (error) {
    console.error(`✗ Failed to pack ${pkg.name}:`);
    console.error(error.message);
    process.exit(1);
  }
}

// PHASE 2: SKIPPED - Dependencies already use '*' which npm will resolve from vendor tarballs
console.log(`\nPhase 2: Skipped (source packages use '*' for inter-package deps)\n`);

// PHASE 3: Update package.json dependencies
console.log(`\nPhase 3: Updating package.json dependencies...\n`);

let updated = 0;
// Internal runtime roots and required transitive dependencies are all local.
const overrides = selectedNames ? {...packageJson.overrides} : {};
const runtimeRoots = new Set(config.packages.map(pkg => pkg.name));
for (const [pkgName, tarballName] of packedTarballs) {
  overrides[pkgName] = `file:./vendor/${tarballName}`;

  // Pin peers at the application root too: peer resolution needs an explicit
  // local provider and must never fetch internal ONE packages from a registry.
  packageJson.dependencies ??= {};
  if (runtimeRoots.has(pkgName)) {
    const oldValue = packageJson.dependencies[pkgName];
    const newValue = `file:./vendor/${tarballName}`;

    if (oldValue !== newValue) {
      packageJson.dependencies[pkgName] = newValue;
      console.log(`  ${pkgName}: ${oldValue} → ${newValue}`);
      updated++;
    }
  }
}

const existingOverrides = JSON.stringify(packageJson.overrides ?? {});
const nextOverrides = JSON.stringify(overrides);
if (existingOverrides !== nextOverrides) {
  packageJson.overrides = overrides;
  updated++;
}

const existingPnpmOverrides = JSON.stringify(packageJson.pnpm?.overrides ?? {});
if (existingPnpmOverrides !== nextOverrides) {
  packageJson.pnpm = {
    ...(packageJson.pnpm ?? {}),
    overrides,
  };
  updated++;
}

if (updated > 0) {
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`\n✓ Updated ${updated} dependencies in package.json`);
} else {
  console.log(`\n✓ All dependencies already up-to-date`);
}

console.log(`\n✅ Vendoring complete!`);
console.log(`\nNext steps:`);
console.log(`  1. Run: pnpm install --ignore-workspace`);
console.log(`     Avoid npm here: it climbs back into the monorepo workspace.`);
console.log(`  2. Run: pnpm run ios\n`);
