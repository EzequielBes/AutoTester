const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeDeliveries, readDeliveries } = require('../src/deliveryStore');
const { writeProjectPolicies } = require('../src/projectPolicyStore');
const { writeValidationTracks } = require('../src/validationTrackStore');
const { writeAgentProfiles } = require('../src/agentProfileStore');
const { writeQualitySkills } = require('../src/qualitySkillStore');
const { registerDeliveryIpc } = require('../src/deliveryIpc');

function tmpFile(name = 'deliveries.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-ipc-')), name);
}

function draft(overrides = {}) {
  return {
    repoPath: '/work/repository',
    objective: 'Add guarded delivery IPC.',
    branch: 'feature/delivery-ipc',
    baseBranch: 'Dev',
    nextAction: 'Add handlers.',
    blockedReason: '',
    ...overrides
  };
}

function storedDelivery() {
  return {
    id: 'delivery-1',
    ...draft(),
    status: 'draft',
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
    events: []
  };
}

function setup(options = {}) {
  const handlers = new Map();
  const deliveriesPath = tmpFile();
  if (options.deliveries) writeDeliveries(deliveriesPath, options.deliveries);

  const policiesPath = tmpFile('policies.json');
  if (options.policies) writeProjectPolicies(policiesPath, options.policies);

  const tracksPath = tmpFile('tracks.json');
  if (options.tracks) writeValidationTracks(tracksPath, options.tracks);

  const profilesPath = tmpFile('profiles.json');
  if (options.profiles) writeAgentProfiles(profilesPath, options.profiles);

  const skillsPath = tmpFile('skills.json');
  if (options.skills) writeQualitySkills(skillsPath, options.skills);

  registerDeliveryIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    deliveriesFilePath: () => deliveriesPath,
    projectPoliciesFilePath: () => policiesPath,
    validationTracksFilePath: () => tracksPath,
    agentProfilesFilePath: () => profilesPath,
    qualitySkillsFilePath: () => skillsPath,
    assertTrustedRenderer: options.assertTrustedRenderer || (() => {}),
    runAzureSync: options.runAzureSync || (async () => ({})),
    suggestChainImpl: options.suggestChainImpl || (async () => ({ suggestion: [], evidence: '' })),
    detectInconsistencies: options.detectInconsistencies || (() => [])
  });
  return { handlers, deliveriesPath };
}

test('registers guarded delivery handlers and creates a delivery', () => {
  let checks = 0;
  const { handlers } = setup({ assertTrustedRenderer: () => { checks += 1; } });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft({ id: 'renderer-id', createdAt: 'old', updatedAt: 'old' }));

  assert.equal(saved.status, 'draft');
  assert.notEqual(saved.id, 'renderer-id');
  assert.notEqual(saved.createdAt, 'old');
  assert.notEqual(saved.updatedAt, 'old');
  assert.equal(handlers.get('deliveries:list')({ sender: {} }).length, 1);
  assert.equal(checks, 2);
});

test('rejects delivery calls from an untrusted renderer', () => {
  const { handlers } = setup({ assertTrustedRenderer: () => { throw new Error('untrusted'); } });

  assert.throws(() => handlers.get('deliveries:open')({ sender: {} }, 'delivery-1'), /untrusted/);
});

test('updates an existing delivery without accepting renderer timestamps', () => {
  const original = storedDelivery();
  const { handlers } = setup({ deliveries: [original] });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft({
    id: original.id,
    objective: 'Updated objective.',
    createdAt: 'renderer-created',
    updatedAt: 'renderer-updated'
  }));

  assert.equal(saved.id, original.id);
  assert.equal(saved.createdAt, original.createdAt);
  assert.notEqual(saved.updatedAt, original.updatedAt);
  assert.equal(saved.objective, 'Updated objective.');
});

test('preserves the stored status when editing an existing delivery', () => {
  const original = { ...storedDelivery(), status: 'blocked' };
  const { handlers } = setup({ deliveries: [original] });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft({
    id: original.id,
    objective: 'Updated objective.'
  }));

  assert.equal(saved.status, 'blocked');
});

test('sets an update timestamp strictly later than the stored timestamp', () => {
  const original = { ...storedDelivery(), updatedAt: '2999-01-01T00:00:00.000Z' };
  const { handlers } = setup({ deliveries: [original] });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft({ id: original.id }));

  assert.ok(Date.parse(saved.updatedAt) > Date.parse(original.updatedAt));
});

test('rejects flow snapshot build calls from an untrusted renderer', () => {
  const { handlers } = setup({ assertTrustedRenderer: () => { throw new Error('untrusted'); } });

  assert.throws(() => handlers.get('deliveries:build-flow-snapshot')({ sender: {} }, {
    deliveryId: 'delivery-1',
    selection: {}
  }), /untrusted/);
});

