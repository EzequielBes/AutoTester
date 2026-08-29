'use strict';

const deliveries = [];
let tracks = [];
let pendingTrackRun = null;
const agentProfiles = [{ id: 'claude', name: 'Claude padrao', runtime: 'claude', instructions: '' }];
const qualitySkills = [{ id: 'general', name: 'Review geral', baseSkill: 'general', instructions: '', canApply: true }];
const history = [{
  id: 'history-1', kind: 'review', status: 'passed', timestamp: '2026-08-29T00:00:00.000Z',
  branch: 'feature/renderer-smoke', files: ['src/deliveryStore.js'], skill: 'general', intensity: 'full',
  findingsCount: 0, acceptedCount: 0, findings: []
}];

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
  readHistory: async () => history,
  readHistorySettings: async () => ({ maxEntries: 100 }),
  saveHistorySettings: async ({ maxEntries }) => ({ maxEntries }),
  openHistoryEntry: async (id) => history.find((entry) => entry.id === id) || null,
  exportHistoryEntry: async () => '/tmp/autotester-history.json',
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
  listBranches: async () => ['feature/renderer-smoke'],
  getBranchInfo: async () => ({
    isBase: false, ahead: 1, behind: 0, baseBranch: 'Dev', changedFiles: 1,
    lastCommit: { hash: 'abc1234', subject: 'Smoke test', author: 'AutoTester', date: '2026-08-29' }
  }),
  listFiles: async () => ['src/deliveryStore.js'],
  filterFiles: async (files) => files,
  runValidationTrack: async ({ executionId }) => new Promise((resolve) => {
    pendingTrackRun = { executionId, resolve };
  }),
  cancelValidationTrack: async (executionId) => {
    if (!pendingTrackRun || pendingTrackRun.executionId !== executionId) return false;
    pendingTrackRun.resolve({ status: 'cancelled', phases: [], fileContents: {} });
    pendingTrackRun = null;
    return true;
  },
  onValidationTrackProgress: () => () => {}
};

window.Notification = { permission: 'denied' };
window.api = new Proxy(api, {
  get: (target, property) => target[property] || (async () => [])
});
