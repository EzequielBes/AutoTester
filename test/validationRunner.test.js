const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { evaluateCoverageGate, runValidationTrack, resolveDeliveryFlow } = require('../src/validationRunner');

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
    getCoverageFileState: (() => {
      let calls = 0;
      return () => ++calls === 1 ? null : { size: 10, mtimeMs: 2, ctimeMs: 2 };
    })(),
    readCoverage: () => ({ lines: { found: 4, hit: 3, pct: 75 }, files: [] }),
    runReview: async () => { throw new Error('must not run'); }
  });

  assert.equal(commands, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'passed');
  assert.equal(results[0].coverage.lines.pct, 75);
});

test('fails a command phase when its LCOV report is stale', async () => {
  let coverageReads = 0;
  const results = await runValidationTrack({
    track: {
      phases: [{
        id: 'tests', type: 'command', name: 'Tests', command: 'npm test', timeoutMs: 600000,
        lcovPath: 'coverage/lcov.info', expectedExitCode: 0
      }]
    },
    content: '',
    allowedFiles: [],
    repoPath: 'C:\\repo',
    promptFilePath,
    runCommandPhase: async () => ({ exitCode: 0, timedOut: false, error: null, durationMs: 1, stdout: '', stderr: '' }),
    getCoverageFileState: () => ({ size: 10, mtimeMs: 1, ctimeMs: 1 }),
    readCoverage: () => { coverageReads += 1; return { lines: { found: 1, hit: 1, pct: 100 }, files: [] }; }
  });

  assert.equal(results[0].status, 'failed');
  assert.match(results[0].error, /not created or updated/);
  assert.equal(coverageReads, 0);
});