test('records a validated scope exception with generated audit fields', () => {
  const { handlers } = setup();
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const updated = handlers.get('deliveries:record-scope-exception')({ sender: {} }, {
    deliveryId: saved.id,
    exception: {
      files: ['src/shared.js'], justification: 'Shared contract requires an update.',
      phaseId: 'implementation', actorId: 'agent-1'
    }
  });
  assert.equal(updated.scopeExceptions.length, 1);
  assert.ok(updated.scopeExceptions[0].id);
  assert.ok(updated.scopeExceptions[0].createdAt);
  assert.equal(updated.events.at(-1).kind, 'scope-exception');
});

test('builds a flow snapshot from current policy, track, profile and skill records', () => {
  const original = storedDelivery();
  const policy = { id: 'policy-1', path: 'AGENTS.md', excerpt: 'Follow the rules.' };
  const track = {
    id: 'track-1',
    name: 'Pre-merge',
    phases: [{
      id: 'phase-1',
      type: 'claude',
      name: 'Security',
      agent: 'claude',
      skill: 'security',
      intensity: 'full',
      criteria: 'Check authorization.'
    }]
  };
  const profile = { id: 'custom-agent', name: 'Custom agent', runtime: 'claude', instructions: 'Be careful.' };
  const skill = {
    id: 'custom-skill',
    name: 'Custom skill',
    baseSkill: 'general',
    instructions: 'Look for bugs.',
    canApply: true
  };

  const { handlers, deliveriesPath } = setup({
    deliveries: [original],
    policies: [policy],
    tracks: [track],
    profiles: [profile],
    skills: [skill]
  });

  const saved = handlers.get('deliveries:build-flow-snapshot')({ sender: {} }, {
    deliveryId: original.id,
    selection: {
      policyIds: ['policy-1'],
      trackId: 'track-1',
      agentProfileIds: ['custom-agent'],
      qualitySkillIds: ['custom-skill']
    }
  });

  assert.deepEqual(saved.flowSnapshot.selectedPolicies, [policy]);
  assert.deepEqual(saved.flowSnapshot.track, track);
  assert.deepEqual(saved.flowSnapshot.agentProfiles, [profile]);
  assert.deepEqual(saved.flowSnapshot.qualitySkills, [skill]);
  assert.deepEqual(readDeliveries(deliveriesPath).find((d) => d.id === original.id).flowSnapshot, saved.flowSnapshot);
});

test('flow snapshot is a deep copy that does not change when the source records are edited later', () => {
  const original = storedDelivery();
  const policy = { id: 'policy-1', path: 'AGENTS.md', excerpt: 'Follow the rules.' };
  const track = {
    id: 'track-1',
    name: 'Pre-merge',
    phases: [{
      id: 'phase-1',
      type: 'claude',
      name: 'Security',
      agent: 'claude',
      skill: 'security',
      intensity: 'full',
      criteria: 'Check authorization.'
    }]
  };

  const { handlers } = setup({ deliveries: [original], policies: [policy], tracks: [track] });

  const saved = handlers.get('deliveries:build-flow-snapshot')({ sender: {} }, {
    deliveryId: original.id,
    selection: { policyIds: ['policy-1'], trackId: 'track-1' }
  });

  const snapshotBefore = JSON.parse(JSON.stringify(saved.flowSnapshot));

  // Mutate the objects that were used to build the snapshot; the stored snapshot must be unaffected.
  policy.excerpt = 'Mutated after snapshot.';
  track.name = 'Mutated after snapshot.';
  track.phases[0].criteria = 'Mutated after snapshot.';

  assert.deepEqual(saved.flowSnapshot, snapshotBefore);
});

test('rejects an unknown delivery id when building a flow snapshot', () => {
  const { handlers } = setup({ deliveries: [storedDelivery()] });

  assert.throws(() => handlers.get('deliveries:build-flow-snapshot')({ sender: {} }, {
    deliveryId: 'missing',
    selection: {}
  }), /delivery was not found/);
});

