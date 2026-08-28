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
    assertTrustedRenderer: options.assertTrustedRenderer || (() => {})
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
