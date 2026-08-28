const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  STORE_VERSION,
  validateDelivery,
  readDelivery,
  readDeliveries,
  writeDeliveries
} = require('../src/deliveryStore');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveries-'));
  return path.join(dir, 'deliveries.json');
}

function delivery() {
  return {
    id: 'delivery-1',
    repoPath: '/work/repository',
    objective: 'Add local delivery storage.',
    branch: 'feature/delivery-store',
    baseBranch: 'Dev',
    status: 'active',
    nextAction: 'Write the delivery store.',
    blockedReason: '',
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
    events: [{
      id: 'event-1',
      timestamp: '2026-08-28T12:00:00.000Z',
      kind: 'created',
      detail: 'Delivery created.'
    }]
  };
}

test('returns no deliveries before the store exists', () => {
  assert.deepEqual(readDeliveries(tmpFile()), []);
});

test('writes a versioned delivery store and reads it back', () => {
  const file = tmpFile();
  const deliveries = [delivery()];
  writeDeliveries(file, deliveries);

  assert.deepEqual(readDeliveries(file), deliveries);
  assert.equal(readDelivery(file, 'delivery-1').id, 'delivery-1');
  assert.equal(readDelivery(file, 'missing'), null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, STORE_VERSION);
});

test('uses a distinct UUID for each temporary delivery file', () => {
  const originalRandomUUID = crypto.randomUUID;
  const uuids = [];
  crypto.randomUUID = () => {
    const uuid = `uuid-${uuids.length + 1}`;
    uuids.push(uuid);
    return uuid;
  };
  try {
    const file = tmpFile();
    writeDeliveries(file, [delivery()]);
    writeDeliveries(file, [delivery()]);
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }

  assert.deepEqual(uuids, ['uuid-1', 'uuid-2']);
});

test('rejects a corrupted delivery store instead of silently discarding it', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');

  assert.throws(() => readDeliveries(file), /storage is corrupted/);
});

test('rejects a delivery with an unsupported status', () => {
  const invalid = delivery();
  invalid.status = 'unknown';

  assert.throws(() => validateDelivery(invalid), /status is not supported/);
});

test('rejects duplicate delivery identifiers', () => {
  const file = tmpFile();
  const duplicate = delivery();

  assert.throws(() => writeDeliveries(file, [delivery(), duplicate]), /delivery ids must be unique/);
});

test('rejects an event without required string details', () => {
  const invalid = delivery();
  invalid.events[0].detail = '';

  assert.throws(() => validateDelivery(invalid), /event.detail must not be empty/);
});

test('migrates a v1 delivery store to v2 with an absent flowSnapshot, keeping existing fields', () => {
  const file = tmpFile();
  const v1Delivery = delivery();
  fs.writeFileSync(file, JSON.stringify({ version: 1, deliveries: [v1Delivery] }, null, 2));

  const [migrated] = readDeliveries(file);

  assert.equal(migrated.flowSnapshot, null);
  assert.equal(migrated.id, v1Delivery.id);
  assert.equal(migrated.repoPath, v1Delivery.repoPath);
  assert.equal(migrated.objective, v1Delivery.objective);
  assert.deepEqual(migrated.events, v1Delivery.events);
});

test('writes deliveries under the current store version', () => {
  const file = tmpFile();
  writeDeliveries(file, [delivery()]);

  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, STORE_VERSION);
});

test('round-trips a delivery with a flowSnapshot', () => {
  const file = tmpFile();
  const withSnapshot = {
    ...delivery(),
    flowSnapshot: {
      selectedPolicies: [{ id: 'policy-1', path: 'AGENTS.md', excerpt: 'Follow the rules.' }],
      track: {
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
      },
      agentProfiles: [{ id: 'claude', name: 'Claude padrão', runtime: 'claude', instructions: '' }],
      qualitySkills: [{ id: 'security', name: 'Segurança', baseSkill: 'security', instructions: '', canApply: true }]
    }
  };

  writeDeliveries(file, [withSnapshot]);

  assert.deepEqual(readDeliveries(file)[0].flowSnapshot, withSnapshot.flowSnapshot);
});

test('rejects a flowSnapshot that is not an object', () => {
  const invalid = { ...delivery(), flowSnapshot: 'not-an-object' };

  assert.throws(() => validateDelivery(invalid), /flowSnapshot must be an object/);
});

test('writes and reads back a delivery with a confirmed chain', () => {
  const file = tmpFile();
  const withChain = {
    ...delivery(),
    chain: { chainId: 'chain-1', position: 0, dependsOn: [], confirmedAt: '2026-08-28T12:00:00.000Z' }
  };
  writeDeliveries(file, [withChain]);
  const [readBack] = readDeliveries(file);
  assert.deepEqual(readBack.chain, withChain.chain);
});

test('accepts a null chain', () => {
  const file = tmpFile();
  writeDeliveries(file, [{ ...delivery(), chain: null }]);
  const [readBack] = readDeliveries(file);
  assert.equal(readBack.chain, null);
});

test('rejects a chain missing required fields', () => {
  const file = tmpFile();
  assert.throws(
    () => writeDeliveries(file, [{ ...delivery(), chain: { chainId: 'c1' } }]),
    /chain/
  );
});

test('rejects a chain with a non-array dependsOn', () => {
  const file = tmpFile();
  assert.throws(
    () => writeDeliveries(file, [{ ...delivery(), chain: { chainId: 'c1', position: 0, dependsOn: 'not-array', confirmedAt: '2026-08-28T12:00:00.000Z' } }]),
    /dependsOn/
  );
});

test('migrates a version 1 delivery to version 3 with both flowSnapshot and chain null', () => {
  const file = tmpFile();
  const v1Delivery = delivery();
  delete v1Delivery.flowSnapshot;
  fs.writeFileSync(file, JSON.stringify({ version: 1, deliveries: [v1Delivery] }));
  const [migrated] = readDeliveries(file);
  assert.equal(migrated.flowSnapshot, null);
  assert.equal(migrated.chain, null);
  assert.equal(migrated.id, v1Delivery.id);
});

test('migrates a version 2 delivery to version 3 with chain null, preserving flowSnapshot', () => {
  const file = tmpFile();
  const v2Delivery = { ...delivery(), flowSnapshot: { track: null, selectedPolicies: [], agentProfiles: [], qualitySkills: [] } };
  fs.writeFileSync(file, JSON.stringify({ version: 2, deliveries: [v2Delivery] }));
  const [migrated] = readDeliveries(file);
  assert.equal(migrated.chain, null);
  assert.deepEqual(migrated.flowSnapshot, v2Delivery.flowSnapshot);
});

test('writes deliveries at STORE_VERSION 3', () => {
  const file = tmpFile();
  writeDeliveries(file, [delivery()]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 3);
});
