const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { listBranches, listAllFiles, listChangedFiles, getBranchInfo } = require('../src/git');

function run(cwd, args) {
  execFileSync('git', args, { cwd });
}

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-fixture-'));
  run(dir, ['init', '--initial-branch=main']);
  run(dir, ['config', 'user.email', 'test@example.com']);
  run(dir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  run(dir, ['add', 'a.txt']);
  run(dir, ['commit', '-m', 'initial']);
  run(dir, ['checkout', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'world\n');
  run(dir, ['add', 'b.txt']);
  run(dir, ['commit', '-m', 'add b']);
  return dir;
}

test('lists branches including main and feature', () => {
  const dir = makeFixtureRepo();
  const branches = listBranches(dir);
  assert.ok(branches.includes('main'));
  assert.ok(branches.includes('feature'));
});

test('lists all tracked files', () => {
  const dir = makeFixtureRepo();
  const files = listAllFiles(dir);
  assert.deepEqual(files.sort(), ['a.txt', 'b.txt']);
});

test('lists only files changed on the feature branch vs main', () => {
  const dir = makeFixtureRepo();
  const changed = listChangedFiles(dir, 'feature');
  assert.deepEqual(changed, ['b.txt']);
});

test('returns no changed files for the default branch itself', () => {
  const dir = makeFixtureRepo();
  const changed = listChangedFiles(dir, 'main');
  assert.deepEqual(changed, []);
});

test('lists a non-ASCII filename verbatim instead of octal-quoted', () => {
  const dir = makeFixtureRepo();
  const accented = 'café.txt';
  fs.writeFileSync(path.join(dir, accented), 'ola\n');
  run(dir, ['add', accented]);
  run(dir, ['commit', '-m', 'add accented file']);

  const files = listAllFiles(dir);
  assert.ok(files.includes(accented), `expected ${JSON.stringify(files)} to include ${accented}`);
});

test('branch info for the default branch has no ahead/behind/changed count', () => {
  const dir = makeFixtureRepo();
  const info = getBranchInfo(dir, 'main');
  assert.equal(info.isBase, true);
  assert.equal(info.ahead, 0);
  assert.equal(info.behind, 0);
  assert.equal(info.changedFiles, 0);
  assert.equal(info.lastCommit.subject, 'initial');
});

test('branch info for a feature branch reports ahead count and changed files', () => {
  const dir = makeFixtureRepo();
  const info = getBranchInfo(dir, 'feature');
  assert.equal(info.isBase, false);
  assert.equal(info.baseBranch, 'main');
  assert.equal(info.ahead, 1);
  assert.equal(info.behind, 0);
  assert.equal(info.changedFiles, 1);
  assert.equal(info.lastCommit.subject, 'add b');
  assert.equal(info.lastCommit.hash.length, 7);
});
