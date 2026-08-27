'use strict';

let currentFindings = [];
let currentFileContents = {};
let currentRepoPath = '';
let currentHistoryId = null;
let validationTracks = [];
let editingTrackId = null;
let loadedFiles = [];
let visibleFiles = [];
let selectedFiles = new Set();
let fileRequestGeneration = 0;
let fileFilterGeneration = 0;
let branchGeneration = 0;
let executionGeneration = 0;

function invalidateReview() {
  executionGeneration += 1;
  currentFindings = [];
  currentFileContents = {};
  currentHistoryId = null;
  document.getElementById('phase-results').innerHTML = '';
  document.getElementById('results').innerHTML = '';
  setCoreState('', { value: '--', label: 'Standby' });
}

function invalidateFileSelection() {
  fileRequestGeneration += 1;
  fileFilterGeneration += 1;
  loadedFiles = [];
  visibleFiles = [];
  selectedFiles = new Set();
  document.getElementById('file-folder').innerHTML = '<option value="">Todas as pastas</option>';
  document.getElementById('file-selection-count').textContent = '';
  document.getElementById('file-list').innerHTML = '';
  invalidateReview();
}

function resetRepositoryState() {
  branchGeneration += 1;
  currentRepoPath = '';
  document.getElementById('branch-select').innerHTML = '';
  document.getElementById('branch-info').classList.add('hidden');
  invalidateFileSelection();
}

function getRepoPath() {
  return document.getElementById('repo-path').value.trim();
}

function getSelectedFiles() {
  return loadedFiles.filter((file) => selectedFiles.has(file));
}

function setStatus(message, kind) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.classList.remove('running', 'error');
  if (kind) el.classList.add(kind);
}

const CORE_STATE_CLASSES = ['running', 'done', 'warn', 'alert', 'error'];

function setCoreState(state, { value, label } = {}) {
  const core = document.getElementById('hud-core');
  core.classList.remove(...CORE_STATE_CLASSES);
  if (state) core.classList.add(...state.split(' '));
  document.getElementById('core-value').textContent = value ?? '--';
  document.getElementById('core-label').textContent = label ?? 'Standby';
}

function worstSeverityClass(findings) {
  if (findings.some((f) => f.severity === 'high')) return 'done alert';
  if (findings.some((f) => f.severity === 'medium')) return 'done warn';
  return 'done';
}

// --- OS / editor integration ---

if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  Notification.requestPermission();
}

document.getElementById('browse-repo-btn').addEventListener('click', async () => {
  const picked = await window.api.pickFolder();
  if (picked) {
    document.getElementById('repo-path').value = picked;
    resetRepositoryState();
  }
});

document.getElementById('repo-path').addEventListener('input', resetRepositoryState);

document.getElementById('reveal-repo-btn').addEventListener('click', () => {
  const repoPath = getRepoPath();
  if (!repoPath) {
    setStatus('Informe o caminho do repositório primeiro.', 'error');
    return;
  }
  window.api.revealRepo(repoPath);
});

async function populateRecentRepos() {
  try {
    const history = await window.api.readHistory();
    const seen = new Set();
    const recent = [];
    [...history].reverse().forEach((entry) => {
      if (entry.repoPath && !seen.has(entry.repoPath)) {
        seen.add(entry.repoPath);
        recent.push(entry.repoPath);
      }
    });
    const datalist = document.getElementById('recent-repos');
    datalist.innerHTML = '';
    recent.slice(0, 8).forEach((repoPath) => {
      const option = document.createElement('option');
      option.value = repoPath;
      datalist.appendChild(option);
    });
  } catch {
    // history unavailable yet — datalist just stays empty
  }
}

populateRecentRepos();
loadValidationTracks();

// --- Tabs ---

document.getElementById('tab-review').addEventListener('click', () => switchTab('review'));
document.getElementById('tab-tracks').addEventListener('click', () => switchTab('tracks'));
document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));

function switchTab(name) {
  const isReview = name === 'review';
  const isTracks = name === 'tracks';
  const isHistory = name === 'history';
  document.getElementById('view-review').classList.toggle('hidden', !isReview);
  document.getElementById('view-tracks').classList.toggle('hidden', !isTracks);
  document.getElementById('view-history').classList.toggle('hidden', !isHistory);
  [['review', isReview], ['tracks', isTracks], ['history', isHistory]].forEach(([tab, active]) => {
    const element = document.getElementById(`tab-${tab}`);
    element.classList.toggle('active', active);
    element.setAttribute('aria-selected', String(active));
  });
  if (isTracks) loadValidationTracks();
  if (isHistory) loadHistory();
}

// --- Branch loading + info panel ---

