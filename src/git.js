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

function getBranchInfo(repoPath, branch) {
  const baseBranch = detectDefaultBranch(repoPath);
  const isBase = branch === baseBranch;

  let ahead = 0;
  let behind = 0;
  let changedFiles = 0;
  if (!isBase) {
    const counts = git(repoPath, ['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`]).trim();
    const [behindStr, aheadStr] = counts.split(/\s+/);
    behind = Number(behindStr) || 0;
    ahead = Number(aheadStr) || 0;
    changedFiles = listChangedFiles(repoPath, branch).length;
  }

  const [hash, author, date, ...subjectParts] = git(repoPath, [
    'log', '-1', '--format=%H%n%an%n%ad%n%s', '--date=short', branch
  ]).replace(/\n+$/, '').split('\n');

  return {
    baseBranch,
    isBase,
    ahead,
    behind,
    changedFiles,
    lastCommit: {
      hash: (hash || '').slice(0, 7),
      author: author || '',
      date: date || '',
      subject: subjectParts.join('\n')
    }
  };
}

module.exports = { listBranches, listAllFiles, listChangedFiles, detectDefaultBranch, getBranchInfo };
