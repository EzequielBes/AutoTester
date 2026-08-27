const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHistory, readHistoryEntry, appendHistoryEntry, recordFindingDecision } = require('../src/historyStore');

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

test('rejects a corrupted history file instead of silently discarding it', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not valid json truncated by interrupted write');
  assert.throws(() => readHistory(file), /storage is corrupted/);
});

test('rejects a history file with an unsupported schema', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({}));
  assert.throws(() => readHistory(file), /unsupported schema/);
});

test('reads a detailed history entry by id', () => {
  const file = tmpFile();
  appendHistoryEntry(file, {
    id: 'audit-1',
    kind: 'review',
    findings: [{ file: 'src/a.js', lines: '1', severity: 'low', category: 'style', message: 'x', suggestion: '' }],
    criteria: 'Keep public API stable.'
  });

  const entry = readHistoryEntry(file, 'audit-1');
  assert.equal(entry.criteria, 'Keep public API stable.');
  assert.equal(entry.findings.length, 1);
});

test('records decisions by finding index and derives the accepted count', () => {
  const file = tmpFile();
  appendHistoryEntry(file, {
    id: 'audit-1',
    acceptedCount: 0,
    findings: [{ message: 'first' }, { message: 'second' }]
  });
  recordFindingDecision(file, 'audit-1', 0, 'applied');
  recordFindingDecision(file, 'audit-1', 1, 'rejected');
  recordFindingDecision(file, 'audit-1', 0, 'rejected');

  const entry = readHistoryEntry(file, 'audit-1');
  assert.equal(entry.acceptedCount, 0);
  assert.deepEqual(entry.decisions.map((decision) => decision.outcome).sort(), ['rejected', 'rejected']);
});

test('rejects decisions outside the entry finding range', () => {
  const file = tmpFile();
  appendHistoryEntry(file, { id: 'audit-1', findings: [{ message: 'first' }] });
  assert.throws(() => recordFindingDecision(file, 'audit-1', 1, 'applied'), /index is invalid/);
  assert.throws(() => recordFindingDecision(file, 'audit-1', -1, 'applied'), /index is invalid/);
  assert.throws(() => recordFindingDecision(file, 'audit-1', 0.5, 'applied'), /index is invalid/);
});