test('deliveries:sync-azure records an inconsistency event when the Azure connector fails, without throwing', async () => {
  const { handlers } = setup({
    runAzureSync: async () => { const error = new Error('timed out'); error.code = 'AZURE_MCP_TIMEOUT'; throw error; }
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = await handlers.get('deliveries:sync-azure')({ sender: {} }, saved.id);
  assert.equal(result.id, saved.id);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'inconsistency');
  assert.match(result.events[0].detail, /timed out|AZURE_MCP_TIMEOUT/);
});

test('deliveries:sync-azure records no inconsistency event on a clean, matching sync', async () => {
  const { handlers } = setup({
    runAzureSync: async () => ({
      repository: 'org/repo', branch: draft().branch, pullRequest: { id: '1', title: 'PR', status: 'active', targetBranch: 'Dev', url: 'https://example.test/pr/1' },
      reviewers: [], workItems: [], fetchedAt: '2026-08-28T12:00:00.000Z'
    }),
    detectInconsistencies: () => []
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = await handlers.get('deliveries:sync-azure')({ sender: {} }, saved.id);
  assert.equal(result.events.length, 0);
});

test('deliveries:sync-azure rejects when the delivery does not exist', async () => {
  const { handlers } = setup({ runAzureSync: async () => ({}) });
  await assert.rejects(handlers.get('deliveries:sync-azure')({ sender: {} }, 'missing-id'));
});

test('deliveries:sync-azure runs the Azure query against the delivery\'s own repo path', async () => {
  let receivedPrompt;
  let receivedOptions;
  const { handlers } = setup({
    runAzureSync: async (prompt, options) => { receivedPrompt = prompt; receivedOptions = options; return {}; }
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft({ repoPath: '/work/repository' }));
  await handlers.get('deliveries:sync-azure')({ sender: {} }, saved.id);

  assert.equal(receivedOptions.cwd, '/work/repository');
  assert.match(receivedPrompt, /\/work\/repository/);
  assert.match(receivedPrompt, /feature\/delivery-ipc/);
});

test('deliveries:suggest-chain returns a suggestion without persisting it', async () => {
  const { handlers, deliveriesPath } = setup({
    runAzureSync: async () => ({}),
    suggestChainImpl: async () => ({ suggestion: [{ deliveryId: 'delivery-1', position: 0, dependsOn: [] }], evidence: 'inferred from Git history' })
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = await handlers.get('deliveries:suggest-chain')({ sender: {} }, [saved.id]);
  assert.equal(result.suggestion.length, 1);
  assert.equal(result.evidence, 'inferred from Git history');
  const [stored] = readDeliveries(deliveriesPath);
  assert.ok(!stored.chain);
});

test('deliveries:confirm-chain persists chain entries onto their deliveries', () => {
  const { handlers, deliveriesPath } = setup();
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = handlers.get('deliveries:confirm-chain')({ sender: {} }, [
    { deliveryId: saved.id, chainId: 'chain-1', position: 0, dependsOn: [] }
  ]);
  assert.equal(result[0].chain.chainId, 'chain-1');
  assert.equal(result[0].chain.position, 0);
  assert.ok(result[0].chain.confirmedAt);
  const [stored] = readDeliveries(deliveriesPath);
  assert.equal(stored.chain.chainId, 'chain-1');
});

test('deliveries:confirm-chain rejects an untrusted renderer', () => {
  const { handlers } = setup({ assertTrustedRenderer: () => { throw new Error('untrusted renderer'); } });
  assert.throws(() => handlers.get('deliveries:confirm-chain')({ sender: {} }, []), /untrusted renderer/);
});

test('deliveries:save preserves a confirmed chain and flow snapshot on a later edit', () => {
  const { handlers, deliveriesPath } = setup({
    policies: [{ id: 'policy-1', path: 'AGENTS.md', excerpt: 'Follow the rules.' }]
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());

  // Confirm a chain on the delivery.
  const [confirmed] = handlers.get('deliveries:confirm-chain')({ sender: {} }, [
    { deliveryId: saved.id, chainId: 'chain-1', position: 0, dependsOn: [] }
  ]);
  assert.equal(confirmed.chain.chainId, 'chain-1');

  // Build a flow snapshot on the same delivery.
  const withSnapshot = handlers.get('deliveries:build-flow-snapshot')({ sender: {} }, {
    deliveryId: saved.id,
    selection: { policyIds: ['policy-1'] }
  });
  assert.equal(withSnapshot.flowSnapshot.selectedPolicies.length, 1);
  assert.equal(withSnapshot.chain.chainId, 'chain-1');

  // Re-save the delivery with an edited field, as the editor form would.
  const resaved = handlers.get('deliveries:save')({ sender: {} }, draft({
    id: saved.id,
    nextAction: 'A different next action.'
  }));

  assert.equal(resaved.nextAction, 'A different next action.');
  assert.ok(resaved.chain, 'chain must survive a re-save');
  assert.equal(resaved.chain.chainId, 'chain-1');
  assert.ok(resaved.flowSnapshot, 'flowSnapshot must survive a re-save');
  assert.equal(resaved.flowSnapshot.selectedPolicies.length, 1);

  const [stored] = readDeliveries(deliveriesPath).filter((item) => item.id === saved.id);
  assert.equal(stored.chain.chainId, 'chain-1');
  assert.equal(stored.flowSnapshot.selectedPolicies.length, 1);
});
