const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLcov } = require('../src/lcovParser');

test('parses LCOV line coverage and aggregates duplicate records', () => {
  const coverage = parseLcov([
    'TN:',
    'SF:src/a.js',
    'DA:1,1',
    'DA:2,0',
    'end_of_record',
    'SF:src/a.js',
    'DA:2,3',
    'end_of_record',
    'SF:../external.js',
    'DA:1,1',
    'end_of_record'
  ].join('\r\n'), 'C:\\repo');

  assert.deepEqual(coverage.lines, { found: 2, hit: 2, pct: 100 });
  assert.deepEqual(coverage.files, [{ file: 'src/a.js', lines: { found: 2, hit: 2, pct: 100 } }]);
});

test('rejects invalid LCOV line data', () => {
  assert.throws(() => parseLcov('SF:src/a.js\nDA:0,1\nend_of_record', 'C:\\repo'), /invalid LCOV DA entry/);
});

test('rejects LCOV reports without source lines in the repository', () => {
  assert.throws(() => parseLcov('SF:../external.js\nDA:1,1\nend_of_record', 'C:\\repo'), /no covered source lines/);
});