document.getElementById('load-branches-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  if (!repoPath) {
    setStatus('Informe o caminho do repositório primeiro.', 'error');
    return;
  }
  currentRepoPath = repoPath;
  resetRepositoryState();
  currentRepoPath = repoPath;
  const requestGeneration = branchGeneration;
  try {
    const branches = await window.api.listBranches(repoPath);
    if (requestGeneration !== branchGeneration || repoPath !== getRepoPath()) return;
    const select = document.getElementById('branch-select');
    select.innerHTML = '';
    branches.forEach((branch) => {
      const option = document.createElement('option');
      option.value = branch;
      option.textContent = branch;
      select.appendChild(option);
    });
    setStatus(`${branches.length} branches carregadas.`);
    if (branches.length > 0) await refreshBranchInfo();
  } catch (err) {
    setStatus(`Erro: ${err.message}`, 'error');
  }
});

document.getElementById('branch-select').addEventListener('change', () => {
  invalidateFileSelection();
  refreshBranchInfo();
});

document.getElementById('changed-only').addEventListener('change', invalidateFileSelection);

async function refreshBranchInfo() {
  const repoPath = getRepoPath();
  const branch = document.getElementById('branch-select').value;
  const infoBox = document.getElementById('branch-info');
  if (!repoPath || !branch) {
    infoBox.classList.add('hidden');
    return;
  }
  try {
    const info = await window.api.getBranchInfo(repoPath, branch);
    if (repoPath !== getRepoPath() || branch !== document.getElementById('branch-select').value) return;
    infoBox.innerHTML = '';
    infoBox.classList.remove('hidden');

    if (!info.isBase) {
      infoBox.appendChild(chip(`↑${info.ahead} ↓${info.behind} vs ${info.baseBranch}`));
      infoBox.appendChild(chip(`${info.changedFiles} arquivo${info.changedFiles === 1 ? '' : 's'} alterado${info.changedFiles === 1 ? '' : 's'}`));
    } else {
      infoBox.appendChild(chip('branch base'));
    }
    const commitChip = chip(`${info.lastCommit.hash} · ${info.lastCommit.subject} (${info.lastCommit.author}, ${info.lastCommit.date})`);
    commitChip.classList.add('commit');
    infoBox.appendChild(commitChip);
  } catch (err) {
    infoBox.classList.add('hidden');
  }
}

function chip(text) {
  const el = document.createElement('span');
  el.className = 'chip';
  el.textContent = text;
  return el;
}

// --- Validation tracks ---

const PHASE_SKILLS = [
  ['general', 'Review geral'],
  ['security', 'Segurança'],
  ['performance', 'Performance'],
  ['tests', 'Geração de testes'],
  ['style', 'Refactor de estilo']
];
const PHASE_INTENSITIES = [['quick', 'Rápido'], ['full', 'Completo']];

function appendSelectOptions(select, options, selected) {
  options.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.appendChild(option);
  });
}

