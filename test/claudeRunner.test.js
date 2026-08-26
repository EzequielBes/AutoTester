const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCliOutput } = require('../src/claudeRunner');

test('extracts and validates findings from a CLI envelope', () => {
  const envelope = JSON.stringify({
    result: JSON.stringify({
      findings: [
        { file: 'a.js', lines: '1-2', severity: 'low', category: 'style', message: 'm', suggestion: 's' }
      ]
    })
  });
  const findings = parseCliOutput(envelope);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'a.js');
});

test('throws when the outer payload is not JSON', () => {
  assert.throws(() => parseCliOutput('not json'), /not valid JSON/);
});

test('throws when the result field is missing', () => {
  assert.throws(() => parseCliOutput(JSON.stringify({})), /missing a string "result"/);
});

test('throws when result is not valid JSON', () => {
  assert.throws(() => parseCliOutput(JSON.stringify({ result: 'not json' })), /"result" field is not valid JSON/);
});

test('throws when findings fail schema validation', () => {
  const envelope = JSON.stringify({ result: JSON.stringify({ findings: [{ file: 'a.js' }] }) });
  assert.throws(() => parseCliOutput(envelope), /does not match the findings schema/);
});
