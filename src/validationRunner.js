'use strict';

const { buildSystemPrompt } = require('./promptBuilder');
const { runClaudeReview } = require('./claudeRunner');
const { validateFindings } = require('./findingsSchema');
const { runCommand } = require('./commandRunner');
const { readLcovCoverage } = require('./lcovParser');

async function runValidationTrack({
  track,
  content,
  allowedFiles,
  repoPath,
  promptFilePath,
  runReview = runClaudeReview,
  runCommandPhase = runCommand,
  readCoverage = readLcovCoverage
}) {
  const phases = [];
  for (const phase of track.phases) {
    if (phase.type === 'claude') {
      try {
        const systemPrompt = buildSystemPrompt(promptFilePath, phase.skill, phase.intensity, phase.criteria);
        const findings = await runReview(systemPrompt, content);
        const validation = validateFindings({ findings }, { allowedFiles });
        if (!validation.valid) throw new Error(validation.errors.join('; '));
        phases.push({
          type: 'claude',
          phaseId: phase.id,
          phaseName: phase.name,
          agent: phase.agent,
          skill: phase.skill,
          findings,
          canApply: phase.skill !== 'tests',
          status: 'passed'
        });
      } catch (error) {
        phases.push({
          type: 'claude',
          phaseId: phase.id,
          phaseName: phase.name,
          agent: phase.agent,
          skill: phase.skill,
          findings: [],
          canApply: false,
          status: 'failed',
          error: error.message
        });
      }
    } else {
      const commandResult = await runCommandPhase({
        command: phase.command,
        cwd: repoPath,
        timeoutMs: phase.timeoutMs
      });
      let status = commandResult.timedOut ? 'timed-out' : 'failed';
      let error = commandResult.error;
      let coverage = null;
      if (!commandResult.timedOut && !commandResult.error && commandResult.exitCode === phase.expectedExitCode) {
        try {
          coverage = phase.lcovPath ? readCoverage(repoPath, phase.lcovPath) : null;
          status = 'passed';
        } catch (coverageError) {
          error = coverageError.message;
        }
      } else if (!error) {
        error = `command exited with code ${commandResult.exitCode}; expected ${phase.expectedExitCode}`;
      }
      phases.push({
        type: 'command',
        phaseId: phase.id,
        phaseName: phase.name,
        status,
        commandResult,
        coverage,
        error
      });
    }
    if (phases.at(-1).status !== 'passed') break;
  }
  return phases;
}

module.exports = { runValidationTrack };
