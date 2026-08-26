const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHistory, appendHistoryEntry, incrementAccepted } = require('../src/historyStore');

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

test('returns an empty array when the file is corrupted (non-JSON)', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not valid json truncated by interrupted write');
  assert.deepEqual(readHistory(file), []);
});

test('returns an empty array when the file contains valid JSON that is not an array', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({}));
  assert.deepEqual(readHistory(file), []);
});

test('increments acceptedCount for the matching entry only', () => {
  const file = tmpFile();
  appendHistoryEntry(file, { id: 'a', acceptedCount: 0 });
  appendHistoryEntry(file, { id: 'b', acceptedCount: 0 });
  incrementAccepted(file, 'a');
  incrementAccepted(file, 'a');
  const history = readHistory(file);
  assert.equal(history.find((e) => e.id === 'a').acceptedCount, 2);
  assert.equal(history.find((e) => e.id === 'b').acceptedCount, 0);
});

test('increment on an unknown id is a no-op, not a throw', () => {
  const file = tmpFile();
  appendHistoryEntry(file, { id: 'a', acceptedCount: 0 });
  incrementAccepted(file, 'does-not-exist');
  assert.equal(readHistory(file)[0].acceptedCount, 0);
});
