const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFindings } = require('../src/findingsSchema');

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
