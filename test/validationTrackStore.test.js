const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateTrack,
  readValidationTracks,
  writeValidationTracks
} = require('../src/validationTrackStore');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-tracks-'));
  return path.join(dir, 'validation-tracks.json');
}

function track() {
  return {
    id: 'track-1',
    name: 'Pre-merge',
    phases: [
      {
        id: 'phase-1',
        type: 'claude',
        name: 'Security',
        agent: 'claude',
        skill: 'security',
        intensity: 'full',
        criteria: 'Check authorization.'
      }
    ]
  };
}

test('returns no tracks before the store exists', () => {
  assert.deepEqual(readValidationTracks(tmpFile()), []);
});

test('writes a versioned track store and reads it back', () => {
  const file = tmpFile();
  const tracks = [track()];
  writeValidationTracks(file, tracks);

  assert.deepEqual(readValidationTracks(file), tracks);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 3);
});

test('accepts a profile id and rejects a missing phase agent id', () => {
  const invalid = track();
  invalid.phases[0].agent = 'other-agent';
  assert.doesNotThrow(() => validateTrack(invalid));
  invalid.phases[0].agent = '';
  assert.throws(() => validateTrack(invalid), /agent must be a non-empty string/);
});

test('rejects a corrupted track store instead of silently discarding it', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');
  assert.throws(() => readValidationTracks(file), /storage is corrupted/);
});

test('migrates version 1 Claude phases to version 2 in memory', () => {
  const file = tmpFile();
  const legacy = track();
  delete legacy.phases[0].type;
  fs.writeFileSync(file, JSON.stringify({ version: 1, tracks: [legacy] }));

  assert.equal(readValidationTracks(file)[0].phases[0].type, 'claude');
});

test('rejects command phases with a coverage path outside the repository', () => {
  const invalid = track();
  invalid.phases = [{
    id: 'phase-1',
    type: 'command',
    name: 'Tests',
    command: 'npm test',
    timeoutMs: 600000,
    lcovPath: '../coverage/lcov.info',
    expectedExitCode: 0
  }];
  assert.throws(() => validateTrack(invalid), /must stay inside the repository/);
});

test('rejects a Claude phase with a non-boolean parallel setting', () => {
  const invalid = track();
  invalid.phases[0].parallel = 'yes';
  assert.throws(() => validateTrack(invalid), /parallel must be a boolean/);
});

test('rejects a coverage gate without an LCOV path', () => {
  const invalid = track();
  invalid.phases = [{
    id: 'tests',
    type: 'command',
    name: 'Tests',
    command: 'npm test',
    timeoutMs: 600000,
    lcovPath: '',
    expectedExitCode: 0,
    coverageGate: { minLinesPct: 80, maxDropPct: null, fileScope: 'all' }
  }];
  assert.throws(() => validateTrack(invalid), /requires phase.lcovPath/);
});

test('accepts opt-in log persistence and rejects malformed values', () => {
  const valid = track();
  valid.phases = [{
    id: 'tests', type: 'command', name: 'Tests', command: 'npm test', timeoutMs: 600000,
    lcovPath: '', expectedExitCode: 0, persistLogs: true
  }];
  assert.doesNotThrow(() => validateTrack(valid));
  valid.phases[0].persistLogs = 'yes';
  assert.throws(() => validateTrack(valid), /persistLogs must be a boolean/);
});
