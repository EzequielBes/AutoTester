'use strict';

const { filterFiles, normalizePattern } = require('./fileScope');

const DEFAULT_DELIVERY_SCOPE = Object.freeze({ files: [], folders: [], glob: '' });
const MAX_SCOPE_ITEMS = 500;
const MAX_EXCEPTION_FILES = 100;
const MAX_JUSTIFICATION_LENGTH = 2000;

function validatePaths(paths, label, maxItems) {
  if (!Array.isArray(paths) || paths.length > maxItems || paths.some((item) => typeof item !== 'string' || !normalizePattern(item))) {
    throw new Error(`${label} must be an array of relative paths`);
  }
  if (new Set(paths).size !== paths.length) throw new Error(`${label} must not contain duplicates`);
}

function validateDeliveryScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('delivery.scope must be an object');
  validatePaths(scope.files, 'delivery.scope.files', MAX_SCOPE_ITEMS);
  validatePaths(scope.folders, 'delivery.scope.folders', MAX_SCOPE_ITEMS);
  if (typeof scope.glob !== 'string') throw new Error('delivery.scope.glob must be a string');
  scope.glob.split(',').forEach((pattern) => normalizePattern(pattern));
}

function isFileInScope(file, scope) {
  validateDeliveryScope(scope);
  const patterns = [...scope.files, ...scope.folders, ...scope.glob.split(',').map((pattern) => pattern.trim()).filter(Boolean)];
  return patterns.length > 0 && filterFiles([file], patterns.join(',')).length === 1;
}

function validateScopeException(exception) {
  if (!exception || typeof exception !== 'object' || Array.isArray(exception)) throw new Error('scope exception must be an object');
  if (typeof exception.id !== 'string' || exception.id.length === 0) throw new Error('scope exception id must be a non-empty string');
  validatePaths(exception.files, 'scope exception files', MAX_EXCEPTION_FILES);
  if (exception.files.length === 0) throw new Error('scope exception files must not be empty');
  if (typeof exception.justification !== 'string' || exception.justification.trim().length === 0 || exception.justification.length > MAX_JUSTIFICATION_LENGTH) {
    throw new Error('scope exception justification must be a non-empty bounded string');
  }
  ['phaseId', 'actorId', 'createdAt'].forEach((key) => {
    if (typeof exception[key] !== 'string' || exception[key].length === 0) throw new Error(`scope exception ${key} must be a non-empty string`);
  });
}

function findScopeViolations(files, scope, exceptions = [], { phaseId, actorId } = {}) {
  if (!Array.isArray(files)) throw new Error('files must be an array');
  exceptions.forEach(validateScopeException);
  return files.filter((file) => !isFileInScope(file, scope) && !exceptions.some((exception) => exception.files.includes(file)
    && exception.phaseId === phaseId && exception.actorId === actorId));
}

module.exports = {
  DEFAULT_DELIVERY_SCOPE,
  validateDeliveryScope,
  validateScopeException,
  isFileInScope,
  findScopeViolations
};
