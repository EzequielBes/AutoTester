const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runValidationTrack } = require('../src/validationRunner');

const promptFilePath = path.join(__dirname, '..', 'prompts', 'review-prompt.md');

test('runs track phases sequentially with their criteria', async () => {
  const prompts = [];
  const results = await runValidationTrack({
    track: {
      phases: [
        { id: 'security', type: 'claude', name: 'Security', agent: 'claude', skill: 'security', intensity: 'full', criteria: 'Check auth.' },
        { id: 'performance', type: 'claude', name: 'Performance', agent: 'claude', skill: 'performance', intensity: 'quick', criteria: '' }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    runReview: async (prompt) => {
      prompts.push(prompt);
      return [{
        file: 'src/a.js',
        lines: '1',
        severity: 'low',
        category: 'bug',
        message: 'Example',
        suggestion: ''
      }];
    }
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].phaseName, 'Security');
  assert.equal(results[1].phaseName, 'Performance');
  assert.equal(results[0].canApply, true);
  assert.match(prompts[0], /Check auth\./);
  assert.equal(prompts[1].includes('Check auth.'), false);
});

test('marks a phase as failed when it returns a finding outside the selected file scope', async () => {
  const results = await runValidationTrack({
    track: {
      phases: [
        { id: 'security', type: 'claude', name: 'Security', agent: 'claude', skill: 'security', intensity: 'full', criteria: '' }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    runReview: async () => [{
      file: 'src/not-selected.js',
      lines: '1',
      severity: 'low',
      category: 'bug',
      message: 'Example',
      suggestion: ''
    }]
  });
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].error, /selected files/);
});

test('records command coverage for a passing command phase', async () => {
  let commands = 0;
  const results = await runValidationTrack({
    track: {
      phases: [
        {
          id: 'tests',
          type: 'command',
          name: 'Tests',
          command: 'npm test',
          timeoutMs: 600000,
          lcovPath: 'coverage/lcov.info',
          expectedExitCode: 0
        }
      ]
    },
    content: '',
    allowedFiles: [],
    repoPath: 'C:\\repo',
    promptFilePath,
    runCommandPhase: async () => {
      commands += 1;
      return { exitCode: 0, timedOut: false, error: null, durationMs: 125, stdout: '', stderr: '' };
    },
    readCoverage: () => ({ lines: { found: 4, hit: 3, pct: 75 }, files: [] }),
    runReview: async () => { throw new Error('must not run'); }
  });

  assert.equal(commands, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'passed');
  assert.equal(results[0].coverage.lines.pct, 75);
});
