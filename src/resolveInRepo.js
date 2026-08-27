'use strict';

const path = require('node:path');
const fs = require('node:fs');

// ponytail: pulled out of main.js so the containment check (a trust-boundary
// guard against adversarial `finding.file` values from model output) is unit
// testable without mocking Electron.
function resolveInRepo(repoPath, relativePath) {
  const requestedRoot = path.resolve(repoPath);
  const root = fs.existsSync(requestedRoot) ? fs.realpathSync(requestedRoot) : requestedRoot;
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error(`path escapes the repository: ${relativePath}`);
  }
  if (!fs.existsSync(absolutePath)) return absolutePath;

  const realPath = fs.realpathSync(absolutePath);
  if (realPath !== root && !realPath.startsWith(root + path.sep)) {
    throw new Error(`path escapes the repository through a symbolic link: ${relativePath}`);
  }
  return realPath;
}

module.exports = { resolveInRepo };
