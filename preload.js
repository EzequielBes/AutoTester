'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listBranches: (repoPath) => ipcRenderer.invoke('git:list-branches', repoPath),
  listFiles: (repoPath, branch, changedOnly) => ipcRenderer.invoke('git:list-files', repoPath, branch, changedOnly),
  runReview: (params) => ipcRenderer.invoke('review:run', params),
  applyFinding: (params) => ipcRenderer.invoke('review:apply-finding', params),
  readHistory: () => ipcRenderer.invoke('history:read')
});