function createPhaseEditor(phase = {}) {
  const editor = document.createElement('section');
  editor.className = 'phase-editor';
  if (phase.id) editor.dataset.phaseId = phase.id;

  const header = document.createElement('div');
  header.className = 'phase-editor-header';
  header.appendChild(document.createTextNode('Fase'));
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.textContent = 'Remover';
  removeButton.addEventListener('click', () => editor.remove());
  header.appendChild(removeButton);
  editor.appendChild(header);

  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Tipo';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'phase-type';
  appendSelectOptions(typeSelect, [['claude', 'Análise por Claude'], ['command', 'Teste por comando']], phase.type || 'claude');
  typeLabel.appendChild(typeSelect);
  editor.appendChild(typeLabel);

  const claudeFields = document.createElement('div');
  claudeFields.className = 'phase-fields phase-claude-fields';

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Nome da fase';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'phase-name';
  nameInput.maxLength = 100;
  nameInput.value = phase.name || '';
  nameLabel.appendChild(nameInput);
  claudeFields.appendChild(nameLabel);

  const row = document.createElement('div');
  row.className = 'row';
  const agentLabel = document.createElement('label');
  agentLabel.className = 'grow';
  agentLabel.textContent = 'Agente';
  const agentSelect = document.createElement('select');
  agentSelect.className = 'phase-agent';
  appendSelectOptions(agentSelect, [['claude', 'Claude CLI']], phase.agent || 'claude');
  agentLabel.appendChild(agentSelect);
  row.appendChild(agentLabel);

  const skillLabel = document.createElement('label');
  skillLabel.className = 'grow';
  skillLabel.textContent = 'Skill';
  const skillSelect = document.createElement('select');
  skillSelect.className = 'phase-skill';
  appendSelectOptions(skillSelect, PHASE_SKILLS, phase.skill || 'general');
  skillLabel.appendChild(skillSelect);
  row.appendChild(skillLabel);

  const intensityLabel = document.createElement('label');
  intensityLabel.className = 'grow';
  intensityLabel.textContent = 'Intensidade';
  const intensitySelect = document.createElement('select');
  intensitySelect.className = 'phase-intensity';
  appendSelectOptions(intensitySelect, PHASE_INTENSITIES, phase.intensity || 'full');
  intensityLabel.appendChild(intensitySelect);
  row.appendChild(intensityLabel);
  claudeFields.appendChild(row);

  const criteriaLabel = document.createElement('label');
  criteriaLabel.textContent = 'Critérios adicionais (opcional)';
  const criteriaInput = document.createElement('textarea');
  criteriaInput.className = 'phase-criteria';
  criteriaInput.maxLength = 2000;
  criteriaInput.placeholder = 'Ex.: Exigir testes para fluxos de erro e autorização.';
  criteriaInput.value = phase.criteria || '';
  criteriaLabel.appendChild(criteriaInput);
  claudeFields.appendChild(criteriaLabel);
  editor.appendChild(claudeFields);

  const commandFields = document.createElement('div');
  commandFields.className = 'phase-fields phase-command-fields';
  const commandNameLabel = document.createElement('label');
  commandNameLabel.textContent = 'Nome da fase';
  const commandNameInput = document.createElement('input');
  commandNameInput.type = 'text';
  commandNameInput.className = 'phase-command-name';
  commandNameInput.maxLength = 100;
  commandNameInput.value = phase.name || '';
  commandNameLabel.appendChild(commandNameInput);
  commandFields.appendChild(commandNameLabel);

  const commandLabel = document.createElement('label');
  commandLabel.textContent = 'Comando';
  const commandInput = document.createElement('textarea');
  commandInput.className = 'phase-command';
  commandInput.maxLength = 2000;
  commandInput.placeholder = 'Ex.: npm test -- --coverage';
  commandInput.value = phase.command || '';
  commandLabel.appendChild(commandInput);
  commandFields.appendChild(commandLabel);

  const commandRow = document.createElement('div');
  commandRow.className = 'row';
  const timeoutLabel = document.createElement('label');
  timeoutLabel.className = 'grow';
  timeoutLabel.textContent = 'Timeout (segundos)';
  const timeoutInput = document.createElement('input');
  timeoutInput.type = 'number';
  timeoutInput.className = 'phase-timeout';
  timeoutInput.min = '1';
  timeoutInput.max = '3600';
  timeoutInput.value = String((phase.timeoutMs || 600000) / 1000);
  timeoutLabel.appendChild(timeoutInput);
  commandRow.appendChild(timeoutLabel);
  const exitCodeLabel = document.createElement('label');
  exitCodeLabel.className = 'grow';
  exitCodeLabel.textContent = 'Código de saída esperado';
  const exitCodeInput = document.createElement('input');
  exitCodeInput.type = 'number';
  exitCodeInput.className = 'phase-exit-code';
  exitCodeInput.min = '0';
  exitCodeInput.max = '255';
  exitCodeInput.value = String(phase.expectedExitCode ?? 0);
  exitCodeLabel.appendChild(exitCodeInput);
  commandRow.appendChild(exitCodeLabel);
  commandFields.appendChild(commandRow);

  const lcovLabel = document.createElement('label');
  lcovLabel.textContent = 'Arquivo LCOV (opcional)';
  const lcovInput = document.createElement('input');
  lcovInput.type = 'text';
  lcovInput.className = 'phase-lcov-path';
  lcovInput.maxLength = 500;
  lcovInput.placeholder = 'Ex.: coverage/lcov.info';
  lcovInput.value = phase.lcovPath || '';
  lcovLabel.appendChild(lcovInput);
  commandFields.appendChild(lcovLabel);
  editor.appendChild(commandFields);

  const updateType = () => {
    const isClaude = typeSelect.value === 'claude';
    claudeFields.classList.toggle('hidden', !isClaude);
    commandFields.classList.toggle('hidden', isClaude);
  };
  typeSelect.addEventListener('change', updateType);
  updateType();
  return editor;
}

function renderTrackEditor(track) {
  editingTrackId = track ? track.id : null;
  document.getElementById('track-name').value = track ? track.name : '';
  const phaseList = document.getElementById('track-phase-list');
  phaseList.innerHTML = '';
  (track ? track.phases : [{ type: 'claude', name: 'Review geral', agent: 'claude', skill: 'general', intensity: 'full', criteria: '' }])
    .forEach((phase) => phaseList.appendChild(createPhaseEditor(phase)));
  document.getElementById('delete-track-btn').disabled = !track;
}

