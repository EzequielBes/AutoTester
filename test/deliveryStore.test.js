const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
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
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
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
