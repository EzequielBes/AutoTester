const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLineRange, applyFinding } = require('../src/applyFinding');

test('parses a single line number', () => {
  assert.deepEqual(parseLineRange('7'), { start: 7, end: 7 });
});

test('parses a line range', () => {
  assert.deepEqual(parseLineRange('7-9'), { start: 7, end: 9 });
});

test('rejects a malformed range', () => {
  assert.throws(() => parseLineRange('abc'));
});

test('rejects an inverted range', () => {
  assert.throws(() => parseLineRange('9-7'));
});

test('replaces the given line range with the suggestion', () => {
  const content = ['line1', 'line2', 'line3', 'line4'].join('\n');
  const finding = { lines: '2-3', suggestion: 'replaced' };
  const result = applyFinding(content, finding);
  assert.equal(result, 'line1\nreplaced\nline4');
});

test('replaces a single line', () => {
  const content = ['a', 'b', 'c'].join('\n');
  const result = applyFinding(content, { lines: '2', suggestion: 'B' });
  assert.equal(result, 'a\nB\nc');
});

test('removes lines when the suggestion is empty', () => {
  const content = ['a', 'b', 'c'].join('\n');
  const result = applyFinding(content, { lines: '2', suggestion: '' });
  assert.equal(result, 'a\nc');
});

test('rejects a line range outside the file', () => {
  const content = 'only one line';
  assert.throws(() => applyFinding(content, { lines: '5', suggestion: 'x' }));
});
