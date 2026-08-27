const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FINDINGS,
  MAX_FINDING_FILE_LENGTH,
  MAX_FINDING_LINES_LENGTH,
  MAX_FINDING_MESSAGE_LENGTH,
  MAX_FINDING_SUGGESTION_LENGTH,
  validateFindings
} = require('../src/findingsSchema');

test('accepts a well-formed findings object', () => {
  const result = validateFindings({
    findings: [
      { file: 'src/a.js', lines: '10-12', severity: 'high', category: 'security', message: 'x', suggestion: 'y' }
    ]
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('accepts an empty findings array', () => {
  const result = validateFindings({ findings: [] });
  assert.equal(result.valid, true);
});

test('rejects a finding outside the selected file scope', () => {
  const result = validateFindings({
    findings: [
      { file: 'src/other.js', lines: '10', severity: 'low', category: 'bug', message: 'x', suggestion: '' }
    ]
  }, { allowedFiles: ['src/a.js'] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('selected files')));
});

test('rejects an unknown severity value', () => {
  const result = validateFindings({
    findings: [
      { file: 'src/a.js', lines: '10', severity: 'critical', category: 'bug', message: 'x', suggestion: '' }
    ]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('severity')));
});

test('rejects an unknown category value', () => {
  const result = validateFindings({
    findings: [
      { file: 'src/a.js', lines: '10', severity: 'low', category: 'nonsense', message: 'x', suggestion: '' }
    ]
  });
  assert.equal(result.valid, false);
});

test('rejects a malformed lines value', () => {
  const result = validateFindings({
    findings: [
      { file: 'src/a.js', lines: 'ten', severity: 'low', category: 'bug', message: 'x', suggestion: '' }
    ]
  });
  assert.equal(result.valid, false);
});

test('rejects a non-array findings field', () => {
  const result = validateFindings({ findings: 'nope' });
  assert.equal(result.valid, false);
});

test('rejects a non-object root', () => {
  const result = validateFindings(null);
  assert.equal(result.valid, false);
});

test('rejects more findings than the configured limit', () => {
  const finding = { file: 'src/a.js', lines: '1', severity: 'low', category: 'bug', message: 'x', suggestion: '' };
  const result = validateFindings({ findings: Array.from({ length: MAX_FINDINGS + 1 }, () => finding) });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /more than/);
});

test('rejects finding fields beyond their size limits', () => {
  const fields = [
    ['file', MAX_FINDING_FILE_LENGTH],
    ['lines', MAX_FINDING_LINES_LENGTH],
    ['message', MAX_FINDING_MESSAGE_LENGTH],
    ['suggestion', MAX_FINDING_SUGGESTION_LENGTH]
  ];
  fields.forEach(([field, limit]) => {
    const finding = { file: 'src/a.js', lines: '1', severity: 'low', category: 'bug', message: 'x', suggestion: '' };
    finding[field] = field === 'lines' ? '1'.repeat(limit + 1) : 'x'.repeat(limit + 1);
    const result = validateFindings({ findings: [finding] });
    assert.equal(result.valid, false, field);
    assert.ok(result.errors.some((error) => error.includes(`${field} must not exceed ${limit}`)), field);
  });
});
