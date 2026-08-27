'use strict';

function normalizePattern(pattern) {
  const normalized = pattern.trim().replace(/\\/g, '/');
  if (!normalized) return '';
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('scope patterns must be relative to the repository');
  }
  return normalized;
}

function globToRegExp(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`);
}

function patternMatches(file, pattern) {
  if (!/[?*]/.test(pattern)) {
    const directory = pattern.replace(/\/$/, '');
    return file === directory || file.startsWith(`${directory}/`);
  }
  return globToRegExp(pattern).test(file);
}

function filterFiles(files, scope = '') {
  if (!Array.isArray(files)) throw new Error('files must be an array');
  if (typeof scope !== 'string') throw new Error('scope must be a string');
  const patterns = scope.split(',').map(normalizePattern).filter(Boolean);
  const included = patterns.filter((pattern) => !pattern.startsWith('!'));
  const excluded = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  return files.filter((file) => {
    const normalizedFile = file.replace(/\\/g, '/');
    const matchesIncluded = included.length === 0 || included.some((pattern) => patternMatches(normalizedFile, pattern));
    return matchesIncluded && !excluded.some((pattern) => patternMatches(normalizedFile, pattern));
  });
}

module.exports = { normalizePattern, globToRegExp, filterFiles };
