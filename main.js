'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const {
  listBranches,
  listAllFiles,
  listChangedFiles,
  readFileAtRef,
  getCurrentBranch,
  getCommitHash,
  getBranchInfo
} = require('./src/git');
const { buildSystemPrompt } = require('./src/promptBuilder');
const { runClaudeReview } = require('./src/claudeRunner');
const { applyFinding } = require('./src/applyFinding');
const { readHistory, appendHistoryEntry, incrementAccepted } = require('./src/historyStore');
const { resolveInRepo } = require('./src/resolveInRepo');
const { findVSCodeExe } = require('./src/editorLocator');
const { validateFindings } = require('./src/findingsSchema');
const { readValidationTracks, writeValidationTracks, validateTrack } = require('./src/validationTrackStore');
const { runValidationTrack } = require('./src/validationRunner');
const { filterFiles } = require('./src/fileScope');

const PROMPT_FILE = path.join(__dirname, 'prompts', 'review-prompt.md');
const reviewRuns = new Map();

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

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

function validationTracksFilePath() {
  return path.join(app.getPath('userData'), 'validation-tracks.json');
}

function assertTrustedRenderer(event) {
  const expectedUrl = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
  if (event.senderFrame.url !== expectedUrl) {
    throw new Error('validation commands are only available from the local renderer');
  }
}

function createReviewSnapshot(repoPath, branch, files) {
  if (!branch) throw new Error('a branch must be selected before running a review');
  const fileContents = {};
  files.forEach((relativePath) => {
    fileContents[relativePath] = readFileAtRef(repoPath, branch, relativePath);
  });
  return {
    fileContents,
    fileHashes: Object.fromEntries(
      Object.entries(fileContents).map(([relativePath, fileContent]) => [relativePath, contentHash(fileContent)])
    ),
    content: Object.entries(fileContents)
      .map(([relativePath, fileContent]) => `=== ${relativePath} ===\n${fileContent}`)
      .join('\n\n'),
    commitHash: getCommitHash(repoPath, branch)
  };
}

function registerReviewRun({ repoPath, branch, files, snapshot, skill, metadata = {} }) {
  const historyId = crypto.randomUUID();
  reviewRuns.set(historyId, {
    repoPath,
    branch,
    commitHash: snapshot.commitHash,
    skill,
    files: new Set(files),
    fileHashes: snapshot.fileHashes
  });
  appendHistoryEntry(historyFilePath(), {
    id: historyId,
    kind: 'review',
    status: 'passed',
    timestamp: new Date().toISOString(),
    repoPath,
    branch,
    files,
    skill,
    intensity: metadata.intensity,
    findingsCount: metadata.findingsCount,
    acceptedCount: 0,
    ...metadata
  });
  return historyId;
}

function buildTrackFromDraft(draft, existing) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('validation track must be an object');
  }
  const now = new Date().toISOString();
  const existingPhases = new Map((existing?.phases || []).map((phase) => [phase.id, phase]));
  const phases = Array.isArray(draft.phases) ? draft.phases.map((phase) => {
    const source = phase && typeof phase === 'object' && !Array.isArray(phase) ? phase : {};
    const id = existingPhases.has(source.id) ? source.id : crypto.randomUUID();
    if (source.type === 'command') {
      return {
        id,
        name: source.name,
        type: 'command',
        command: source.command,
        timeoutMs: Number(source.timeoutMs),
        lcovPath: source.lcovPath,
        expectedExitCode: Number(source.expectedExitCode)
      };
    }
    return {
      id,
      name: source.name,
      type: 'claude',
      agent: source.agent,
      skill: source.skill,
      intensity: source.intensity,
      criteria: source.criteria
    };
  }) : [];
  const track = {
    id: existing ? existing.id : crypto.randomUUID(),
    name: draft.name,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    phases
  };
  validateTrack(track);
  return track;
}

ipcMain.handle('git:list-branches', (_event, repoPath) => {
  return listBranches(repoPath);
});

ipcMain.handle('git:list-files', (_event, repoPath, branch, changedOnly) => {
  return changedOnly ? listChangedFiles(repoPath, branch) : listAllFiles(repoPath, branch);
});

ipcMain.handle('git:filter-files', (_event, files, scope) => {
  return filterFiles(files, scope);
});

ipcMain.handle('git:branch-info', (_event, repoPath, branch) => {
  return getBranchInfo(repoPath, branch);
});

ipcMain.handle('review:run', async (_event, { repoPath, branch, files, skill, intensity }) => {
  const systemPrompt = buildSystemPrompt(PROMPT_FILE, skill, intensity);
  const snapshot = createReviewSnapshot(repoPath, branch, files);
  const findings = await runClaudeReview(systemPrompt, snapshot.content);
  const validation = validateFindings({ findings }, { allowedFiles: files });
  if (!validation.valid) {
    throw new Error(`review returned findings outside the selected scope: ${validation.errors.join('; ')}`);
  }

  const historyId = registerReviewRun({
    repoPath,
    branch,
    files,
    snapshot,
    skill,
    metadata: { intensity, findingsCount: findings.length }
  });

  return { findings, fileContents: snapshot.fileContents, historyId, canApply: skill !== 'tests' };
});

