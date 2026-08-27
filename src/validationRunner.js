'use strict';

const { buildSystemPrompt } = require('./promptBuilder');
const { runClaudeReview } = require('./claudeRunner');
const { validateFindings } = require('./findingsSchema');
const { runCommand } = require('./commandRunner');
const { readLcovCoverage, selectCoverageFiles } = require('./lcovParser');
const { DEFAULT_QUALITY_SKILLS } = require('./qualitySkillStore');

const MAX_CLAUDE_CONCURRENCY = 2;

async function runClaudePhase(phase, { content, allowedFiles, promptFilePath, agentProfiles, qualitySkills, runReview, signal, onPhaseProgress }) {
  onPhaseProgress?.({ phaseId: phase.id, phaseName: phase.name, phaseType: 'claude', parallel: phase.parallel === true, status: 'running' });
  try {
    const profile = agentProfiles.find((item) => item.id === phase.agent);
    if (!profile || profile.runtime !== 'claude') throw new Error('selected agent profile is not available');
    const skill = qualitySkills.find((item) => item.id === phase.skill);
    if (!skill) throw new Error('selected quality skill is not available');
    const systemPrompt = buildSystemPrompt(
      promptFilePath,
      skill.baseSkill,
      phase.intensity,
      phase.criteria,
      profile.instructions,
      skill.instructions
    );
    const findings = await runReview(systemPrompt, content, { signal });
    const validation = validateFindings({ findings }, { allowedFiles });
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    const result = {
      type: 'claude',
      phaseId: phase.id,
      phaseName: phase.name,
      agentProfileId: profile.id,
      agentProfileName: profile.name,
      agentRuntime: profile.runtime,
      skill: phase.skill,
      skillName: skill.name,
      findings,
      canApply: skill.canApply,
      parallel: phase.parallel === true,
      status: 'passed'
    };
    onPhaseProgress?.({ phaseId: phase.id, phaseName: phase.name, phaseType: 'claude', parallel: result.parallel, status: result.status, result });
    return result;
  } catch (error) {
    const status = error.code === 'TRACK_CANCELLED' ? 'cancelled' : error.code === 'CLAUDE_TIMEOUT' ? 'timed-out' : 'failed';
    const result = {
      type: 'claude',
      phaseId: phase.id,
      phaseName: phase.name,
      agentProfileId: phase.agent,
      skill: phase.skill,
      findings: [],
      canApply: false,
      parallel: phase.parallel === true,
      status,
      error: error.message
    };
    onPhaseProgress?.({ phaseId: phase.id, phaseName: phase.name, phaseType: 'claude', parallel: result.parallel, status: result.status, result });
    return result;
  }
}

async function runClaudeBatch(phases, options) {
  const results = new Array(phases.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < phases.length && !options.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runClaudePhase(phases[index], options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CLAUDE_CONCURRENCY, phases.length) }, worker));
  return results.filter(Boolean);
}

function evaluateCoverageGate(gate, coverage, allowedFiles, baseline) {
  if (!gate) return null;
  const scopedCoverage = gate.fileScope === 'selected' ? selectCoverageFiles(coverage, allowedFiles) : coverage;
  const failures = [];
  if (gate.minLinesPct !== null && gate.minLinesPct !== undefined && scopedCoverage.lines.pct < gate.minLinesPct) {
    failures.push(`line coverage ${scopedCoverage.lines.pct}% is below the minimum ${gate.minLinesPct}%`);
  }
  if (baseline && gate.maxDropPct !== null && gate.maxDropPct !== undefined
    && scopedCoverage.lines.pct < baseline.pct - gate.maxDropPct) {
    failures.push(`line coverage dropped from ${baseline.pct}% beyond the allowed ${gate.maxDropPct} percentage points`);
  }
  return { ...gate, lines: scopedCoverage.lines, baseline: baseline || null, passed: failures.length === 0, failures };
}

