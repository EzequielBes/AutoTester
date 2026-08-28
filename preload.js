'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listBranches: (repoPath) => ipcRenderer.invoke('git:list-branches', repoPath),
  listFiles: (repoPath, branch, changedOnly) => ipcRenderer.invoke('git:list-files', repoPath, branch, changedOnly),
  filterFiles: (files, scope) => ipcRenderer.invoke('git:filter-files', files, scope),
  getBranchInfo: (repoPath, branch) => ipcRenderer.invoke('git:branch-info', repoPath, branch),
  runReview: (params) => ipcRenderer.invoke('review:run', params),
  applyFinding: (params) => ipcRenderer.invoke('review:apply-finding', params),
  listValidationTracks: () => ipcRenderer.invoke('validation-tracks:list'),
  saveValidationTrack: (track) => ipcRenderer.invoke('validation-tracks:save', track),
  deleteValidationTrack: (trackId) => ipcRenderer.invoke('validation-tracks:delete', trackId),
  runValidationTrack: (params) => ipcRenderer.invoke('validation-tracks:run', params),
  cancelValidationTrack: (executionId) => ipcRenderer.invoke('validation-tracks:cancel', executionId),
  onValidationTrackProgress: (listener) => {
    const wrapped = (_event, progress) => listener(progress);
    ipcRenderer.on('validation-tracks:progress', wrapped);
    return () => ipcRenderer.removeListener('validation-tracks:progress', wrapped);
  },
  listAgentProfiles: () => ipcRenderer.invoke('agent-profiles:list'),
  saveAgentProfile: (profile) => ipcRenderer.invoke('agent-profiles:save', profile),
  deleteAgentProfile: (profileId) => ipcRenderer.invoke('agent-profiles:delete', profileId),
  listQualitySkills: () => ipcRenderer.invoke('quality-skills:list'),
  saveQualitySkill: (skill) => ipcRenderer.invoke('quality-skills:save', skill),
  deleteQualitySkill: (skillId) => ipcRenderer.invoke('quality-skills:delete', skillId),
  readHistory: () => ipcRenderer.invoke('history:read'),
  openHistoryEntry: (entryId) => ipcRenderer.invoke('history:open', entryId),
  exportHistoryEntry: (params) => ipcRenderer.invoke('history:export', params),
  recordFindingDecision: (params) => ipcRenderer.invoke('history:record-finding-decision', params),
  readHistorySettings: () => ipcRenderer.invoke('history-settings:read'),
  saveHistorySettings: (settings) => ipcRenderer.invoke('history-settings:save', settings),
  listDeliveries: () => ipcRenderer.invoke('deliveries:list'),
  openDelivery: (deliveryId) => ipcRenderer.invoke('deliveries:open', deliveryId),
  saveDelivery: (draft) => ipcRenderer.invoke('deliveries:save', draft),
  buildDeliveryFlowSnapshot: (params) => ipcRenderer.invoke('deliveries:build-flow-snapshot', params),
  syncAzure: (deliveryId) => ipcRenderer.invoke('deliveries:sync-azure', deliveryId),
  suggestChain: (deliveryIds) => ipcRenderer.invoke('deliveries:suggest-chain', deliveryIds),
  confirmChain: (entries) => ipcRenderer.invoke('deliveries:confirm-chain', entries),
  listProjectPolicies: () => ipcRenderer.invoke('project-policies:list'),
  saveProjectPolicies: (policies) => ipcRenderer.invoke('project-policies:save', policies),
  discoverRepositoryRules: (params) => ipcRenderer.invoke('project-policies:discover', params),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  revealRepo: (repoPath) => ipcRenderer.invoke('shell:reveal-repo', repoPath),
  openInEditor: (params) => ipcRenderer.invoke('shell:open-in-editor', params)
});
