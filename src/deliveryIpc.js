'use strict';

const crypto = require('node:crypto');
const { readDeliveries, readDelivery, writeDeliveries } = require('./deliveryStore');
const { readProjectPolicies } = require('./projectPolicyStore');
const { readValidationTracks } = require('./validationTrackStore');
const { readAgentProfiles } = require('./agentProfileStore');
const { readQualitySkills } = require('./qualitySkillStore');
const { projectAzureEnvelope } = require('./azureEnvelopeSchema');

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
    events: existing ? existing.events : [],
    flowSnapshot: existing ? existing.flowSnapshot : null,
    chain: existing ? existing.chain : null,
    azureSync: existing ? existing.azureSync : null
  };
}

function buildFlowSnapshot(selection = {}, records) {
  const policyIds = new Set(selection.policyIds || []);
  const agentProfileIds = new Set(selection.agentProfileIds || []);
  const qualitySkillIds = new Set(selection.qualitySkillIds || []);
  const track = selection.trackId
    ? records.tracks.find((item) => item.id === selection.trackId) || null
    : null;
  return structuredClone({
    selectedPolicies: records.policies.filter((item) => policyIds.has(item.id)),
    track,
    agentProfiles: records.agentProfiles.filter((item) => agentProfileIds.has(item.id)),
    qualitySkills: records.qualitySkills.filter((item) => qualitySkillIds.has(item.id))
  });
}

function appendEvent(delivery, { kind, detail }) {
  const now = new Date();
  const previousUpdatedAt = new Date(delivery.updatedAt);
  const updatedAt = now <= previousUpdatedAt
    ? new Date(previousUpdatedAt.getTime() + 1).toISOString()
    : now.toISOString();
  return {
    ...delivery,
    updatedAt,
    events: [...delivery.events, { id: crypto.randomUUID(), timestamp: new Date().toISOString(), kind, detail }]
  };
}

function azureFailureDetail(error) {
  const code = typeof error?.code === 'string' && /^AZURE_MCP_[A-Z_]+$/.test(error.code)
    ? error.code
    : 'AZURE_MCP_FAILED';
  return `Azure sync failed (${code})`;
}

function registerDeliveryIpc(ipcMain, {
  deliveriesFilePath,
  projectPoliciesFilePath,
  validationTracksFilePath,
  agentProfilesFilePath,
  qualitySkillsFilePath,
  assertTrustedRenderer,
  runAzureSync,
  suggestChainImpl,
  detectInconsistencies
}) {
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

  ipcMain.handle('deliveries:build-flow-snapshot', (event, { deliveryId, selection } = {}) => {
    assertTrustedRenderer(event);
    const deliveries = readDeliveries(deliveriesFilePath());
    const existing = deliveries.find((item) => item.id === deliveryId);
    if (!existing) throw new Error('delivery was not found');

    const flowSnapshot = buildFlowSnapshot(selection, {
      policies: readProjectPolicies(projectPoliciesFilePath()),
      tracks: readValidationTracks(validationTracksFilePath()),
      agentProfiles: readAgentProfiles(agentProfilesFilePath()),
      qualitySkills: readQualitySkills(qualitySkillsFilePath())
    });
    const delivery = { ...existing, flowSnapshot };
    return writeDeliveries(deliveriesFilePath(), deliveries.map((item) => item.id === existing.id ? delivery : item))
      .find((item) => item.id === delivery.id);
  });

  ipcMain.handle('deliveries:sync-azure', async (event, deliveryId) => {
    assertTrustedRenderer(event);
    const deliveries = readDeliveries(deliveriesFilePath());
    const existing = deliveries.find((item) => item.id === deliveryId);
    if (!existing) throw new Error('delivery was not found');

    let updated = existing;
    try {
      const envelope = projectAzureEnvelope(await runAzureSync(
        { branch: existing.branch },
        { cwd: existing.repoPath }
      ));
      updated = appendEvent({
        ...updated,
        azureSync: { envelope, syncedAt: new Date().toISOString() }
      }, { kind: 'azure-sync', detail: 'Azure metadata synchronized.' });
      const inconsistencies = detectInconsistencies(updated, { azureEnvelope: envelope, allDeliveries: deliveries });
      inconsistencies.forEach((item) => {
        updated = appendEvent(updated, { kind: 'inconsistency', detail: `${item.evidence} — ${item.recommendedAction}` });
      });
    } catch (error) {
      updated = appendEvent(updated, { kind: 'inconsistency', detail: azureFailureDetail(error) });
    }

    if (updated === existing) return existing;
    return writeDeliveries(deliveriesFilePath(), deliveries.map((item) => item.id === existing.id ? updated : item))
      .find((item) => item.id === existing.id);
  });

  ipcMain.handle('deliveries:suggest-chain', async (event, deliveryIds) => {
    assertTrustedRenderer(event);
    return suggestChainImpl(Array.isArray(deliveryIds) ? deliveryIds : []);
  });

  ipcMain.handle('deliveries:confirm-chain', (event, entries) => {
    assertTrustedRenderer(event);
    if (!Array.isArray(entries)) throw new Error('chain entries must be an array');
    const deliveries = readDeliveries(deliveriesFilePath());
    const confirmedAt = new Date().toISOString();
    const byId = new Map(entries.map((entry) => [entry.deliveryId, entry]));
    const next = deliveries.map((delivery) => {
      const entry = byId.get(delivery.id);
      if (!entry) return delivery;
      return {
        ...delivery,
        chain: { chainId: entry.chainId, position: entry.position, dependsOn: entry.dependsOn || [], confirmedAt }
      };
    });
    return writeDeliveries(deliveriesFilePath(), next).filter((item) => byId.has(item.id));
  });
}

module.exports = { azureFailureDetail, registerDeliveryIpc };
