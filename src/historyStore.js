'use strict';

const fs = require('node:fs');

function readHistory(historyFilePath) {
  if (!fs.existsSync(historyFilePath)) {
    return [];
  }
  const raw = fs.readFileSync(historyFilePath, 'utf8');
  if (raw.trim().length === 0) {
    return [];
  }
  return JSON.parse(raw);
}

function appendHistoryEntry(historyFilePath, entry) {
  const history = readHistory(historyFilePath);
  history.push(entry);
  fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
  return history;
}

module.exports = { readHistory, appendHistoryEntry };
