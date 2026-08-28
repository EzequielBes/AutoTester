const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runValidationTrack } = require('../src/validationRunner');
const { appendHistoryEntry, readHistoryEntry, recordFindingDecision } = require('../src/historyStore');
const { serializeAuditJson } = require('../src/historyExport');

const promptFilePath = path.join(__dirname, '..', 'prompts', 'review-prompt.md');

test('records an approved review, coverage gate, and safe audit export', async () => {
  const historyPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-workflow-')), 'history.json');
  let coverageStateCalls = 0;
  const phaseResults = await runValidationTrack({
    track: {
      phases: [
        { id: 'review', type: 'claude', name: 'Review', agent: 'claude', skill: 'general', intensity: 'quick', criteria: '' },
        {
          id: 'tests', type: 'command', name: 'Tests', command: 'npm test -- --coverage', timeoutMs: 600000,
          lcovPath: 'coverage/lcov.info', expectedExitCode: 0,
          coverageGate: { minLinesPct: 80, maxDropPct: null, fileScope: 'all' }
        }
      ]
    },
    content: '=== src/a.js ===\nconst unsafe = value;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    runReview: async () => [{
      file: 'src/a.js', lines: '1', severity: 'high', category: 'security',
      message: 'Validate the input.', suggestion: 'const safe = validate(value);'
    }],
    runCommandPhase: async () => ({ exitCode: 0, timedOut: false, error: null, durationMs: 15, stdout: 'secret output', stderr: '' }),
    getCoverageFileState: () => ++coverageStateCalls === 1 ? null : { size: 10, mtimeMs: 2, ctimeMs: 2 },
    readCoverage: () => ({ lines: { found: 10, hit: 9, pct: 90 }, files: [] })
  });

  assert.deepEqual(phaseResults.map((phase) => phase.status), ['passed', 'passed']);
  assert.equal(phaseResults[1].coverageGate.passed, true);
  appendHistoryEntry(historyPath, {
    id: 'review-1', kind: 'review', status: 'passed', timestamp: '2026-08-28T12:00:00.000Z',
    branch: 'main', commitHash: 'abc123', files: ['src/a.js'], findings: phaseResults[0].findings, findingsCount: 1, acceptedCount: 0
  });
  appendHistoryEntry(historyPath, {
    id: 'command-1', kind: 'validation-command', status: 'passed', timestamp: '2026-08-28T12:01:00.000Z',
    coverage: phaseResults[1].coverage, coverageGate: phaseResults[1].coverageGate, logs: undefined
  });
  recordFindingDecision(historyPath, 'review-1', 0, 'applied');

  const review = readHistoryEntry(historyPath, 'review-1');
  const report = JSON.parse(serializeAuditJson(review));
  assert.equal(review.acceptedCount, 1);
  assert.equal(report.entry.findings[0].decision.outcome, 'applied');
  assert.equal(JSON.stringify(report).includes('const safe = validate'), false);
  assert.equal(JSON.stringify(report).includes('secret output'), false);
});
