const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_AGENT_PROFILE,
  validateProfile,
  readAgentProfiles,
  writeAgentProfiles
} = require('../src/agentProfileStore');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profiles-'));
  return path.join(dir, 'agent-profiles.json');
}

function profile() {
  return { id: 'security', runtime: 'claude', name: 'Security specialist', instructions: 'Prioritize authorization.' };
}

test('returns the immutable default Claude profile before storage exists', () => {
  assert.deepEqual(readAgentProfiles(tmpFile()), [DEFAULT_AGENT_PROFILE]);
});

test('writes and reads custom Claude profiles alongside the default profile', () => {
  const file = tmpFile();
  const profiles = writeAgentProfiles(file, [DEFAULT_AGENT_PROFILE, profile()]);
  assert.deepEqual(readAgentProfiles(file), profiles);
});

test('rejects unsupported profile runtimes', () => {
  const invalid = profile();
  invalid.runtime = 'other-cli';
  assert.throws(() => validateProfile(invalid), /runtime is not supported/);
});

test('rejects a custom profile with the default profile name', () => {
  const file = tmpFile();
  const invalid = profile();
  invalid.name = DEFAULT_AGENT_PROFILE.name;
  assert.throws(() => writeAgentProfiles(file, [DEFAULT_AGENT_PROFILE, invalid]), /names must be unique/);
});
