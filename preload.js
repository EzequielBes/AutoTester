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
  readHistory: () => ipcRenderer.invoke('history:read'),
  recordAccept: (historyId) => ipcRenderer.invoke('history:record-accept', historyId),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  revealRepo: (repoPath) => ipcRenderer.invoke('shell:reveal-repo', repoPath),
  openInEditor: (params) => ipcRenderer.invoke('shell:open-in-editor', params)
});
