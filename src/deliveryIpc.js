'use strict';

const crypto = require('node:crypto');
const { readDeliveries, readDelivery, writeDeliveries } = require('./deliveryStore');

function buildDeliveryFromDraft(draft, existing) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('delivery draft must be an object');
  }
  const now = new Date();
  const previousUpdatedAt = new Date(existing?.updatedAt);
  const updatedAt = existing && now <= previousUpdatedAt
    ? new Date(previousUpdatedAt.getTime() + 1).toISOString()
    : now.toISOString();
  return {
    id: existing ? existing.id : crypto.randomUUID(),
    repoPath: draft.repoPath,
    objective: draft.objective,
    branch: draft.branch,
    baseBranch: draft.baseBranch,
    status: existing ? existing.status : 'draft',
    nextAction: draft.nextAction,
    blockedReason: draft.blockedReason,
    createdAt: existing ? existing.createdAt : now.toISOString(),
    updatedAt,
    events: existing ? existing.events : []
  };
}

function registerDeliveryIpc(ipcMain, { deliveriesFilePath, assertTrustedRenderer }) {
  ipcMain.handle('deliveries:list', (event) => {
    assertTrustedRenderer(event);
    return readDeliveries(deliveriesFilePath());
  });

  ipcMain.handle('deliveries:open', (event, deliveryId) => {
    assertTrustedRenderer(event);
    return readDelivery(deliveriesFilePath(), deliveryId);
  });

  ipcMain.handle('deliveries:save', (event, draft) => {
    assertTrustedRenderer(event);
    const deliveries = readDeliveries(deliveriesFilePath());
    const existing = typeof draft?.id === 'string' ? deliveries.find((item) => item.id === draft.id) : null;
    const delivery = buildDeliveryFromDraft(draft, existing);
    return writeDeliveries(deliveriesFilePath(), existing
      ? deliveries.map((item) => item.id === existing.id ? delivery : item)
      : [...deliveries, delivery]).find((item) => item.id === delivery.id);
  });
}

module.exports = { registerDeliveryIpc };