test('uses the selected agent profile instructions and returns its snapshot', async () => {
  let prompt;
  const results = await runValidationTrack({
    track: {
      phases: [
        { id: 'security', type: 'claude', name: 'Security', agent: 'security-profile', skill: 'security', intensity: 'quick', criteria: '' }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    agentProfiles: [{
      id: 'security-profile',
      name: 'Security specialist',
      runtime: 'claude',
      instructions: 'Prioritize authorization paths.'
    }],
    runReview: async (systemPrompt) => {
      prompt = systemPrompt;
      return [];
    }
  });

  assert.match(prompt, /Prioritize authorization paths\./);
  assert.equal(results[0].agentProfileName, 'Security specialist');
});

test('uses custom quality skill instructions with its configured base skill', async () => {
  let prompt;
  const results = await runValidationTrack({
    track: {
      phases: [
        { id: 'accessibility', type: 'claude', name: 'Accessibility', agent: 'claude', skill: 'accessibility', intensity: 'quick', criteria: '' }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    qualitySkills: [{
      id: 'accessibility',
      name: 'Accessibility review',
      baseSkill: 'general',
      instructions: 'Prioritize keyboard navigation.',
      canApply: false
    }],
    runReview: async (systemPrompt) => {
      prompt = systemPrompt;
      return [];
    }
  });

  assert.match(prompt, /Prioritize keyboard navigation\./);
  assert.equal(results[0].skillName, 'Accessibility review');
  assert.equal(results[0].canApply, false);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('runs parallel Claude phases with a concurrency limit and preserves phase order', async () => {
  const started = [];
  const pending = [];
  const execution = runValidationTrack({
    track: {
      phases: [
        { id: 'one', type: 'claude', name: 'One', agent: 'claude', skill: 'general', intensity: 'quick', criteria: '', parallel: true },
        { id: 'two', type: 'claude', name: 'Two', agent: 'claude', skill: 'security', intensity: 'quick', criteria: '', parallel: true },
        { id: 'three', type: 'claude', name: 'Three', agent: 'claude', skill: 'performance', intensity: 'quick', criteria: '', parallel: true }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    runReview: async () => {
      const task = deferred();
      started.push(task);
      pending.push(task);
      return task.promise;
    }
  });

  await nextTurn();
  assert.equal(started.length, 2);
  pending[1].resolve([]);
  await nextTurn();
  assert.equal(started.length, 3);
  pending[0].resolve([]);
  pending[2].resolve([]);

  const results = await execution;
  assert.deepEqual(results.map((result) => result.phaseId), ['one', 'two', 'three']);
  assert.ok(results.every((result) => result.parallel));
});

test('waits for a parallel batch and stops before the next command after a failure', async () => {
  const first = deferred();
  const second = deferred();
  let reviewCalls = 0;
  let commandCalls = 0;
  const execution = runValidationTrack({
    track: {
      phases: [
        { id: 'one', type: 'claude', name: 'One', agent: 'claude', skill: 'general', intensity: 'quick', criteria: '', parallel: true },
        { id: 'two', type: 'claude', name: 'Two', agent: 'claude', skill: 'security', intensity: 'quick', criteria: '', parallel: true },
        { id: 'tests', type: 'command', name: 'Tests', command: 'npm test', timeoutMs: 600000, lcovPath: '', expectedExitCode: 0 }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    runReview: async () => {
      reviewCalls += 1;
      return reviewCalls === 1 ? first.promise : second.promise;
    },
    runCommandPhase: async () => {
      commandCalls += 1;
      return { exitCode: 0, timedOut: false, error: null, durationMs: 1, stdout: '', stderr: '' };
    }
  });

  await nextTurn();
  first.resolve([]);
  second.reject(new Error('Claude failed'));
  const results = await execution;

  assert.equal(results.length, 2);
  assert.equal(results[1].status, 'failed');
  assert.equal(commandCalls, 0);
});

test('emits queued, running and terminal progress for a Claude phase', async () => {
  const progress = [];
  await runValidationTrack({
    track: {
      phases: [
        { id: 'review', type: 'claude', name: 'Review', agent: 'claude', skill: 'general', intensity: 'quick', criteria: '' }
      ]
    },
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: 'C:\\repo',
    promptFilePath,
    runReview: async () => [],
    onPhaseProgress: (event) => progress.push(event.status)
  });

  assert.deepEqual(progress, ['queued', 'running', 'passed']);
});

test('fails a coverage gate below its minimum or beyond its baseline drop', () => {
  const coverage = {
    lines: { found: 100, hit: 78, pct: 78 },
    files: [{ file: 'src/a.js', lines: { found: 100, hit: 78, pct: 78 } }]
  };
  const minimum = evaluateCoverageGate({ minLinesPct: 80, maxDropPct: null, fileScope: 'all' }, coverage, [], null);
  assert.equal(minimum.passed, false);
  const drop = evaluateCoverageGate({ minLinesPct: null, maxDropPct: 1, fileScope: 'all' }, coverage, [], { pct: 80 });
  assert.equal(drop.passed, false);
});

function flowSnapshotDelivery(overrides = {}) {
  return {
    id: 'delivery-1',
    repoPath: '/work/repository',
    branch: 'feature/x',
    flowSnapshot: {
      track: {
        id: 'track-1',
        phases: [
          { id: 'security', type: 'claude', name: 'Security', agent: 'snapshot-agent', skill: 'snapshot-skill', intensity: 'quick', criteria: '' }
        ]
      },
      agentProfiles: [{ id: 'snapshot-agent', name: 'Snapshot agent', runtime: 'claude', instructions: 'Snapshot instructions.' }],
      qualitySkills: [{ id: 'snapshot-skill', name: 'Snapshot skill', baseSkill: 'general', instructions: 'Snapshot skill instructions.', canApply: false }]
    },
    ...overrides
  };
}

test('rejects delivery-linked execution when the repository does not match the delivery', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery(),
      deliveryRepoPath: '/work/other-repository',
      branch: 'feature/x'
    }),
    /repository|branch/
  );
});

test('rejects delivery-linked execution when the branch does not match the delivery', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery(),
      deliveryRepoPath: '/work/repository',
      branch: 'feature/other'
    }),
    /repository|branch/
  );
});

test('delivery-linked execution resolves the saved snapshot, not live profiles or skills', async () => {
  const flowSnapshot = resolveDeliveryFlow({
    deliveryId: 'delivery-1',
    resolveDelivery: () => flowSnapshotDelivery(),
    deliveryRepoPath: '/work/repository',
    branch: 'feature/x'
  });

  let prompt;
  const results = await runValidationTrack({
    track: flowSnapshot.track,
    agentProfiles: flowSnapshot.agentProfiles,
    qualitySkills: flowSnapshot.qualitySkills,
    content: '=== src/a.js ===\nconst value = 1;',
    allowedFiles: ['src/a.js'],
    repoPath: '/work/repository',
    promptFilePath,
    runReview: async (systemPrompt) => {
      prompt = systemPrompt;
      return [];
    }
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].phaseId, 'security');
  assert.equal(results[0].agentProfileName, 'Snapshot agent');
  assert.equal(results[0].skillName, 'Snapshot skill');
  assert.match(prompt, /Snapshot instructions\./);
  assert.match(prompt, /Snapshot skill instructions\./);
});

test('rejects delivery-linked execution when the delivery has no saved flow snapshot', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery({ flowSnapshot: null }),
      deliveryRepoPath: '/work/repository',
      branch: 'feature/x'
    }),
    /flow snapshot|snapshot/
  );
});

