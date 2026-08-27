'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const DEFAULT_AGENT_PROFILE = {
  id: 'claude',
  name: 'Claude padrão',
  runtime: 'claude',
  instructions: ''
};
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_PROFILE_INSTRUCTIONS_LENGTH = 4000;

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('agent profile must be an object');
  }
  if (typeof profile.id !== 'string' || profile.id.length === 0) throw new Error('agent profile id must be a non-empty string');
  if (profile.runtime !== 'claude') throw new Error('agent profile runtime is not supported');
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    throw new Error('agent profile name must not be empty');
  }
  if (profile.name.length > MAX_PROFILE_NAME_LENGTH) {
    throw new Error(`agent profile name must not exceed ${MAX_PROFILE_NAME_LENGTH} characters`);
  }
  if (typeof profile.instructions !== 'string' || profile.instructions.length > MAX_PROFILE_INSTRUCTIONS_LENGTH) {
    throw new Error(`agent profile instructions must not exceed ${MAX_PROFILE_INSTRUCTIONS_LENGTH} characters`);
  }
}

function validateProfiles(profiles) {
  const ids = new Set([DEFAULT_AGENT_PROFILE.id]);
  const names = new Set([DEFAULT_AGENT_PROFILE.name.toLocaleLowerCase()]);
  profiles.forEach((profile) => {
    validateProfile(profile);
    if (ids.has(profile.id)) throw new Error('agent profile ids must be unique');
    const normalizedName = profile.name.trim().toLocaleLowerCase();
    if (names.has(normalizedName)) throw new Error('agent profile names must be unique');
    ids.add(profile.id);
    names.add(normalizedName);
  });
}

function readAgentProfiles(filePath) {
  if (!fs.existsSync(filePath)) return [DEFAULT_AGENT_PROFILE];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('agent profile storage is corrupted');
  }
  if (!data || data.version !== STORE_VERSION || !Array.isArray(data.profiles)) {
    throw new Error('agent profile storage has an unsupported schema');
  }
  validateProfiles(data.profiles);
  return [DEFAULT_AGENT_PROFILE, ...data.profiles];
}

function writeAgentProfiles(filePath, profiles) {
  const customProfiles = profiles.filter((profile) => profile.id !== DEFAULT_AGENT_PROFILE.id);
  validateProfiles(customProfiles);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, profiles: customProfiles }, null, 2));
  fs.renameSync(temporaryPath, filePath);
  return [DEFAULT_AGENT_PROFILE, ...customProfiles];
}

module.exports = {
  DEFAULT_AGENT_PROFILE,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_INSTRUCTIONS_LENGTH,
  validateProfile,
  readAgentProfiles,
  writeAgentProfiles
};
