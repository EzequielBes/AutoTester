const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveInRepo } = require('../src/resolveInRepo');

const repo = path.join('C:', 'repo');

test('resolves a normal relative path inside the repo', () => {
  const result = resolveInRepo(repo, 'src/a.js');
  assert.equal(result, path.resolve(repo, 'src/a.js'));
});

test('throws on a path that escapes the repo via ../..', () => {
  assert.throws(
    () => resolveInRepo(repo, '../../.claude/settings.json'),
    /escapes the repository/
  );
});

test('throws on an absolute path outside the repo', () => {
  assert.throws(
    () => resolveInRepo(repo, path.join('C:', 'Windows', 'system.ini')),
    /escapes the repository/
  );
});

test('allows the repo root itself', () => {
  const result = resolveInRepo(repo, '.');
  assert.equal(result, path.resolve(repo));
});
