const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHistory, appendHistoryEntry } = require('../src/historyStore');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
  return path.join(dir, 'history.json');
}

test('returns an empty array when the file does not exist yet', () => {
  const file = tmpFile();
  assert.deepEqual(readHistory(file), []);
});

test('appends an entry and persists it to disk', () => {
  const file = tmpFile();
  appendHistoryEntry(file, { branch: 'main', skill: 'general' });
  const history = readHistory(file);
  assert.equal(history.length, 1);
  assert.equal(history[0].branch, 'main');
});

test('appends a second entry without losing the first', () => {
  const file = tmpFile();
  appendHistoryEntry(file, { branch: 'main' });
  appendHistoryEntry(file, { branch: 'feature' });
  const history = readHistory(file);
  assert.equal(history.length, 2);
  assert.equal(history[1].branch, 'feature');
});