test('rejects delivery-linked execution when the delivery cannot be found', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'missing-delivery',
      resolveDelivery: () => null,
      deliveryRepoPath: '/work/repository',
      branch: 'feature/x'
    }),
    /delivery/
  );
});

test('rejects delivery-linked execution cleanly when the flow snapshot has no track selected', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery({
        flowSnapshot: {
          track: null,
          agentProfiles: [],
          qualitySkills: []
        }
      }),
      deliveryRepoPath: '/work/repository',
      branch: 'feature/x'
    }),
    (error) => error instanceof Error && !(error instanceof TypeError) && /no track selected/.test(error.message)
  );
});

test('rejects delivery-linked execution when the snapshot track references an agent or skill excluded from the snapshot', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery({
        flowSnapshot: {
          track: {
            id: 'track-1',
            phases: [
              { id: 'security', type: 'claude', name: 'Security', agent: 'missing-agent', skill: 'snapshot-skill', intensity: 'quick', criteria: '' }
            ]
          },
          agentProfiles: [{ id: 'snapshot-agent', name: 'Snapshot agent', runtime: 'claude', instructions: 'Snapshot instructions.' }],
          qualitySkills: [{ id: 'snapshot-skill', name: 'Snapshot skill', baseSkill: 'general', instructions: 'Snapshot skill instructions.', canApply: false }]
        }
      }),
      deliveryRepoPath: '/work/repository',
      branch: 'feature/x'
    }),
    /agent profile/
  );
});

test('rejects a flow snapshot cleanly when the track has no phases array', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery({
        flowSnapshot: {
          track: { id: 't' },
          agentProfiles: [],
          qualitySkills: []
        }
      }),
      deliveryRepoPath: '/work/repository',
      branch: 'feature/x'
    }),
    (error) => error instanceof Error && !(error instanceof TypeError) && /malformed/.test(error.message)
  );
});

test('rejects a flow snapshot cleanly when agentProfiles or qualitySkills are missing', () => {
  assert.throws(
    () => resolveDeliveryFlow({
      deliveryId: 'delivery-1',
      resolveDelivery: () => flowSnapshotDelivery({
        flowSnapshot: {
          track: { id: 't', phases: [{ id: 'security', type: 'claude', name: 'Security', agent: 'a', skill: 's', intensity: 'quick', criteria: '' }] }
        }
      }),
      deliveryRepoPath: '/work/repository',
      branch: 'feature/x'
    }),
    (error) => error instanceof Error && !(error instanceof TypeError) && /malformed/.test(error.message)
  );
});
