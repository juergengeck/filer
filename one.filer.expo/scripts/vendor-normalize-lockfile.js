const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const lockfilePath = path.join(projectRoot, 'pnpm-lock.yaml');
const original = fs.readFileSync(lockfilePath, 'utf8');
let portable = original;

// pnpm 9 resolves peer overrides to absolute paths when it serializes them.
// Keep local vendor pins usable when the checkout lives at another path.
for (const root of new Set([projectRoot, fs.realpathSync(projectRoot)])) {
  const vendorPath = path.join(root, 'vendor').split(path.sep).join('/');
  portable = portable.replaceAll(`file:${vendorPath}/`, 'file:vendor/');
}

if (portable !== original) fs.writeFileSync(lockfilePath, portable);
