const test = require('node:test');
const assert = require('node:assert/strict');
const { toAuditEntry, serializeAuditJson, renderAuditMarkdown } = require('../src/historyExport');

function entry() {
  return {
    id: 'audit-1',
    timestamp: '2026-08-27T12:00:00.000Z',
    kind: 'review',
    status: 'passed',
    branch: 'main',
    commitHash: 'abc123',
    repoPath: 'C:\\private\\repo',
    applyRunId: 'ephemeral-apply-token',
    executionId: 'ephemeral-execution-token',
    criteria: 'Internal instructions that must not be exported.',
    command: 'npm test --token super-secret',
    error: 'Command failed at C:\\private\\repo with token super-secret',
    files: ['src/a.js'],
    fileHashes: { 'src/a.js': 'hash-a' },
    findings: [{
      file: 'src/a.js',
      lines: '4-5',
      severity: 'high',
      category: 'security',
      message: 'Validate input before use.',
      suggestion: 'const safe = validate(input);',
      fileContent: 'source code must not leave the machine'
    }],
    decisions: [{ findingIndex: 0, outcome: 'rejected', timestamp: '2026-08-27T12:01:00.000Z' }],
    coverage: { lines: { hit: 9, found: 10, pct: 90 } },
    coverageGate: { passed: true, lines: { hit: 9, found: 10, pct: 90 }, failures: [] },
    logs: { stdout: 'test output with super-secret', stderr: '' }
  };
}

test('exports an allowlisted audit projection without execution capabilities or source content', () => {
  const report = toAuditEntry(entry());
  assert.equal(report.format, 'review-gui.audit-entry');
  assert.equal(report.version, 1);
  assert.equal(report.entry.source.files[0].path, 'src/a.js');
  assert.equal(report.entry.findings[0].decision.outcome, 'rejected');
  assert.deepEqual(report.entry.summary, { findings: 1, applied: 0, rejected: 1, pending: 0 });

  const serialized = serializeAuditJson(entry());
  ['repoPath', 'applyRunId', 'executionId', 'criteria', 'command', 'suggestion', 'fileContent', 'super-secret', 'test output'].forEach((forbidden) => {
    assert.equal(serialized.includes(forbidden), false);
  });
});

test('renders escaped Markdown evidence without raw diagnostics', () => {
  const auditEntry = entry();
  auditEntry.findings[0].message = 'one | two\nthree';

  const report = toAuditEntry(auditEntry);
  assert.equal('logs' in report.entry, false);
  assert.equal('error' in report.entry.execution, false);

  const markdown = renderAuditMarkdown(auditEntry);
  assert.match(markdown, /one   two three/);
  assert.match(markdown, /Resumo: 1 finding\(s\); 0 applied; 1 rejected; 0 pending\./);
});