async function runCommandPhase(phase, { repoPath, allowedFiles, coverageBaseline, runCommandPhase: runCommandImpl, readCoverage, signal, onPhaseProgress }) {
  onPhaseProgress?.({ phaseId: phase.id, phaseName: phase.name, phaseType: 'command', parallel: false, status: 'running' });
  const commandResult = await runCommandImpl({ command: phase.command, cwd: repoPath, timeoutMs: phase.timeoutMs, signal });
  if (commandResult.cancelled) {
    const result = { type: 'command', phaseId: phase.id, phaseName: phase.name, parallel: false, status: 'cancelled', commandResult, coverage: null, error: null };
    onPhaseProgress?.({ phaseId: phase.id, phaseName: phase.name, phaseType: 'command', parallel: false, status: result.status, result });
    return result;
  }
  let status = commandResult.timedOut ? 'timed-out' : 'failed';
  let error = commandResult.error;
  let coverage = null;
  let coverageGate = null;
  if (!commandResult.timedOut && !commandResult.error && commandResult.exitCode === phase.expectedExitCode) {
    try {
      coverage = phase.lcovPath ? readCoverage(repoPath, phase.lcovPath) : null;
      coverageGate = evaluateCoverageGate(phase.coverageGate, coverage, allowedFiles, coverageBaseline);
      if (coverageGate && !coverageGate.passed) {
        error = coverageGate.failures.join('; ');
      } else {
        status = 'passed';
      }
    } catch (coverageError) {
      error = coverageError.message;
    }
  } else if (!error) {
    error = `command exited with code ${commandResult.exitCode}; expected ${phase.expectedExitCode}`;
  }
  const result = { type: 'command', phaseId: phase.id, phaseName: phase.name, parallel: false, status, commandResult, coverage, coverageGate, error };
  onPhaseProgress?.({ phaseId: phase.id, phaseName: phase.name, phaseType: 'command', parallel: false, status: result.status, result });
  return result;
}

async function runValidationTrack({
  track,
  content,
  allowedFiles,
  repoPath,
  agentProfiles = [{ id: 'claude', name: 'Claude padrão', runtime: 'claude', instructions: '' }],
  qualitySkills = DEFAULT_QUALITY_SKILLS,
  promptFilePath,
  runReview = runClaudeReview,
  runCommandPhase: runCommandImpl = runCommand,
  readCoverage = readLcovCoverage,
  coverageBaselines = {},
  signal,
  onPhaseProgress
}) {
  const results = [];
  let index = 0;
  const claudeOptions = { content, allowedFiles, promptFilePath, agentProfiles, qualitySkills, runReview, signal, onPhaseProgress };
  track.phases.forEach((phase) => onPhaseProgress?.({
    phaseId: phase.id,
    phaseName: phase.name,
    phaseType: phase.type,
    parallel: phase.parallel === true,
    status: 'queued'
  }));
  while (index < track.phases.length) {
    if (signal?.aborted) break;
    const phase = track.phases[index];
    let batch;
    if (phase.type === 'claude') {
      const parallel = phase.parallel === true;
      batch = [phase];
      index += 1;
      if (parallel) {
        while (index < track.phases.length && track.phases[index].type === 'claude' && track.phases[index].parallel === true) {
          batch.push(track.phases[index]);
          index += 1;
        }
      }
      const batchResults = parallel
        ? await runClaudeBatch(batch, claudeOptions)
        : [await runClaudePhase(phase, claudeOptions)];
      results.push(...batchResults);
      if (batchResults.some((result) => result.status !== 'passed')) break;
    } else {
      const commandResult = await runCommandPhase(phase, {
        repoPath,
        allowedFiles,
        coverageBaseline: coverageBaselines[phase.id],
        runCommandPhase: runCommandImpl,
        readCoverage,
        signal,
        onPhaseProgress
      });
      results.push(commandResult);
      index += 1;
      if (commandResult.status !== 'passed') break;
    }
  }
  return results;
}

module.exports = { MAX_CLAUDE_CONCURRENCY, runClaudePhase, runClaudeBatch, runCommandPhase, evaluateCoverageGate, runValidationTrack };
