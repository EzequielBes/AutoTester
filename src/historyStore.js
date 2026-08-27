'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 2;

function readHistory(historyFilePath) {
  if (!fs.existsSync(historyFilePath)) return [];
  const raw = fs.readFileSync(historyFilePath, 'utf8');
  if (raw.trim().length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('history storage is corrupted');
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && parsed.version === STORE_VERSION && Array.isArray(parsed.entries)) return parsed.entries;
  throw new Error('history storage has an unsupported schema');
}

function writeHistory(historyFilePath, entries) {
  const temporaryPath = path.join(path.dirname(historyFilePath), `.${path.basename(historyFilePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, entries }, null, 2));
  fs.renameSync(temporaryPath, historyFilePath);
  return entries;
}

function appendHistoryEntry(historyFilePath, entry, maxEntries) {
  const history = readHistory(historyFilePath);
  history.push(entry);
  if (Number.isInteger(maxEntries) && history.length > maxEntries) {
    history.splice(0, history.length - maxEntries);
  }
  return writeHistory(historyFilePath, history);
}

function retainHistory(historyFilePath, maxEntries) {
  const history = readHistory(historyFilePath);
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || history.length <= maxEntries) return history;
  return writeHistory(historyFilePath, history.slice(-maxEntries));
}

function readHistoryEntry(historyFilePath, entryId) {
  return readHistory(historyFilePath).find((entry) => entry.id === entryId) || null;
}

function recordFindingDecision(historyFilePath, entryId, findingIndex, outcome) {
  if (!['applied', 'rejected'].includes(outcome)) throw new Error('finding decision outcome is invalid');
  const history = readHistory(historyFilePath);
  const entry = history.find((item) => item.id === entryId);
  if (!entry) return history;
  if (!Number.isInteger(findingIndex) || findingIndex < 0 || findingIndex >= (entry.findings || []).length) {
    throw new Error('finding decision index is invalid');
  }
  entry.decisions = entry.decisions || [];
  entry.decisions = entry.decisions.filter((decision) => decision.findingIndex !== findingIndex);
  entry.decisions.push({ findingIndex, outcome, timestamp: new Date().toISOString() });
  entry.acceptedCount = entry.decisions.filter((decision) => decision.outcome === 'applied').length;
  writeHistory(historyFilePath, history);
  return history;
}

module.exports = {
  STORE_VERSION,
  readHistory,
  writeHistory,
  appendHistoryEntry,
  retainHistory,
  readHistoryEntry,
  recordFindingDecision
};