function renderTrackList() {
  const list = document.getElementById('track-list');
  list.innerHTML = '';
  if (validationTracks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma trilha salva ainda.';
    list.appendChild(empty);
    return;
  }
  validationTracks.forEach((track) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track-list-entry';
    if (track.id === editingTrackId) button.classList.add('active');
    const name = document.createElement('strong');
    name.textContent = track.name;
    const phaseCount = document.createElement('span');
    phaseCount.textContent = `${track.phases.length} fase${track.phases.length === 1 ? '' : 's'}`;
    button.append(name, phaseCount);
    button.addEventListener('click', () => {
      renderTrackEditor(track);
      renderTrackList();
    });
    list.appendChild(button);
  });
}

function populateTrackSelect() {
  const select = document.getElementById('track-select');
  const selected = select.value;
  select.innerHTML = '';
  const singleRun = document.createElement('option');
  singleRun.value = '';
  singleRun.textContent = 'Execução única';
  select.appendChild(singleRun);
  validationTracks.forEach((track) => {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.name;
    select.appendChild(option);
  });
  select.value = validationTracks.some((track) => track.id === selected) ? selected : '';
}

async function loadValidationTracks() {
  try {
    validationTracks = await window.api.listValidationTracks();
    populateTrackSelect();
    const editedTrack = validationTracks.find((track) => track.id === editingTrackId);
    renderTrackEditor(editedTrack || validationTracks[0] || null);
    renderTrackList();
  } catch (err) {
    setStatus(`Erro ao carregar trilhas: ${err.message}`, 'error');
  }
}

function getTrackDraft() {
  const phases = Array.from(document.querySelectorAll('.phase-editor')).map((editor) => {
    const type = editor.querySelector('.phase-type').value;
    if (type === 'command') {
      return {
        id: editor.dataset.phaseId,
        type,
        name: editor.querySelector('.phase-command-name').value.trim(),
        command: editor.querySelector('.phase-command').value.trim(),
        timeoutMs: Number(editor.querySelector('.phase-timeout').value) * 1000,
        expectedExitCode: Number(editor.querySelector('.phase-exit-code').value),
        lcovPath: editor.querySelector('.phase-lcov-path').value.trim()
      };
    }
    return {
      id: editor.dataset.phaseId,
      type,
      name: editor.querySelector('.phase-name').value.trim(),
      agent: editor.querySelector('.phase-agent').value,
      skill: editor.querySelector('.phase-skill').value,
      intensity: editor.querySelector('.phase-intensity').value,
      criteria: editor.querySelector('.phase-criteria').value.trim()
    };
  });
  return { id: editingTrackId, name: document.getElementById('track-name').value.trim(), phases };
}

document.getElementById('new-track-btn').addEventListener('click', () => {
  renderTrackEditor(null);
  renderTrackList();
});

document.getElementById('add-phase-btn').addEventListener('click', () => {
  document.getElementById('track-phase-list').appendChild(createPhaseEditor());
});

document.getElementById('save-track-btn').addEventListener('click', async () => {
  try {
    const savedTrack = await window.api.saveValidationTrack(getTrackDraft());
    editingTrackId = savedTrack.id;
    await loadValidationTracks();
    setStatus(`Trilha "${savedTrack.name}" salva.`);
  } catch (err) {
    setStatus(`Erro ao salvar trilha: ${err.message}`, 'error');
  }
});

document.getElementById('delete-track-btn').addEventListener('click', async () => {
  if (!editingTrackId) return;
  const track = validationTracks.find((item) => item.id === editingTrackId);
  if (!track || !window.confirm(`Excluir a trilha "${track.name}"?`)) return;
  try {
    await window.api.deleteValidationTrack(track.id);
    editingTrackId = null;
    await loadValidationTracks();
    setStatus(`Trilha "${track.name}" excluída.`);
  } catch (err) {
    setStatus(`Erro ao excluir trilha: ${err.message}`, 'error');
  }
});

function setExecutionRunning(isRunning) {
  document.getElementById('run-btn').disabled = isRunning;
  document.getElementById('run-track-btn').disabled = isRunning;
}

// --- Files ---

function parentFolder(file) {
  const slash = file.lastIndexOf('/');
  return slash === -1 ? '(raiz)' : file.slice(0, slash);
}

function populateFolderFilter() {
  const select = document.getElementById('file-folder');
  const selectedFolder = select.value;
  select.innerHTML = '<option value="">Todas as pastas</option>';
  [...new Set(loadedFiles.map(parentFolder))].sort().forEach((folder) => {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = folder;
    select.appendChild(option);
  });
  select.value = [...select.options].some((option) => option.value === selectedFolder) ? selectedFolder : '';
}

