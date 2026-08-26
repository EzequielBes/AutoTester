'use strict';

const path = require('node:path');

// ponytail: pulled out of main.js so the containment check (a trust-boundary
// guard against adversarial `finding.file` values from model output) is unit
// testable without mocking Electron.
function resolveInRepo(repoPath, relativePath) {
  const root = path.resolve(repoPath);
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error(`path escapes the repository: ${relativePath}`);
  }
  return absolutePath;
}

module.exports = { resolveInRepo };
