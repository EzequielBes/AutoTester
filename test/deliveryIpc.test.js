const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeDeliveries } = require('../src/deliveryStore');
const { registerDeliveryIpc } = require('../src/deliveryIpc');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-ipc-')), 'deliveries.json');
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
  registerDeliveryIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    deliveriesFilePath: () => deliveriesPath,
    assertTrustedRenderer: options.assertTrustedRenderer || (() => {})
  });
  return { handlers };
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
