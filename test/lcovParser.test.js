const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLcov, selectCoverageFiles } = require('../src/lcovParser');

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

test('aggregates coverage only for selected files', () => {
  const coverage = {
    lines: { found: 4, hit: 3, pct: 75 },
    files: [
      { file: 'src/a.js', lines: { found: 2, hit: 2, pct: 100 } },
      { file: 'src/b.js', lines: { found: 2, hit: 1, pct: 50 } }
    ]
  };
  assert.deepEqual(selectCoverageFiles(coverage, ['src/b.js']).lines, { found: 2, hit: 1, pct: 50 });
  assert.throws(() => selectCoverageFiles(coverage, ['src/missing.js']), /no instrumented LCOV lines/);
});
