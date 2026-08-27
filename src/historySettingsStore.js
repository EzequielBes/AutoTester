'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_HISTORY_SETTINGS = Object.freeze({ maxEntries: 250 });
const MIN_HISTORY_ENTRIES = 10;
const MAX_HISTORY_ENTRIES = 10000;

function validateHistorySettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || !Number.isInteger(settings.maxEntries)
    || settings.maxEntries < MIN_HISTORY_ENTRIES
    || settings.maxEntries > MAX_HISTORY_ENTRIES) {
    throw new Error(`history retention must be an integer between ${MIN_HISTORY_ENTRIES} and ${MAX_HISTORY_ENTRIES}`);
  }
  return settings;
}

function readHistorySettings(filePath) {
  if (!fs.existsSync(filePath)) return { ...DEFAULT_HISTORY_SETTINGS };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('history settings storage is corrupted');
  }
  return { ...validateHistorySettings(parsed) };
}

function writeHistorySettings(filePath, settings) {
  const validated = validateHistorySettings(settings);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify(validated, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
  return { ...validated };
}

module.exports = {
  DEFAULT_HISTORY_SETTINGS,
  MIN_HISTORY_ENTRIES,
  MAX_HISTORY_ENTRIES,
  validateHistorySettings,
  readHistorySettings,
  writeHistorySettings
};