function updateFileSelectionCount() {
  const hiddenSelected = [...selectedFiles].filter((file) => !visibleFiles.includes(file)).length;
  const message = `${selectedFiles.size} selecionado${selectedFiles.size === 1 ? '' : 's'} de ${loadedFiles.length}`;
  document.getElementById('file-selection-count').textContent = hiddenSelected > 0
    ? `${message} (${hiddenSelected} oculto${hiddenSelected === 1 ? '' : 's'} pelo filtro)`
    : message;
}

function renderFileList() {
  const container = document.getElementById('file-list');
  container.innerHTML = '';
  if (visibleFiles.length === 0 && loadedFiles.length > 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum arquivo corresponde ao filtro atual.';
    container.appendChild(empty);
    updateFileSelectionCount();
    return;
  }

  const filesByFolder = new Map();
  visibleFiles.forEach((file) => {
    const folder = parentFolder(file);
    const files = filesByFolder.get(folder) || [];
    files.push(file);
    filesByFolder.set(folder, files);
  });
  [...filesByFolder.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([folder, files]) => {
    const group = document.createElement('div');
    group.className = 'file-folder-group';
    const folderRow = document.createElement('label');
    folderRow.className = 'file-folder-row';
    const folderCheckbox = document.createElement('input');
    folderCheckbox.type = 'checkbox';
    const selectedCount = files.filter((file) => selectedFiles.has(file)).length;
    folderCheckbox.checked = selectedCount === files.length;
    folderCheckbox.indeterminate = selectedCount > 0 && selectedCount < files.length;
    folderCheckbox.addEventListener('change', () => {
      files.forEach((file) => {
        if (folderCheckbox.checked) selectedFiles.add(file); else selectedFiles.delete(file);
      });
      invalidateReview();
      renderFileList();
    });
    folderRow.append(folderCheckbox, document.createTextNode(`${folder} (${files.length})`));
    group.appendChild(folderRow);

    files.forEach((file) => {
      const row = document.createElement('label');
      row.className = 'file-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedFiles.has(file);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedFiles.add(file); else selectedFiles.delete(file);
        invalidateReview();
        renderFileList();
      });
      row.append(checkbox, document.createTextNode(file));
      group.appendChild(row);
    });
    container.appendChild(group);
  });
  updateFileSelectionCount();
}

async function applyFileFilters() {
  const requestGeneration = ++fileFilterGeneration;
  const folder = document.getElementById('file-folder').value;
  const scope = document.getElementById('file-glob').value;
  const folderFiles = folder ? loadedFiles.filter((file) => parentFolder(file) === folder) : loadedFiles;
  try {
    const files = await window.api.filterFiles(folderFiles, scope);
    if (requestGeneration !== fileFilterGeneration) return;
    visibleFiles = files;
    renderFileList();
  } catch (err) {
    if (requestGeneration !== fileFilterGeneration) return;
    visibleFiles = [];
    renderFileList();
    setStatus(`Filtro inválido: ${err.message}`, 'error');
  }
}

document.getElementById('file-folder').addEventListener('change', applyFileFilters);
document.getElementById('file-glob').addEventListener('input', applyFileFilters);
document.getElementById('select-visible-files-btn').addEventListener('click', () => {
  visibleFiles.forEach((file) => selectedFiles.add(file));
  invalidateReview();
  renderFileList();
});
document.getElementById('clear-file-selection-btn').addEventListener('click', () => {
  selectedFiles.clear();
  invalidateReview();
  renderFileList();
});

document.getElementById('load-files-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  const branch = document.getElementById('branch-select').value;
  const changedOnly = document.getElementById('changed-only').checked;
  if (!repoPath || !branch) {
    setStatus('Carregue as branches e selecione uma antes.', 'error');
    return;
  }
  const requestGeneration = ++fileRequestGeneration;
  loadedFiles = [];
  visibleFiles = [];
  selectedFiles.clear();
  renderFileList();
  invalidateReview();
  try {
    const files = await window.api.listFiles(repoPath, branch, changedOnly);
    if (requestGeneration !== fileRequestGeneration || repoPath !== getRepoPath()
      || branch !== document.getElementById('branch-select').value
      || changedOnly !== document.getElementById('changed-only').checked) return;
    loadedFiles = files;
    populateFolderFilter();
    await applyFileFilters();
    setStatus(`${files.length} arquivos carregados.`);
  } catch (err) {
    setStatus(`Erro: ${err.message}`, 'error');
  }
});

// --- Run review ---

