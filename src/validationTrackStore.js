'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SKILL_HEADINGS, INTENSITY_HEADINGS } = require('./promptBuilder');

const STORE_VERSION = 2;
const MAX_NAME_LENGTH = 100;
const MAX_CRITERIA_LENGTH = 2000;
const MAX_COMMAND_LENGTH = 2000;
const MAX_LCOV_PATH_LENGTH = 500;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 3600000;
const SUPPORTED_AGENTS = new Set(['claude']);

function validateText(value, label, { required = false, maxLength = MAX_NAME_LENGTH } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (required && value.trim().length === 0) throw new Error(`${label} must not be empty`);
  if (value.length > maxLength) throw new Error(`${label} must not exceed ${maxLength} characters`);
}

function validateRelativePath(value, label) {
  validateText(value, label, { maxLength: MAX_LCOV_PATH_LENGTH });
  if (!value) return;
  const normalized = path.normalize(value);
  if (path.isAbsolute(value) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must stay inside the repository`);
  }
}

function validateClaudePhase(phase) {
  if (!SUPPORTED_AGENTS.has(phase.agent)) throw new Error('phase.agent is not supported');
  if (!SKILL_HEADINGS[phase.skill]) throw new Error('phase.skill is not supported');
  if (!INTENSITY_HEADINGS[phase.intensity]) throw new Error('phase.intensity is not supported');
  validateText(phase.criteria, 'phase.criteria', { maxLength: MAX_CRITERIA_LENGTH });
}

function validateCommandPhase(phase) {
  validateText(phase.command, 'phase.command', { required: true, maxLength: MAX_COMMAND_LENGTH });
  if (!Number.isInteger(phase.timeoutMs) || phase.timeoutMs < MIN_TIMEOUT_MS || phase.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`phase.timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  }
  validateRelativePath(phase.lcovPath, 'phase.lcovPath');
  if (!Number.isInteger(phase.expectedExitCode) || phase.expectedExitCode < 0 || phase.expectedExitCode > 255) {
    throw new Error('phase.expectedExitCode must be between 0 and 255');
  }
}

function validatePhase(phase) {
  if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
    throw new Error('phase must be an object');
  }
  if (typeof phase.id !== 'string' || phase.id.length === 0) throw new Error('phase.id must be a non-empty string');
  validateText(phase.name, 'phase.name', { required: true });
  if (phase.type === 'claude') {
    validateClaudePhase(phase);
  } else if (phase.type === 'command') {
    validateCommandPhase(phase);
  } else {
    throw new Error('phase.type is not supported');
  }
}

function validateTrack(track) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) {
    throw new Error('track must be an object');
  }
  if (typeof track.id !== 'string' || track.id.length === 0) throw new Error('track.id must be a non-empty string');
  validateText(track.name, 'track.name', { required: true });
  if (!Array.isArray(track.phases) || track.phases.length === 0) {
    throw new Error('track.phases must contain at least one phase');
  }
  const phaseIds = new Set();
  track.phases.forEach((phase) => {
    validatePhase(phase);
    if (phaseIds.has(phase.id)) throw new Error('track phase ids must be unique');
    phaseIds.add(phase.id);
  });
}

function migrateV1Track(track) {
  return {
    ...track,
    phases: track.phases.map((phase) => ({ ...phase, type: 'claude' }))
  };
}

function readValidationTracks(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('validation track storage is corrupted');
  }
  if (!data || !Array.isArray(data.tracks)) {
    throw new Error('validation track storage has an unsupported schema');
  }
  const tracks = data.version === 1
    ? data.tracks.map(migrateV1Track)
    : data.version === STORE_VERSION ? data.tracks : null;
  if (!tracks) throw new Error('validation track storage has an unsupported schema');
  tracks.forEach(validateTrack);
  return tracks;
}

function writeValidationTracks(filePath, tracks) {
  tracks.forEach(validateTrack);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, tracks }, null, 2));
  fs.renameSync(temporaryPath, filePath);
  return tracks;
}

module.exports = {
  STORE_VERSION,
  MAX_NAME_LENGTH,
  MAX_CRITERIA_LENGTH,
  MAX_COMMAND_LENGTH,
  MAX_LCOV_PATH_LENGTH,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  SUPPORTED_AGENTS,
  validateTrack,
  readValidationTracks,
  writeValidationTracks
};