ipcMain.handle('review:apply-finding', (_event, { repoPath, historyId, finding }) => {
  const review = reviewRuns.get(historyId);
  if (!review || review.repoPath !== repoPath) {
    throw new Error('review context is no longer available; run the analysis again');
  }
  if (!review.files.has(finding.file)) {
    throw new Error('finding file is outside the selected review scope');
  }
  if (review.skill === 'tests') {
    throw new Error('test suggestions must be created in a test file, not applied to the reviewed source file');
  }
  if (getCurrentBranch(repoPath) !== review.branch) {
    throw new Error(`current branch differs from the reviewed branch (${review.branch})`);
  }
  if (getCommitHash(repoPath, 'HEAD') !== review.commitHash) {
    throw new Error('branch commit changed since the analysis; run the review again before applying it');
  }
  const absolutePath = resolveInRepo(repoPath, finding.file);
  const original = fs.readFileSync(absolutePath, 'utf8');
  if (contentHash(original) !== review.fileHashes[finding.file]) {
    throw new Error('file changed since the analysis; run the review again before applying it');
  }
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

ipcMain.handle('validation-tracks:list', () => {
  return readValidationTracks(validationTracksFilePath());
});

ipcMain.handle('validation-tracks:save', (_event, draft) => {
  const tracks = readValidationTracks(validationTracksFilePath());
  const existing = typeof draft.id === 'string' ? tracks.find((track) => track.id === draft.id) : null;
  if (draft.id && !existing) throw new Error('validation track was not found');
  const track = buildTrackFromDraft(draft, existing);
  const updatedTracks = existing
    ? tracks.map((item) => item.id === existing.id ? track : item)
    : [...tracks, track];
  writeValidationTracks(validationTracksFilePath(), updatedTracks);
  return track;
});

ipcMain.handle('validation-tracks:delete', (_event, trackId) => {
  const tracks = readValidationTracks(validationTracksFilePath());
  const updatedTracks = tracks.filter((track) => track.id !== trackId);
  if (updatedTracks.length === tracks.length) throw new Error('validation track was not found');
  writeValidationTracks(validationTracksFilePath(), updatedTracks);
  return true;
});

ipcMain.handle('validation-tracks:run', async (event, { trackId, repoPath, branch, files }) => {
  assertTrustedRenderer(event);
  const track = readValidationTracks(validationTracksFilePath()).find((item) => item.id === trackId);
  if (!track) throw new Error('validation track was not found');
  const snapshot = createReviewSnapshot(repoPath, branch, files);
  const commandRepoPath = resolveInRepo(repoPath, '');
  if (track.phases.some((phase) => phase.type === 'command')) {
    if (getCurrentBranch(commandRepoPath) !== branch || getCommitHash(commandRepoPath, 'HEAD') !== snapshot.commitHash) {
      throw new Error('check out the selected branch and commit before executing command phases');
    }
  }
  const trackRunId = crypto.randomUUID();
  const phaseResults = await runValidationTrack({
    track,
    content: snapshot.content,
    allowedFiles: files,
    repoPath: commandRepoPath,
    promptFilePath: PROMPT_FILE
  });
  const phases = phaseResults.map((phase) => {
    const definition = track.phases.find((item) => item.id === phase.phaseId);
    if (phase.type === 'claude' && phase.status === 'passed') {
      const runId = registerReviewRun({
        repoPath,
        branch,
        files,
        snapshot,
        skill: phase.skill,
        metadata: {
          intensity: definition.intensity,
          findingsCount: phase.findings.length,
          trackRunId,
          trackId: track.id,
          trackName: track.name,
          phaseId: phase.phaseId,
          phaseName: phase.phaseName,
          agent: phase.agent
        }
      });
      return { ...phase, runId };
    }

    const historyId = crypto.randomUUID();
    appendHistoryEntry(historyFilePath(), {
      id: historyId,
      kind: phase.type === 'command' ? 'validation-command' : 'review',
      status: phase.status,
      timestamp: new Date().toISOString(),
      repoPath,
      branch,
      headCommit: snapshot.commitHash,
      files,
      trackRunId,
      trackId: track.id,
      trackName: track.name,
      phaseId: phase.phaseId,
      phaseName: phase.phaseName,
      agent: phase.agent,
      skill: phase.skill,
      intensity: definition.intensity,
      findingsCount: 0,
      acceptedCount: 0,
      durationMs: phase.commandResult?.durationMs,
      exitCode: phase.commandResult?.exitCode,
      coverage: phase.coverage,
      error: phase.error
    });
    return { ...phase, historyId };
  });
  return { trackRunId, phases, fileContents: snapshot.fileContents };
});

ipcMain.handle('dialog:pick-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:reveal-repo', (_event, repoPath) => {
  shell.showItemInFolder(path.resolve(repoPath));
  return true;
});

ipcMain.handle('shell:open-in-editor', (_event, { repoPath, file, lines }) => {
  const absolutePath = resolveInRepo(repoPath, file);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`arquivo não encontrado: ${file}`);
  }
  const exe = findVSCodeExe();
  if (!exe) {
    throw new Error('VS Code não encontrado (Code.exe)');
  }
  const line = String(lines).split('-')[0];
  return new Promise((resolve, reject) => {
    execFile(exe, ['--goto', `${absolutePath}:${line}`], { windowsHide: true }, (err) => {
      if (err) reject(err); else resolve(true);
    });
  });
});
