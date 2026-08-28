'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectInconsistencies } = require('../src/deliveryInconsistencyDetector');

function delivery(overrides = {}) {
  return {
    id: 'delivery-1',
    repoPath: '/repo',
    objective: 'Add feature',
    branch: 'feature/x',
    baseBranch: 'Dev',
    status: 'active',
    nextAction: '',
    blockedReason: '',
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:00.000Z',
    events: [],
    flowSnapshot: null,
    chain: null,
    ...overrides
  };
}

function envelope(overrides = {}) {
  return {
    repository: 'org/repo',
    branch: 'feature/x',
    pullRequest: { id: '1', title: 'PR', status: 'active', targetBranch: 'Dev', url: 'https://example.test/pr/1' },
    reviewers: [],
    workItems: [],
    fetchedAt: '2026-08-28T12:00:00.000Z',
    ...overrides
  };
}

const now = () => '2026-08-28T13:00:00.000Z';

test('returns no inconsistencies for a delivery matching its Azure envelope', () => {
  const result = detectInconsistencies(delivery(), { azureEnvelope: envelope(), now });
  assert.deepEqual(result, []);
});

test('flags a branch mismatch between the delivery and the Azure PR branch', () => {
  const result = detectInconsistencies(delivery({ branch: 'feature/other' }), { azureEnvelope: envelope(), now });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'high');
  assert.match(result[0].evidence, /branch/i);
  assert.equal(result[0].detectedAt, now());
});

test('flags a base branch different from Dev', () => {
  const result = detectInconsistencies(delivery({ baseBranch: 'main' }), { azureEnvelope: envelope(), now });
  assert.ok(result.some((item) => /base/i.test(item.evidence)));
});

test('flags a missing pull request when Azure envelope has none', () => {
  const result = detectInconsistencies(delivery(), { azureEnvelope: envelope({ pullRequest: null }), now });
  assert.ok(result.some((item) => /pull request/i.test(item.evidence)));
});

test('flags a pull request targeting a branch other than Dev', () => {
  const result = detectInconsistencies(delivery(), {
    azureEnvelope: envelope({ pullRequest: { id: '1', title: 'PR', status: 'active', targetBranch: 'main', url: 'https://example.test/pr/1' } }),
    now
  });
  assert.ok(result.some((item) => /target/i.test(item.evidence)));
});

test('produces no Azure-related inconsistencies when no envelope is supplied', () => {
  const result = detectInconsistencies(delivery(), { now });
  assert.deepEqual(result, []);
});

test('flags an unmerged dependency required by the chain', () => {
  const dependency = delivery({ id: 'delivery-0', status: 'active' });
  const dependent = delivery({
    id: 'delivery-1',
    chain: { chainId: 'chain-1', position: 1, dependsOn: ['delivery-0'], confirmedAt: '2026-08-28T11:00:00.000Z' }
  });
  const result = detectInconsistencies(dependent, { allDeliveries: [dependency, dependent], now });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'medium');
  assert.match(result[0].evidence, /delivery-0/);
});

test('does not flag a dependency that is already merged', () => {
  const dependency = delivery({ id: 'delivery-0', status: 'merged' });
  const dependent = delivery({
    id: 'delivery-1',
    chain: { chainId: 'chain-1', position: 1, dependsOn: ['delivery-0'], confirmedAt: '2026-08-28T11:00:00.000Z' }
  });
  const result = detectInconsistencies(dependent, { allDeliveries: [dependency, dependent], now });
  assert.deepEqual(result, []);
});

test('flags a dependsOn id that references a delivery not present in allDeliveries', () => {
  const dependent = delivery({
    chain: { chainId: 'chain-1', position: 1, dependsOn: ['missing-delivery'], confirmedAt: '2026-08-28T11:00:00.000Z' }
  });
  const result = detectInconsistencies(dependent, { allDeliveries: [dependent], now });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'medium');
});

test('does not flag a repository mismatch when the repo dir name matches the Azure repository name', () => {
  const result = detectInconsistencies(
    delivery({ repoPath: '/home/user/projects/billing-service', branch: 'feature/x' }),
    { azureEnvelope: envelope({ repository: 'org/billing-service' }), now }
  );
  assert.ok(!result.some((item) => /repository/i.test(item.evidence)));
});

test('flags a repository mismatch when the Azure repository is unrelated to the delivery repo', () => {
  const result = detectInconsistencies(
    delivery({ repoPath: '/home/user/projects/billing-service', branch: 'feature/x' }),
    { azureEnvelope: envelope({ repository: 'org/totally-unrelated-repo' }), now }
  );
  const mismatch = result.find((item) => /repository/i.test(item.evidence));
  assert.ok(mismatch, 'expected a repository mismatch inconsistency');
  assert.equal(mismatch.severity, 'high');
});

test('each inconsistency includes a recommendedAction string', () => {
  const result = detectInconsistencies(delivery({ branch: 'feature/other' }), { azureEnvelope: envelope(), now });
  result.forEach((item) => assert.ok(typeof item.recommendedAction === 'string' && item.recommendedAction.length > 0));
});
