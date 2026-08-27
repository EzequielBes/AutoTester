'use strict';

function omitEmpty(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ''
    && (!Array.isArray(value) || value.length > 0)));
}

function toAuditEntry(entry) {
  const decisions = new Map((entry.decisions || []).map((decision) => [decision.findingIndex, decision]));
  const findings = (entry.findings || []).map((finding, index) => omitEmpty({
    index,
    file: finding.file,
    lines: finding.lines,
    severity: finding.severity,
    category: finding.category,
    message: finding.message,
    decision: decisions.get(index) ? {
      outcome: decisions.get(index).outcome,
      timestamp: decisions.get(index).timestamp
    } : null
  }));
  const decisionValues = findings.map((finding) => finding.decision?.outcome);
  const files = (entry.files || []).map((file) => omitEmpty({ path: file, sha256: entry.fileHashes?.[file] }));
  const report = omitEmpty({
    id: entry.id,
    timestamp: entry.timestamp,
    kind: entry.kind,
    status: entry.status,
    source: omitEmpty({ branch: entry.branch, commit: entry.headCommit || entry.commitHash, files }),
    phase: entry.trackId || entry.phaseId ? omitEmpty({
      trackId: entry.trackId,
      trackName: entry.trackName,
      id: entry.phaseId,
      name: entry.phaseName,
      parallel: entry.parallel
    }) : null,
    analysis: omitEmpty({ skill: entry.skillName || entry.skill, intensity: entry.intensity, agentProfile: entry.agentProfileName }),
    findings,
    summary: {
      findings: findings.length,
      applied: decisionValues.filter((value) => value === 'applied').length,
      rejected: decisionValues.filter((value) => value === 'rejected').length,
      pending: findings.filter((finding) => !finding.decision).length
    },
    execution: omitEmpty({ durationMs: entry.durationMs, exitCode: entry.exitCode }),
    coverage: entry.coverage ? { lines: entry.coverage.lines } : null,
    coverageGate: entry.coverageGate ? omitEmpty({
      passed: entry.coverageGate.passed,
      fileScope: entry.coverageGate.fileScope,
      minLinesPct: entry.coverageGate.minLinesPct,
      maxDropPct: entry.coverageGate.maxDropPct,
      lines: entry.coverageGate.lines,
      baseline: entry.coverageGate.baseline,
      failures: entry.coverageGate.failures
    }) : null
  });
  return { format: 'review-gui.audit-entry', version: 1, entry: report };
}

function serializeAuditJson(entry) {
  return JSON.stringify(toAuditEntry(entry), null, 2);
}

function escapeCell(value) {
  return String(value ?? '').replace(/[|\r\n]/g, ' ');
}

function renderAuditMarkdown(entry) {
  const report = toAuditEntry(entry).entry;
  const lines = [`# Entrada de Auditoria \`${report.id}\``, ''];
  ['timestamp', 'kind', 'status'].forEach((key) => {
    if (report[key]) lines.push(`- ${key}: ${report[key]}`);
  });
  if (report.source?.branch) lines.push(`- branch: ${report.source.branch}`);
  if (report.source?.commit) lines.push(`- commit: ${report.source.commit}`);
  if (report.phase?.name) lines.push(`- fase: ${report.phase.trackName || 'trilha'} / ${report.phase.name}`);
  if (report.execution?.durationMs !== undefined) lines.push(`- duração: ${report.execution.durationMs} ms`);
  if (report.execution?.exitCode !== undefined) lines.push(`- exit code: ${report.execution.exitCode}`);
  if (report.findings.length > 0) {
    lines.push('', '## Findings', '', '| # | Local | Severidade | Categoria | Decisão | Evidência |', '| --- | --- | --- | --- | --- | --- |');
    report.findings.forEach((finding) => lines.push(`| ${finding.index} | ${escapeCell(`${finding.file}:${finding.lines}`)} | ${escapeCell(finding.severity)} | ${escapeCell(finding.category)} | ${escapeCell(finding.decision?.outcome || 'pending')} | ${escapeCell(finding.message)} |`));
    lines.push('', `Resumo: ${report.summary.findings} finding(s); ${report.summary.applied} applied; ${report.summary.rejected} rejected; ${report.summary.pending} pending.`);
  }
  if (report.coverage) lines.push('', '## Cobertura', '', `- Linhas: ${report.coverage.lines.hit}/${report.coverage.lines.found} (${report.coverage.lines.pct}%)`);
  if (report.coverageGate) {
    lines.push(`- Gate: ${report.coverageGate.passed ? 'aprovado' : 'reprovado'}`);
    (report.coverageGate.failures || []).forEach((failure) => lines.push(`- Falha: ${failure}`));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { toAuditEntry, serializeAuditJson, renderAuditMarkdown };