document.getElementById('run-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  const files = getSelectedFiles();
  const skill = document.getElementById('skill-select').value;
  const intensity = document.getElementById('intensity-select').value;
  const branch = document.getElementById('branch-select').value;

  if (!repoPath || !branch || files.length === 0) {
    setStatus('Selecione ao menos um arquivo antes de rodar.', 'error');
    return;
  }
  currentRepoPath = repoPath;
  invalidateReview();
  const runGeneration = executionGeneration;
  setStatus('Rodando análise...', 'running');
  setCoreState('running', { value: '···', label: 'Executando' });
  setExecutionRunning(true);

  try {
    const response = await window.api.runReview({ repoPath, branch, files, skill, intensity });
    if (runGeneration !== executionGeneration) return;
    currentFindings = response.findings.map((finding, index) => ({ ...finding, id: index, status: 'pending' }));
    currentFileContents = response.fileContents;
    currentHistoryId = response.historyId;
    currentFindings = currentFindings.map((finding) => ({ ...finding, canApply: response.canApply, runId: response.historyId }));
    renderFindings();
    const n = currentFindings.length;
    setStatus(`${n} finding${n === 1 ? '' : 's'} encontrado${n === 1 ? '' : 's'}.`);
    setCoreState(worstSeverityClass(currentFindings), { value: n, label: n === 1 ? 'Finding' : 'Findings' });
    populateRecentRepos();
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Review GUI', { body: `${n} finding${n === 1 ? '' : 's'} encontrado${n === 1 ? '' : 's'} em ${repoPath}` });
    }
  } catch (err) {
    if (runGeneration !== executionGeneration) return;
    setStatus(`Erro: ${err.message}`, 'error');
    setCoreState('error', { value: '!!', label: 'Erro' });
  } finally {
    setExecutionRunning(false);
  }
});

document.getElementById('run-track-btn').addEventListener('click', async () => {
  const trackId = document.getElementById('track-select').value;
  const repoPath = getRepoPath();
  const branch = document.getElementById('branch-select').value;
  const files = getSelectedFiles();
  const track = validationTracks.find((item) => item.id === trackId);
  if (!trackId || !track) {
    setStatus('Selecione uma trilha de validação antes de executar.', 'error');
    return;
  }
  if (!repoPath || !branch || files.length === 0) {
    setStatus('Selecione repositório, branch e ao menos um arquivo antes de rodar.', 'error');
    return;
  }
  if (track.phases.some((phase) => phase.type === 'command') && !window.confirm(
    `Esta trilha executará comandos configurados no repositório ${repoPath}. Eles podem alterar o working tree da branch ${branch}. Continuar?`
  )) {
    return;
  }

  currentRepoPath = repoPath;
  invalidateReview();
  const runGeneration = executionGeneration;
  setStatus(`Executando trilha "${track.name}" em ${track.phases.length} fase${track.phases.length === 1 ? '' : 's'}...`, 'running');
  setCoreState('running', { value: '···', label: 'Executando trilha' });
  setExecutionRunning(true);
  try {
    const response = await window.api.runValidationTrack({ trackId, repoPath, branch, files });
    if (runGeneration !== executionGeneration) return;
    let findingId = 0;
    currentFindings = response.phases.flatMap((phase) => (phase.findings || []).map((finding) => ({
      ...finding,
      id: findingId++,
      status: 'pending',
      runId: phase.runId,
      canApply: phase.canApply,
      phaseName: phase.phaseName
    })));
    currentFileContents = response.fileContents;
    const n = currentFindings.length;
    renderPhaseResults(response.phases);
    renderFindings();
    setStatus(`Trilha "${track.name}" concluída: ${response.phases.length} fases, ${n} finding${n === 1 ? '' : 's'}.`);
    setCoreState(worstSeverityClass(currentFindings), { value: n, label: n === 1 ? 'Finding' : 'Findings' });
    populateRecentRepos();
  } catch (err) {
    if (runGeneration !== executionGeneration) return;
    setStatus(`Erro na trilha: ${err.message}`, 'error');
    setCoreState('error', { value: '!!', label: 'Erro' });
  } finally {
    setExecutionRunning(false);
  }
});

