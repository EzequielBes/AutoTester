'use strict';

const { execFileSync } = require('node:child_process');

function git(repoPath, args) {
  // core.quotePath=false: without it, git octal-escapes non-ASCII filenames
  // (e.g. "café.js" -> "caf\303\251.js") in ls-files/diff output, which then
  // fail to open as real paths.
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: repoPath, encoding: 'utf8' });
}

function listBranches(repoPath) {
  const out = git(repoPath, ['branch', '--format=%(refname:short)']);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function detectDefaultBranch(repoPath) {
  for (const candidate of ['main', 'master']) {
    try {
      git(repoPath, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error('could not find a "main" or "master" branch');
}

function listAllFiles(repoPath) {
  const out = git(repoPath, ['ls-files']);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function listChangedFiles(repoPath, branch) {
  const baseBranch = detectDefaultBranch(repoPath);
  if (branch === baseBranch) {
    return [];
  }
  const out = git(repoPath, ['diff', '--name-only', `${baseBranch}...${branch}`]);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

module.exports = { listBranches, listAllFiles, listChangedFiles, detectDefaultBranch };
