'use strict';

const deliveries = [];
let tracks = [];
const agentProfiles = [{ id: 'claude', name: 'Claude padrao', runtime: 'claude', instructions: '' }];
const qualitySkills = [{ id: 'general', name: 'Review geral', baseSkill: 'general', instructions: '', canApply: true }];

function deliveryDefaults(draft, existing) {
  return {
    ...draft,
    id: existing?.id || `delivery-${deliveries.length + 1}`,
    status: existing?.status || 'draft',
    events: existing?.events || [],
    flowSnapshot: existing?.flowSnapshot || null,
    chain: existing?.chain || null,
    azureSync: existing?.azureSync || null,
    scopeExceptions: existing?.scopeExceptions || []
  };
}

const api = {
  readHistory: async () => [],
  listDeliveries: async () => deliveries,
  openDelivery: async (id) => deliveries.find((delivery) => delivery.id === id) || null,
  saveDelivery: async (draft) => {
    const index = deliveries.findIndex((delivery) => delivery.id === draft.id);
    const saved = deliveryDefaults(draft, index >= 0 ? deliveries[index] : null);
    if (index >= 0) deliveries[index] = saved; else deliveries.push(saved);
    return saved;
  },
  recordDeliveryScopeException: async ({ deliveryId, exception }) => {
    const delivery = deliveries.find((item) => item.id === deliveryId);
    const recorded = { id: `exception-${delivery.scopeExceptions.length + 1}`, ...exception, createdAt: '2026-08-29T00:00:00.000Z' };
    delivery.scopeExceptions.push(recorded);
    delivery.events.push({ id: recorded.id, timestamp: recorded.createdAt, kind: 'scope-exception', detail: 'Scope exception recorded.' });
    return delivery;
  },
  listProjectPolicies: async () => [],
  listValidationTracks: async () => tracks,
  saveValidationTrack: async (track) => {
    const saved = { ...track, id: track.id || `track-${tracks.length + 1}` };
    tracks = [...tracks.filter((item) => item.id !== saved.id), saved];
    return saved;
  },
  listAgentProfiles: async () => agentProfiles,
  listQualitySkills: async () => qualitySkills,
  onValidationTrackProgress: () => () => {}
};

window.Notification = { permission: 'denied' };
window.api = new Proxy(api, {
  get: (target, property) => target[property] || (async () => [])
});
