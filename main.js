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
const { readHistory, appendHistoryEntry, retainHistory } = require('./src/historyStore');
const { resolveInRepo } = require('./src/resolveInRepo');
const { findVSCodeExe } = require('./src/editorLocator');
const { validateFindings } = require('./src/findingsSchema');
const { readValidationTracks, writeValidationTracks, validateTrack } = require('./src/validationTrackStore');
const { runValidationTrack, resolveDeliveryFlow } = require('./src/validationRunner');
const { readProjectPolicies, writeProjectPolicies } = require('./src/projectPolicyStore');
const { discoverRepositoryRules } = require('./src/repositoryRuleDiscovery');
const { readDelivery } = require('./src/deliveryStore');
const { filterFiles } = require('./src/fileScope');
const { registerHistoryIpc } = require('./src/historyIpc');
const { registerDeliveryIpc } = require('./src/deliveryIpc');
const { readHistorySettings, writeHistorySettings } = require('./src/historySettingsStore');
const { DEFAULT_AGENT_PROFILE, readAgentProfiles, writeAgentProfiles, validateProfile } = require('./src/agentProfileStore');
const { DEFAULT_QUALITY_SKILLS, readQualitySkills, writeQualitySkills, validateSkill } = require('./src/qualitySkillStore');
const { startSingleInstanceApp } = require('./src/appLifecycle');
const { configureWindowSecurity } = require('./src/windowSecurity');

const PROMPT_FILE = path.join(__dirname, 'prompts', 'review-prompt.md');
const reviewRuns = new Map();
const validationTrackRuns = new Map();
let mainWindow = null;

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  configureWindowSecurity(mainWindow.webContents, localRendererUrl());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function localRendererUrl() {
  return pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

startSingleInstanceApp(app, createWindow, focusMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function historyFilePath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function historySettingsFilePath() {
  return path.join(app.getPath('userData'), 'history-settings.json');
}

function deliveriesFilePath() {
  return path.join(app.getPath('userData'), 'deliveries.json');
}

function appendAuditHistory(entry) {
  const { maxEntries } = readHistorySettings(historySettingsFilePath());
  return appendHistoryEntry(historyFilePath(), entry, maxEntries);
}

function validationTracksFilePath() {
  return path.join(app.getPath('userData'), 'validation-tracks.json');
}

function agentProfilesFilePath() {
  return path.join(app.getPath('userData'), 'agent-profiles.json');
}

function qualitySkillsFilePath() {
  return path.join(app.getPath('userData'), 'quality-skills.json');
}

function projectPoliciesFilePath() {
  return path.join(app.getPath('userData'), 'project-policies.json');
}

function assertTrustedRenderer(event) {
  if (event.senderFrame.url !== localRendererUrl()) {
    throw new Error('validation commands are only available from the local renderer');
  }
}

registerHistoryIpc(ipcMain, {
  historyFilePath,
  assertTrustedRenderer,
  showSaveDialog: dialog.showSaveDialog,
  getWindowFromWebContents: BrowserWindow.fromWebContents
});

registerDeliveryIpc(ipcMain, {
  deliveriesFilePath,
  projectPoliciesFilePath,
  validationTracksFilePath,
  agentProfilesFilePath,
  qualitySkillsFilePath,
  assertTrustedRenderer
});

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
  const applyRunId = crypto.randomUUID();
  reviewRuns.set(applyRunId, {
    repoPath,
    branch,
    commitHash: snapshot.commitHash,
    skill,
    files: new Set(files),
    fileHashes: snapshot.fileHashes
  });
  appendAuditHistory({
    id: historyId,
    kind: 'review',
    status: 'passed',
    timestamp: new Date().toISOString(),
    repoPath,
    branch,
    files,
    skill,
    commitHash: snapshot.commitHash,
    fileHashes: snapshot.fileHashes,
    intensity: metadata.intensity,
    findingsCount: metadata.findingsCount,
    acceptedCount: 0,
    findings: metadata.findings || [],
    criteria: metadata.criteria || '',
    ...metadata
  });
  return { historyId, applyRunId };
}

function assertTrackReferences(track, agentProfiles, qualitySkills) {
  track.phases.filter((phase) => phase.type === 'claude').forEach((phase) => {
    const profile = agentProfiles.find((item) => item.id === phase.agent);
    if (!profile || profile.runtime !== 'claude') {
      throw new Error(`agent profile is not available for phase "${phase.name}"`);
    }
    if (!qualitySkills.some((skill) => skill.id === phase.skill)) {
      throw new Error(`quality skill is not available for phase "${phase.name}"`);
    }
  });
}

function buildAgentProfileFromDraft(draft, existing) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('agent profile must be an object');
  }
  const now = new Date().toISOString();
  const profile = {
    id: existing ? existing.id : crypto.randomUUID(),
    runtime: 'claude',
    name: draft.name,
    instructions: draft.instructions,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  validateProfile(profile);
  return profile;
}

