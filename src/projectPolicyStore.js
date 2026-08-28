'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const MAX_POLICY_ID_LENGTH = 100;
const MAX_POLICY_PATH_LENGTH = 500;
const MAX_EXCERPT_LENGTH = 2000;

function validateText(value, label, { required = false, maxLength = MAX_POLICY_ID_LENGTH } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (required && value.trim().length === 0) throw new Error(`${label} must not be empty`);
  if (value.length > maxLength) throw new Error(`${label} must not exceed ${maxLength} characters`);
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('policy must be an object');
  }
  validateText(policy.id, 'policy.id', { required: true, maxLength: MAX_POLICY_ID_LENGTH });
  validateText(policy.path, 'policy.path', { required: true, maxLength: MAX_POLICY_PATH_LENGTH });
  validateText(policy.excerpt, 'policy.excerpt', { required: true, maxLength: MAX_EXCERPT_LENGTH });
}

function readProjectPolicies(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('project policy storage is corrupted');
  }
  if (!data || !Array.isArray(data.policies)) {
    throw new Error('project policy storage has an unsupported schema');
  }
  if (data.version !== STORE_VERSION) {
    throw new Error('project policy storage has an unsupported schema');
  }
  data.policies.forEach(validatePolicy);
  return data.policies;
}

function writeProjectPolicies(filePath, policies) {
  if (!Array.isArray(policies)) {
    throw new Error('policies must be an array');
  }
  policies.forEach(validatePolicy);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, policies }, null, 2));
  fs.renameSync(temporaryPath, filePath);
  return policies;
}

module.exports = {
  STORE_VERSION,
  MAX_POLICY_ID_LENGTH,
  MAX_POLICY_PATH_LENGTH,
  MAX_EXCERPT_LENGTH,
  readProjectPolicies,
  writeProjectPolicies
};
