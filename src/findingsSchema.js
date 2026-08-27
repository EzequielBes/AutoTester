'use strict';

const SEVERITIES = new Set(['high', 'medium', 'low']);
const CATEGORIES = new Set(['security', 'performance', 'style', 'bug', 'test-coverage']);

function validateFindings(parsed, { allowedFiles } = {}) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['root value must be an object'] };
  }
  if (!Array.isArray(parsed.findings)) {
    return { valid: false, errors: ['"findings" must be an array'] };
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
    } else if (allowedFileSet && !allowedFileSet.has(finding.file)) {
      errors.push(`${prefix}.file must be one of the selected files`);
    }
    if (typeof finding.lines !== 'string' || !/^\d+(-\d+)?$/.test(finding.lines)) {
      errors.push(`${prefix}.lines must match "N" or "N-M"`);
    }
    if (!SEVERITIES.has(finding.severity)) {
      errors.push(`${prefix}.severity must be one of ${[...SEVERITIES].join(', ')}`);
    }
    if (!CATEGORIES.has(finding.category)) {
      errors.push(`${prefix}.category must be one of ${[...CATEGORIES].join(', ')}`);
    }
    if (typeof finding.message !== 'string' || finding.message.length === 0) {
      errors.push(`${prefix}.message must be a non-empty string`);
    }
    if (typeof finding.suggestion !== 'string') {
      errors.push(`${prefix}.suggestion must be a string`);
    }
  });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateFindings, SEVERITIES, CATEGORIES };
