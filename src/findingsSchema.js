'use strict';

const SEVERITIES = new Set(['high', 'medium', 'low']);
const CATEGORIES = new Set(['security', 'performance', 'style', 'bug', 'test-coverage']);
const MAX_FINDINGS = 100;
const MAX_FINDING_FILE_LENGTH = 500;
const MAX_FINDING_LINES_LENGTH = 32;
const MAX_FINDING_MESSAGE_LENGTH = 2000;
const MAX_FINDING_SUGGESTION_LENGTH = 16 * 1024;

function validateFindings(parsed, { allowedFiles } = {}) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['root value must be an object'] };
  }
  if (!Array.isArray(parsed.findings)) {
    return { valid: false, errors: ['"findings" must be an array'] };
  }
  if (parsed.findings.length > MAX_FINDINGS) {
    return { valid: false, errors: [`"findings" must not contain more than ${MAX_FINDINGS} items`] };
  }

  const errors = [];
  const allowedFileSet = allowedFiles ? new Set(allowedFiles) : null;
  parsed.findings.forEach((finding, index) => {
    const prefix = `findings[${index}]`;
    if (typeof finding !== 'object' || finding === null) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (typeof finding.file !== 'string' || finding.file.length === 0) {
      errors.push(`${prefix}.file must be a non-empty string`);
    } else if (finding.file.length > MAX_FINDING_FILE_LENGTH) {
      errors.push(`${prefix}.file must not exceed ${MAX_FINDING_FILE_LENGTH} characters`);
    } else if (allowedFileSet && !allowedFileSet.has(finding.file)) {
      errors.push(`${prefix}.file must be one of the selected files`);
    }
    if (typeof finding.lines !== 'string' || !/^\d+(-\d+)?$/.test(finding.lines)) {
      errors.push(`${prefix}.lines must match "N" or "N-M"`);
    } else if (finding.lines.length > MAX_FINDING_LINES_LENGTH) {
      errors.push(`${prefix}.lines must not exceed ${MAX_FINDING_LINES_LENGTH} characters`);
    }
    if (!SEVERITIES.has(finding.severity)) {
      errors.push(`${prefix}.severity must be one of ${[...SEVERITIES].join(', ')}`);
    }
    if (!CATEGORIES.has(finding.category)) {
      errors.push(`${prefix}.category must be one of ${[...CATEGORIES].join(', ')}`);
    }
    if (typeof finding.message !== 'string' || finding.message.length === 0) {
      errors.push(`${prefix}.message must be a non-empty string`);
    } else if (finding.message.length > MAX_FINDING_MESSAGE_LENGTH) {
      errors.push(`${prefix}.message must not exceed ${MAX_FINDING_MESSAGE_LENGTH} characters`);
    }
    if (typeof finding.suggestion !== 'string') {
      errors.push(`${prefix}.suggestion must be a string`);
    } else if (finding.suggestion.length > MAX_FINDING_SUGGESTION_LENGTH) {
      errors.push(`${prefix}.suggestion must not exceed ${MAX_FINDING_SUGGESTION_LENGTH} characters`);
    }
  });

  return { valid: errors.length === 0, errors };
}

module.exports = {
  MAX_FINDINGS,
  MAX_FINDING_FILE_LENGTH,
  MAX_FINDING_LINES_LENGTH,
  MAX_FINDING_MESSAGE_LENGTH,
  MAX_FINDING_SUGGESTION_LENGTH,
  validateFindings,
  SEVERITIES,
  CATEGORIES
};
