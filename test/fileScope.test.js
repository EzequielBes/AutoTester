const test = require('node:test');
const assert = require('node:assert/strict');
const { filterFiles } = require('../src/fileScope');

const files = ['README.md', 'src/a.js', 'src/a.test.js', 'src/nested/b.js', 'test/a.js'];

test('returns every file when no scope is specified', () => {
  assert.deepEqual(filterFiles(files), files);
});

test('filters files using recursive glob patterns', () => {
  assert.deepEqual(filterFiles(files, 'src/**/*.js'), ['src/a.js', 'src/a.test.js', 'src/nested/b.js']);
  assert.deepEqual(filterFiles(files, '**/*.js'), ['src/a.js', 'src/a.test.js', 'src/nested/b.js', 'test/a.js']);
});

test('supports folder scopes and exclusion patterns', () => {
  assert.deepEqual(filterFiles(files, 'src, !**/*.test.js'), ['src/a.js', 'src/nested/b.js']);
});

test('rejects a scope that escapes the repository', () => {
  assert.throws(() => filterFiles(files, '../secrets'), /relative to the repository/);
  assert.throws(() => filterFiles(files, 'src/../../secrets'), /relative to the repository/);
});