function buildQualitySkillFromDraft(draft, existing) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('quality skill must be an object');
  }
  const now = new Date().toISOString();
  const skill = {
    id: existing ? existing.id : crypto.randomUUID(),
    name: draft.name,
    baseSkill: draft.baseSkill,
    instructions: draft.instructions,
    canApply: false,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  validateSkill(skill);
  return skill;
}

function coverageSourceKey(phase) {
  return contentHash(JSON.stringify({ command: phase.command, lcovPath: phase.lcovPath, fileScope: phase.coverageGate?.fileScope }));
}

function findCoverageBaseline({ repoPath, trackId, phase, files }) {
  if (!phase.coverageGate) return null;
  const sourceKey = coverageSourceKey(phase);
  const selectedFiles = phase.coverageGate.fileScope === 'selected' ? [...files].sort() : null;
  const entry = [...readHistory(historyFilePath())].reverse().find((item) => item.kind === 'validation-command'
    && item.status === 'passed'
    && item.repoPath === repoPath
    && item.trackId === trackId
    && item.phaseId === phase.id
    && item.coverageGate?.sourceKey === sourceKey
    && JSON.stringify(item.coverageGate.selectedFiles || null) === JSON.stringify(selectedFiles));
  if (!entry?.coverageGate?.lines) return null;
  return { historyId: entry.id, timestamp: entry.timestamp, pct: entry.coverageGate.lines.pct };
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
        expectedExitCode: Number(source.expectedExitCode),
        coverageGate: source.coverageGate || null
      };
    }
    return {
      id,
      name: source.name,
      type: 'claude',
        agent: source.agent,
        skill: source.skill,
        intensity: source.intensity,
        criteria: source.criteria,
        parallel: source.parallel === true
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

ipcMain.handle('git:list-branches', (event, repoPath) => {
  assertTrustedRenderer(event);
  return listBranches(repoPath);
});

ipcMain.handle('git:list-files', (event, repoPath, branch, changedOnly) => {
  assertTrustedRenderer(event);
  return changedOnly ? listChangedFiles(repoPath, branch) : listAllFiles(repoPath, branch);
});

app.on('before-quit', () => {
  validationTrackRuns.forEach((run) => run.controller.abort());
});

ipcMain.handle('git:filter-files', (event, files, scope) => {
  assertTrustedRenderer(event);
  return filterFiles(files, scope);
});

ipcMain.handle('git:branch-info', (event, repoPath, branch) => {
  assertTrustedRenderer(event);
  return getBranchInfo(repoPath, branch);
});

ipcMain.handle('review:run', async (event, { repoPath, branch, files, skill, intensity }) => {
  assertTrustedRenderer(event);
  const systemPrompt = buildSystemPrompt(PROMPT_FILE, skill, intensity);
  const snapshot = createReviewSnapshot(repoPath, branch, files);
  const findings = await runClaudeReview(systemPrompt, snapshot.content);
  const validation = validateFindings({ findings }, { allowedFiles: files });
  if (!validation.valid) {
    throw new Error(`review returned findings outside the selected scope: ${validation.errors.join('; ')}`);
  }

  const run = registerReviewRun({
    repoPath,
    branch,
    files,
    snapshot,
    skill,
    metadata: { intensity, findingsCount: findings.length, findings }
  });

  return { findings, fileContents: snapshot.fileContents, historyId: run.historyId, applyRunId: run.applyRunId, canApply: skill !== 'tests' };
});

ipcMain.handle('review:apply-finding', (event, { repoPath, applyRunId, finding }) => {
  assertTrustedRenderer(event);
  const review = reviewRuns.get(applyRunId);
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

ipcMain.handle('validation-tracks:list', (event) => {
  assertTrustedRenderer(event);
  return readValidationTracks(validationTracksFilePath());
});

ipcMain.handle('history-settings:read', (event) => {
  assertTrustedRenderer(event);
  return readHistorySettings(historySettingsFilePath());
});

ipcMain.handle('history-settings:save', (event, settings) => {
  assertTrustedRenderer(event);
  const saved = writeHistorySettings(historySettingsFilePath(), settings);
  retainHistory(historyFilePath(), saved.maxEntries);
  return saved;
});

ipcMain.handle('validation-tracks:save', (event, draft) => {
  assertTrustedRenderer(event);
  const tracks = readValidationTracks(validationTracksFilePath());
  const agentProfiles = readAgentProfiles(agentProfilesFilePath());
  const qualitySkills = readQualitySkills(qualitySkillsFilePath());
  const existing = typeof draft.id === 'string' ? tracks.find((track) => track.id === draft.id) : null;
  if (draft.id && !existing) throw new Error('validation track was not found');
  const track = buildTrackFromDraft(draft, existing);
  assertTrackReferences(track, agentProfiles, qualitySkills);
  const updatedTracks = existing
    ? tracks.map((item) => item.id === existing.id ? track : item)
    : [...tracks, track];
  writeValidationTracks(validationTracksFilePath(), updatedTracks);
  return track;
});

ipcMain.handle('validation-tracks:delete', (event, trackId) => {
  assertTrustedRenderer(event);
  const tracks = readValidationTracks(validationTracksFilePath());
  const updatedTracks = tracks.filter((track) => track.id !== trackId);
  if (updatedTracks.length === tracks.length) throw new Error('validation track was not found');
  writeValidationTracks(validationTracksFilePath(), updatedTracks);
  return true;
});

ipcMain.handle('project-policies:list', (event) => {
  assertTrustedRenderer(event);
  return readProjectPolicies(projectPoliciesFilePath());
});

ipcMain.handle('project-policies:save', (event, policies) => {
  assertTrustedRenderer(event);
  return writeProjectPolicies(projectPoliciesFilePath(), policies);
});

ipcMain.handle('project-policies:discover', (event, { repoPath, branch }) => {
  assertTrustedRenderer(event);
  return discoverRepositoryRules(repoPath, branch);
});

ipcMain.handle('agent-profiles:list', (event) => {
  assertTrustedRenderer(event);
  return readAgentProfiles(agentProfilesFilePath());
});

ipcMain.handle('agent-profiles:save', (event, draft) => {
  assertTrustedRenderer(event);
  const profiles = readAgentProfiles(agentProfilesFilePath());
  const existing = typeof draft.id === 'string' ? profiles.find((profile) => profile.id === draft.id) : null;
  if (draft.id === DEFAULT_AGENT_PROFILE.id) throw new Error('the default agent profile cannot be changed');
  if (draft.id && !existing) throw new Error('agent profile was not found');
  const profile = buildAgentProfileFromDraft(draft, existing);
  const updatedProfiles = existing
    ? profiles.map((item) => item.id === existing.id ? profile : item)
    : [...profiles, profile];
  return writeAgentProfiles(agentProfilesFilePath(), updatedProfiles);
});

ipcMain.handle('agent-profiles:delete', (event, profileId) => {
  assertTrustedRenderer(event);
  if (profileId === DEFAULT_AGENT_PROFILE.id) throw new Error('the default agent profile cannot be deleted');
  const tracks = readValidationTracks(validationTracksFilePath());
  if (tracks.some((track) => track.phases.some((phase) => phase.type === 'claude' && phase.agent === profileId))) {
    throw new Error('agent profile is still used by a validation track');
  }
  const profiles = readAgentProfiles(agentProfilesFilePath());
  const updatedProfiles = profiles.filter((profile) => profile.id !== profileId);
  if (updatedProfiles.length === profiles.length) throw new Error('agent profile was not found');
  return writeAgentProfiles(agentProfilesFilePath(), updatedProfiles);
});

ipcMain.handle('quality-skills:list', (event) => {
  assertTrustedRenderer(event);
  return readQualitySkills(qualitySkillsFilePath());
});

ipcMain.handle('quality-skills:save', (event, draft) => {
  assertTrustedRenderer(event);
  const skills = readQualitySkills(qualitySkillsFilePath());
  const existing = typeof draft.id === 'string' ? skills.find((skill) => skill.id === draft.id) : null;
  if (DEFAULT_QUALITY_SKILLS.some((skill) => skill.id === draft.id)) {
    throw new Error('built-in quality skills cannot be changed');
  }
  if (draft.id && !existing) throw new Error('quality skill was not found');
  const skill = buildQualitySkillFromDraft(draft, existing);
  const updatedSkills = existing
    ? skills.map((item) => item.id === existing.id ? skill : item)
    : [...skills, skill];
  return writeQualitySkills(qualitySkillsFilePath(), updatedSkills);
});

ipcMain.handle('quality-skills:delete', (event, skillId) => {
  assertTrustedRenderer(event);
  if (DEFAULT_QUALITY_SKILLS.some((skill) => skill.id === skillId)) {
    throw new Error('built-in quality skills cannot be deleted');
  }
  const tracks = readValidationTracks(validationTracksFilePath());
  if (tracks.some((track) => track.phases.some((phase) => phase.type === 'claude' && phase.skill === skillId))) {
    throw new Error('quality skill is still used by a validation track');
  }
  const skills = readQualitySkills(qualitySkillsFilePath());
  const updatedSkills = skills.filter((skill) => skill.id !== skillId);
  if (updatedSkills.length === skills.length) throw new Error('quality skill was not found');
  return writeQualitySkills(qualitySkillsFilePath(), updatedSkills);
});

ipcMain.handle('validation-tracks:run', async (event, { executionId, trackId, repoPath, branch, files, deliveryId }) => {
  assertTrustedRenderer(event);
  if (typeof executionId !== 'string' || executionId.length === 0) throw new Error('validation track execution id is required');
  if (validationTrackRuns.has(executionId)) throw new Error('validation track is already running');
  const controller = new AbortController();
  validationTrackRuns.set(executionId, { controller, senderId: event.sender.id });
  const emitProgress = (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('validation-tracks:progress', { executionId, kind: 'phase', ...progress });
  };
  try {
  let track;
  let agentProfiles;
  let qualitySkills;
  if (deliveryId) {
    ({ track, agentProfiles, qualitySkills } = resolveDeliveryFlow({
      deliveryId,
      resolveDelivery: (id) => readDelivery(deliveriesFilePath(), id),
      deliveryRepoPath: repoPath,
      branch
    }));
  } else {
    track = readValidationTracks(validationTracksFilePath()).find((item) => item.id === trackId);
    if (!track) throw new Error('validation track was not found');
    agentProfiles = readAgentProfiles(agentProfilesFilePath());
    qualitySkills = readQualitySkills(qualitySkillsFilePath());
    assertTrackReferences(track, agentProfiles, qualitySkills);
  }
  const snapshot = createReviewSnapshot(repoPath, branch, files);
  const commandRepoPath = resolveInRepo(repoPath, '');
  if (track.phases.some((phase) => phase.type === 'command')) {
    if (getCurrentBranch(commandRepoPath) !== branch || getCommitHash(commandRepoPath, 'HEAD') !== snapshot.commitHash) {
      throw new Error('check out the selected branch and commit before executing command phases');
    }
  }
  const trackRunId = crypto.randomUUID();
  const coverageBaselines = Object.fromEntries(track.phases
    .filter((phase) => phase.type === 'command' && phase.coverageGate)
    .map((phase) => [phase.id, findCoverageBaseline({ repoPath, trackId: track.id, phase, files })]));
  const phaseResults = await runValidationTrack({
    track,
    content: snapshot.content,
    allowedFiles: files,
    repoPath: commandRepoPath,
    agentProfiles,
    qualitySkills,
    coverageBaselines,
    promptFilePath: PROMPT_FILE,
    signal: controller.signal,
    onPhaseProgress: emitProgress
  });
  const phases = phaseResults.map((phase) => {
    const definition = track.phases.find((item) => item.id === phase.phaseId);
    if (phase.type === 'claude' && phase.status === 'passed') {
      const run = registerReviewRun({
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
          agentProfileId: phase.agentProfileId,
          agentProfileName: phase.agentProfileName,
          agentRuntime: phase.agentRuntime,
          skillName: phase.skillName,
          parallel: phase.parallel,
          criteria: definition.criteria,
          findings: phase.findings
        }
      });
      return { ...phase, historyId: run.historyId, applyRunId: run.applyRunId };
    }

    const historyId = crypto.randomUUID();
    appendAuditHistory({
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
      agentProfileId: phase.agentProfileId,
      skill: phase.skill,
      intensity: definition.intensity,
      findingsCount: 0,
      acceptedCount: 0,
      durationMs: phase.commandResult?.durationMs,
      exitCode: phase.commandResult?.exitCode,
      coverage: phase.coverage,
      coverageGate: phase.coverageGate ? {
        ...phase.coverageGate,
        sourceKey: coverageSourceKey(definition),
        selectedFiles: definition.coverageGate.fileScope === 'selected' ? [...files].sort() : null
      } : null,
      error: phase.error,
      parallel: phase.parallel,
      criteria: definition.criteria || '',
      ...(definition.persistLogs === true && phase.commandResult ? {
        logs: {
          stdout: phase.commandResult.stdout.slice(-16384),
          stderr: phase.commandResult.stderr.slice(-16384),
          truncated: phase.commandResult.stdout.length > 16384 || phase.commandResult.stderr.length > 16384
        }
      } : {})
    });
    return { ...phase, historyId };
  });
  const status = controller.signal.aborted ? 'cancelled' : phases.some((phase) => phase.status !== 'passed') ? 'failed' : 'completed';
  if (!event.sender.isDestroyed()) {
    event.sender.send('validation-tracks:progress', { executionId, kind: 'track', status, phases, fileContents: snapshot.fileContents });
  }
  return { trackRunId, status, phases, fileContents: snapshot.fileContents };
  } finally {
    validationTrackRuns.delete(executionId);
  }
});

ipcMain.handle('validation-tracks:cancel', (event, executionId) => {
  assertTrustedRenderer(event);
  const run = validationTrackRuns.get(executionId);
  if (!run || run.senderId !== event.sender.id) return false;
  run.controller.abort();
  return true;
});

ipcMain.handle('dialog:pick-folder', async (event) => {
  assertTrustedRenderer(event);
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:reveal-repo', (event, repoPath) => {
  assertTrustedRenderer(event);
  shell.showItemInFolder(path.resolve(repoPath));
  return true;
});

ipcMain.handle('shell:open-in-editor', (event, { repoPath, file, lines }) => {
  assertTrustedRenderer(event);
  const absolutePath = resolveInRepo(repoPath, file);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`arquivo não encontrado: ${file}`);
  }
  const exe = findVSCodeExe();
  if (!exe) {
    throw new Error('VS Code não encontrado no PATH ou na instalação local');
  }
  const line = String(lines).split('-')[0];
  return new Promise((resolve, reject) => {
    execFile(exe, ['--goto', `${absolutePath}:${line}`], { windowsHide: true }, (err) => {
      if (err) reject(err); else resolve(true);
    });
  });
});
