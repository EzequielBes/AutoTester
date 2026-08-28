'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
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

function readDeliveries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('delivery storage is corrupted');
  }
  if (!data || data.version !== STORE_VERSION || !Array.isArray(data.deliveries)) {
    throw new Error('delivery storage has an unsupported schema');
  }
  validateDeliveries(data.deliveries);
  return data.deliveries;
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
  readDelivery,
  readDeliveries,
  writeDeliveries
};
