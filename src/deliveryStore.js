'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateAzureEnvelope, projectAzureEnvelope } = require('./azureEnvelopeSchema');

const STORE_VERSION = 4;
const MAX_TEXT_LENGTH = 2000;
const DELIVERY_STATUSES = new Set([
  'draft', 'active', 'blocked', 'validating', 'ready-for-pr',
  'waiting-approval', 'merged', 'cancelled'
]);

function validateText(value, label, { required = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (required && value.trim().length === 0) throw new Error(`${label} must not be empty`);
  if (value.length > MAX_TEXT_LENGTH) throw new Error(`${label} must not exceed ${MAX_TEXT_LENGTH} characters`);
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event must be an object');
  validateText(event.id, 'event.id', { required: true });
  validateText(event.timestamp, 'event.timestamp', { required: true });
  validateText(event.kind, 'event.kind', { required: true });
  validateText(event.detail, 'event.detail', { required: true });
}

function validateFlowSnapshot(flowSnapshot) {
  if (flowSnapshot === null || flowSnapshot === undefined) return;
  if (typeof flowSnapshot !== 'object' || Array.isArray(flowSnapshot)) {
    throw new Error('delivery.flowSnapshot must be an object');
  }
}

function validateChain(chain) {
  if (chain === null || chain === undefined) return;
  if (typeof chain !== 'object' || Array.isArray(chain)) throw new Error('delivery.chain must be an object');
  validateText(chain.chainId, 'chain.chainId', { required: true });
  if (typeof chain.position !== 'number' || !Number.isInteger(chain.position) || chain.position < 0) {
    throw new Error('chain.position must be a non-negative integer');
  }
  if (!Array.isArray(chain.dependsOn) || chain.dependsOn.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('chain.dependsOn must be an array of non-empty strings');
  }
  validateText(chain.confirmedAt, 'chain.confirmedAt', { required: true });
}

function validateAzureSync(azureSync) {
  if (azureSync === null || azureSync === undefined) return;
  if (!azureSync || typeof azureSync !== 'object' || Array.isArray(azureSync)) {
    throw new Error('delivery.azureSync must be an object');
  }
  if (!Object.keys(azureSync).every((key) => ['envelope', 'syncedAt'].includes(key))) {
    throw new Error('delivery.azureSync contains unsupported fields');
  }
  validateText(azureSync.syncedAt, 'delivery.azureSync.syncedAt', { required: true });
  const { valid, errors } = validateAzureEnvelope(azureSync.envelope);
  if (!valid) throw new Error(`delivery.azureSync.envelope is invalid: ${errors.join('; ')}`);
  if (JSON.stringify(azureSync.envelope) !== JSON.stringify(projectAzureEnvelope(azureSync.envelope))) {
    throw new Error('delivery.azureSync.envelope contains unsupported fields');
  }
}

function validateDelivery(delivery) {
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
    throw new Error('delivery must be an object');
  }
  validateText(delivery.id, 'delivery.id', { required: true });
  validateText(delivery.repoPath, 'delivery.repoPath', { required: true });
  validateText(delivery.objective, 'delivery.objective', { required: true });
  validateText(delivery.branch, 'delivery.branch', { required: true });
  validateText(delivery.baseBranch, 'delivery.baseBranch', { required: true });
  validateText(delivery.status, 'delivery.status', { required: true });
  if (!DELIVERY_STATUSES.has(delivery.status)) throw new Error('delivery.status is not supported');
  validateText(delivery.nextAction, 'delivery.nextAction');
  validateText(delivery.blockedReason, 'delivery.blockedReason');
  validateText(delivery.createdAt, 'delivery.createdAt', { required: true });
  validateText(delivery.updatedAt, 'delivery.updatedAt', { required: true });
  if (!Array.isArray(delivery.events)) throw new Error('delivery.events must be an array');
  delivery.events.forEach(validateEvent);
  validateFlowSnapshot(delivery.flowSnapshot);
  validateChain(delivery.chain);
  validateAzureSync(delivery.azureSync);
}

function validateDeliveries(deliveries) {
  if (!Array.isArray(deliveries)) throw new Error('deliveries must be an array');
  const deliveryIds = new Set();
  deliveries.forEach((delivery) => {
    validateDelivery(delivery);
    if (deliveryIds.has(delivery.id)) throw new Error('delivery ids must be unique');
    deliveryIds.add(delivery.id);
  });
}

function migrateV1Delivery(delivery) {
  return { ...delivery, flowSnapshot: null, chain: null };
}

function migrateV2Delivery(delivery) {
  return { ...delivery, chain: null };
}

function migrateV3Delivery(delivery) {
  return { ...delivery, azureSync: null };
}

function readDeliveries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('delivery storage is corrupted');
  }
  if (!data || !Array.isArray(data.deliveries)) {
    throw new Error('delivery storage has an unsupported schema');
  }
  let deliveries;
  if (data.version === 1) {
    deliveries = data.deliveries.map(migrateV1Delivery);
  } else if (data.version === 2) {
    deliveries = data.deliveries.map(migrateV2Delivery);
  } else if (data.version === 3) {
    deliveries = data.deliveries.map(migrateV3Delivery);
  } else if (data.version === STORE_VERSION) {
    deliveries = data.deliveries;
  } else {
    deliveries = null;
  }
  if (!deliveries) throw new Error('delivery storage has an unsupported schema');
  validateDeliveries(deliveries);
  return deliveries;
}

function readDelivery(filePath, deliveryId) {
  return readDeliveries(filePath).find((delivery) => delivery.id === deliveryId) || null;
}

function writeDeliveries(filePath, deliveries) {
  validateDeliveries(deliveries);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, deliveries }, null, 2));
  fs.renameSync(temporaryPath, filePath);
  return deliveries;
}

module.exports = {
  STORE_VERSION,
  DELIVERY_STATUSES,
  validateDelivery,
  validateAzureSync,
  readDelivery,
  readDeliveries,
  writeDeliveries
};