function renderPhaseResults(phases) {
  const container = document.getElementById('phase-results');
  container.innerHTML = '';
  phases.forEach((phase) => {
    const card = document.createElement('section');
    card.className = `phase-result status-${phase.status}`;
    const header = document.createElement('div');
    header.className = 'phase-result-header';
    const title = document.createElement('strong');
    title.textContent = phase.phaseName;
    const status = document.createElement('span');
    status.className = 'status-label';
    status.textContent = phase.status;
    header.append(title, status);
    card.appendChild(header);

    const detail = document.createElement('div');
    detail.className = 'helper-text';
    if (phase.type === 'claude') {
      detail.textContent = phase.status === 'passed'
        ? `${phase.findings.length} finding${phase.findings.length === 1 ? '' : 's'} na análise.`
        : phase.error || 'A análise falhou.';
    } else {
      const result = phase.commandResult || {};
      const duration = typeof result.durationMs === 'number' ? `${(result.durationMs / 1000).toFixed(1)}s` : '';
      const exitCode = result.exitCode === null || result.exitCode === undefined ? '' : `saída ${result.exitCode}`;
      const coverage = phase.coverage ? `cobertura de linhas ${phase.coverage.lines.pct}%` : '';
      detail.textContent = [phase.error || phase.status, exitCode, duration, coverage].filter(Boolean).join(' · ');
    }
    card.appendChild(detail);

    if (phase.type === 'command') {
      const logs = [phase.commandResult?.stdout, phase.commandResult?.stderr].filter(Boolean).join('\n');
      if (logs) {
        const output = document.createElement('pre');
        output.className = 'phase-log';
        output.textContent = logs;
        card.appendChild(output);
      }
    }
    container.appendChild(card);
  });
}

function snippetLines(file, lines) {
  const content = currentFileContents[file] || '';
  const [start, end] = lines.includes('-') ? lines.split('-').map(Number) : [Number(lines), Number(lines)];
  const fileLines = content.split(/\r\n|\n/);
  return fileLines.slice(start - 1, end).join('\n');
}

function renderFindings() {
  const container = document.getElementById('results');
  container.innerHTML = '';

  currentFindings.forEach((finding) => {
    const card = document.createElement('div');
    card.className = `finding severity-${finding.severity}`;

    const header = document.createElement('div');
    header.className = 'finding-header';

    const location = document.createElement('span');
    location.textContent = `${finding.file}:${finding.lines}`;
    header.appendChild(location);

    const severityBadge = document.createElement('span');
    severityBadge.className = `badge severity-${finding.severity}`;
    severityBadge.textContent = finding.severity;
    header.appendChild(severityBadge);

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'status-label';
    categoryBadge.textContent = finding.category;
    header.appendChild(categoryBadge);

    if (finding.phaseName) {
      const phaseBadge = document.createElement('span');
      phaseBadge.className = 'status-label';
      phaseBadge.textContent = finding.phaseName;
      header.appendChild(phaseBadge);
    }

    card.appendChild(header);

    const message = document.createElement('p');
    message.textContent = finding.message;
    card.appendChild(message);

    const removed = document.createElement('pre');
    removed.className = 'diff-removed';
    removed.textContent = snippetLines(finding.file, finding.lines);
    card.appendChild(removed);

    if (finding.suggestion) {
      const added = document.createElement('pre');
      added.className = 'diff-added';
      added.textContent = finding.suggestion;
      card.appendChild(added);
    }

    const actions = document.createElement('div');
    actions.className = 'finding-actions';

    const isPending = finding.status === 'pending';
    const canApply = finding.canApply !== false;

    const editorBtn = document.createElement('button');
    editorBtn.textContent = 'Abrir no editor';
    editorBtn.addEventListener('click', async () => {
      try {
        await window.api.openInEditor({ repoPath: currentRepoPath, file: finding.file, lines: finding.lines });
      } catch (err) {
        setStatus(`Erro ao abrir editor: ${err.message}`, 'error');
      }
    });
    actions.appendChild(editorBtn);

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'primary';
    acceptBtn.textContent = canApply ? 'Aplicar alteração' : 'Aplicação indisponível';
    acceptBtn.disabled = !isPending || !canApply;
    if (!canApply) {
      acceptBtn.title = 'Sugestões de teste precisam ser criadas em um arquivo de teste dedicado.';
    }
    acceptBtn.addEventListener('click', () => acceptFinding(finding.id));

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Rejeitar';
    rejectBtn.disabled = !isPending;
    rejectBtn.addEventListener('click', () => rejectFinding(finding.id));

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);

    if (!isPending) {
      const statusLabel = document.createElement('span');
      statusLabel.className = 'status-label';
      statusLabel.textContent = finding.status;
      actions.appendChild(statusLabel);
    }

    card.appendChild(actions);
    container.appendChild(card);
  });
}

