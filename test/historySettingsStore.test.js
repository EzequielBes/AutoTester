const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_HISTORY_SETTINGS, readHistorySettings, writeHistorySettings } = require('../src/historySettingsStore');
const { appendHistoryEntry, readHistory, retainHistory } = require('../src/historyStore');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'history-settings-')), name);
}

test('uses default history retention until settings are saved', () => {
  assert.deepEqual(readHistorySettings(tmpFile('settings.json')), DEFAULT_HISTORY_SETTINGS);
});

test('persists a valid history retention limit and rejects unsafe values', () => {
  const file = tmpFile('settings.json');
  assert.deepEqual(writeHistorySettings(file, { maxEntries: 25 }), { maxEntries: 25 });
  assert.deepEqual(readHistorySettings(file), { maxEntries: 25 });
  assert.throws(() => writeHistorySettings(file, { maxEntries: 9 }), /between 10 and 10000/);
  assert.throws(() => writeHistorySettings(file, { maxEntries: 25.5 }), /integer/);
});

test('retains only the most recent audit entries', () => {
  const file = tmpFile('history.json');
  appendHistoryEntry(file, { id: 'first' });
  appendHistoryEntry(file, { id: 'second' });
  appendHistoryEntry(file, { id: 'third' }, 2);
  assert.deepEqual(readHistory(file).map((entry) => entry.id), ['second', 'third']);
  retainHistory(file, 1);
  assert.deepEqual(readHistory(file).map((entry) => entry.id), ['third']);
});
