'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { listBranches, listAllFiles, listChangedFiles, getBranchInfo } = require('./src/git');
const { buildSystemPrompt } = require('./src/promptBuilder');
const { runClaudeReview } = require('./src/claudeRunner');
const { applyFinding } = require('./src/applyFinding');
const { readHistory, appendHistoryEntry, incrementAccepted } = require('./src/historyStore');
const { resolveInRepo } = require('./src/resolveInRepo');

const PROMPT_FILE = path.join(__dirname, 'prompts', 'review-prompt.md');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function historyFilePath() {
  return path.join(app.getPath('userData'), 'history.json');
}

ipcMain.handle('git:list-branches', (_event, repoPath) => {
  return listBranches(repoPath);
});

ipcMain.handle('git:list-files', (_event, repoPath, branch, changedOnly) => {
  return changedOnly ? listChangedFiles(repoPath, branch) : listAllFiles(repoPath);
});

ipcMain.handle('git:branch-info', (_event, repoPath, branch) => {
  return getBranchInfo(repoPath, branch);
});

ipcMain.handle('review:run', async (_event, { repoPath, files, skill, intensity }) => {
  const systemPrompt = buildSystemPrompt(PROMPT_FILE, skill, intensity);

  const fileContents = {};
  files.forEach((relativePath) => {
    const absolutePath = resolveInRepo(repoPath, relativePath);
    fileContents[relativePath] = fs.readFileSync(absolutePath, 'utf8');
  });
  const content = Object.entries(fileContents)
    .map(([relativePath, fileContent]) => `=== ${relativePath} ===\n${fileContent}`)
    .join('\n\n');

  const findings = await runClaudeReview(systemPrompt, content);

  const historyId = crypto.randomUUID();
  appendHistoryEntry(historyFilePath(), {
    id: historyId,
    timestamp: new Date().toISOString(),
    repoPath,
    files,
    skill,
    intensity,
    findingsCount: findings.length,
    acceptedCount: 0
  });

  return { findings, fileContents, historyId };
});

ipcMain.handle('review:apply-finding', (_event, { repoPath, finding }) => {
  const absolutePath = resolveInRepo(repoPath, finding.file);
  const original = fs.readFileSync(absolutePath, 'utf8');
  const updated = applyFinding(original, finding);
  fs.writeFileSync(absolutePath, updated);
  return { applied: true };
});

ipcMain.handle('history:read', () => {
  return readHistory(historyFilePath());
});

ipcMain.handle('history:record-accept', (_event, historyId) => {
  return incrementAccepted(historyFilePath(), historyId);
});