async function acceptFinding(id) {
  const finding = currentFindings.find((f) => f.id === id);
  if (!finding || finding.status !== 'pending' || finding.canApply === false) return;
  if (!window.confirm(`Aplicar alteração em ${finding.file}:${finding.lines}? Isso escreverá a sugestão no disco.`)) {
    return;
  }

  // Set an in-flight sentinel synchronously (before the await) so a second
  // fast click on the same finding is rejected by the guard above instead
  // of racing past it and double-applying the edit.
  finding.status = 'aplicando';
  renderFindings();

  try {
    const runId = finding.runId || currentHistoryId;
    await window.api.applyFinding({ repoPath: currentRepoPath, historyId: runId, finding });
    finding.status = 'aplicado';
    if (runId) {
      window.api.recordAccept(runId).catch(() => {});
    }

    // ponytail: applying one finding shifts line numbers for any other
    // pending finding in the same file, invalidating its "lines" range.
    // Rather than remapping offsets, mark siblings stale and require a
    // fresh run — upgrade to offset remapping only if re-running becomes
    // a real friction point.
    currentFindings
      .filter((f) => f.file === finding.file && f.id !== finding.id && f.status === 'pending')
      .forEach((f) => { f.status = 'obsoleto (rode a análise de novo)'; });

    setStatus(`Finding aplicado em ${finding.file}.`);
  } catch (err) {
    finding.status = 'pending';
    setStatus(`Erro ao aplicar: ${err.message}`, 'error');
  }
  renderFindings();
}

function rejectFinding(id) {
  const finding = currentFindings.find((f) => f.id === id);
  if (!finding || finding.status !== 'pending') return;
  finding.status = 'rejeitado';
  renderFindings();
}

// --- History tab ---

async function loadHistory() {
  const summaryEl = document.getElementById('history-summary');
  const listEl = document.getElementById('history-list');
  summaryEl.textContent = '';
  listEl.innerHTML = '';

  let history;
  try {
    history = await window.api.readHistory();
  } catch (err) {
    listEl.innerHTML = '';
    const errEl = document.createElement('div');
    errEl.className = 'empty-state';
    errEl.textContent = `Erro ao carregar histórico: ${err.message}`;
    listEl.appendChild(errEl);
    return;
  }

  const reviewHistory = history.filter((entry) => entry.kind !== 'validation-command');
  const totalRuns = reviewHistory.length;
  const totalFindings = reviewHistory.reduce((sum, e) => sum + (e.findingsCount || 0), 0);
  const totalAccepted = reviewHistory.reduce((sum, e) => sum + (e.acceptedCount || 0), 0);
  const overallRate = totalFindings > 0 ? Math.round((totalAccepted / totalFindings) * 100) : null;

  summaryEl.appendChild(stat(totalRuns, 'Reviews rodados'));
  summaryEl.appendChild(stat(totalFindings, 'Findings totais'));
  summaryEl.appendChild(stat(overallRate === null ? '—' : `${overallRate}%`, 'Taxa de aceite'));

  if (totalRuns === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma review rodada ainda.';
    listEl.appendChild(empty);
    return;
  }

  [...history].reverse().forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'history-entry';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const when = new Date(entry.timestamp).toLocaleString('pt-BR');
    const fileCount = entry.files && entry.files.length
      ? `${entry.files.length} arquivo${entry.files.length === 1 ? '' : 's'}`
      : '';
    const strong = document.createElement('strong');
    strong.textContent = entry.trackName
      ? `${entry.trackName} / ${entry.phaseName}`
      : `${entry.skill} / ${entry.intensity}`;
    meta.appendChild(strong);
    meta.appendChild(document.createTextNode(` — ${[entry.branch, fileCount, entry.agent].filter(Boolean).join(' / ')} — ${when}`));
    row.appendChild(meta);

    const rate = document.createElement('div');
    rate.className = 'rate';
    if (entry.kind === 'validation-command') {
      const coverage = entry.coverage ? ` · cobertura ${entry.coverage.lines.pct}%` : '';
      const duration = typeof entry.durationMs === 'number' ? ` · ${(entry.durationMs / 1000).toFixed(1)}s` : '';
      rate.textContent = `${entry.status || 'unknown'}${coverage}${duration}`;
    } else {
      const accepted = entry.acceptedCount || 0;
      const found = entry.findingsCount || 0;
      const pct = found > 0 ? Math.round((accepted / found) * 100) : null;
      rate.textContent = found === 0 ? 'sem findings' : `${accepted}/${found} aceitos (${pct}%)`;
    }
    row.appendChild(rate);

    listEl.appendChild(row);
  });
}

function stat(value, label) {
  const wrap = document.createElement('div');
  wrap.className = 'stat';
  const valueEl = document.createElement('div');
  valueEl.className = 'value';
  valueEl.textContent = String(value);
  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;
  wrap.appendChild(valueEl);
  wrap.appendChild(labelEl);
  return wrap;
}
