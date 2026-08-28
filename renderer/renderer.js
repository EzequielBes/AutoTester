'use strict';

let currentFindings = [];
let currentFileContents = {};
let currentRepoPath = '';
let currentHistoryId = null;
let validationTracks = [];
let editingTrackId = null;
let agentProfiles = [{ id: 'claude', name: 'Claude padrão', runtime: 'claude', instructions: '' }];
let editingAgentProfileId = null;
let qualitySkills = [
  { id: 'general', name: 'Review geral', baseSkill: 'general', instructions: '', canApply: true },
  { id: 'security', name: 'Segurança', baseSkill: 'security', instructions: '', canApply: true },
  { id: 'performance', name: 'Performance', baseSkill: 'performance', instructions: '', canApply: true },
  { id: 'tests', name: 'Geração de testes', baseSkill: 'tests', instructions: '', canApply: false },
  { id: 'style', name: 'Refactor de estilo', baseSkill: 'style', instructions: '', canApply: true }
];
let editingQualitySkillId = null;
let loadedFiles = [];
let visibleFiles = [];
let selectedFiles = new Set();
let fileRequestGeneration = 0;
let fileFilterGeneration = 0;
let branchGeneration = 0;
let executionGeneration = 0;
let activeTrackExecutionId = null;
let livePhaseResults = new Map();
let deliveries = [];
let editingDeliveryId = null;
let chainSuggestionState = null;
let projectPolicies = [];
let discoveredRules = [];
let selectedPolicyIds = new Set();
let selectedAgentProfileIds = new Set();
let selectedQualitySkillIds = new Set();

function invalidateReview() {
  if (activeTrackExecutionId) {
    window.api.cancelValidationTrack(activeTrackExecutionId).catch(() => {});
  }
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
loadAgentProfiles();
loadQualitySkills();
renderDeliveryEditor(null);
switchTab('deliveries');

// --- Tabs ---

document.getElementById('tab-deliveries').addEventListener('click', () => switchTab('deliveries'));
document.getElementById('tab-review').addEventListener('click', () => switchTab('review'));
document.getElementById('tab-tracks').addEventListener('click', () => switchTab('tracks'));
document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));
['history-query', 'history-kind-filter', 'history-status-filter', 'history-from-filter', 'history-to-filter'].forEach((id) => {
  document.getElementById(id).addEventListener(id === 'history-query' ? 'input' : 'change', loadHistory);
});
document.getElementById('save-history-settings-btn').addEventListener('click', async () => {
  try {
    const maxEntries = Number(document.getElementById('history-retention').value);
    const settings = await window.api.saveHistorySettings({ maxEntries });
    document.getElementById('history-retention').value = settings.maxEntries;
    setStatus(`Histórico limitado às últimas ${settings.maxEntries} execuções.`);
    await loadHistory();
  } catch (err) {
    setStatus(`Erro ao salvar retenção: ${err.message}`, 'error');
  }
});

function switchTab(name) {
  const isDeliveries = name === 'deliveries';
  const isReview = name === 'review';
  const isTracks = name === 'tracks';
  const isHistory = name === 'history';
  document.getElementById('view-deliveries').classList.toggle('hidden', !isDeliveries);
  document.getElementById('view-review').classList.toggle('hidden', !isReview);
  document.getElementById('view-tracks').classList.toggle('hidden', !isTracks);
  document.getElementById('view-history').classList.toggle('hidden', !isHistory);
  [['deliveries', isDeliveries], ['review', isReview], ['tracks', isTracks], ['history', isHistory]].forEach(([tab, active]) => {
    const element = document.getElementById(`tab-${tab}`);
    element.classList.toggle('active', active);
    element.setAttribute('aria-pressed', String(active));
  });
  if (isDeliveries) {
    loadDeliveries();
    loadDeliveryFlowLists();
  }
  if (isTracks) {
    loadValidationTracks();
    loadAgentProfiles();
    loadQualitySkills();
  }
  if (isHistory) {
    loadHistorySettings();
    loadHistory();
  }
}

// --- Deliveries ---

const DELIVERY_STATUS_LABELS = {
  draft: 'Rascunho', active: 'Ativa', blocked: 'Impedida', validating: 'Em validação',
  'ready-for-pr': 'Pronta para PR', 'waiting-approval': 'Aguardando aprovação',
  merged: 'Integrada', cancelled: 'Cancelada'
};

async function loadDeliveries() {
  try {
    deliveries = await window.api.listDeliveries();
    renderDeliveryList(deliveries);
    const edited = deliveries.find((delivery) => delivery.id === editingDeliveryId);
    if (editingDeliveryId && !edited) renderDeliveryEditor(null);
  } catch (err) {
    setStatus(`Erro ao carregar entregas: ${err.message}`, 'error');
  }
}

function renderDeliveryList(items) {
  const list = document.getElementById('delivery-list');
  list.textContent = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma entrega local ainda. Crie a primeira para registrar o contexto da feature.';
    list.appendChild(empty);
    return;
  }
  items.forEach((delivery) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'delivery-list-entry';
    if (delivery.id === editingDeliveryId) button.classList.add('active');
    const objective = document.createElement('strong');
    objective.textContent = delivery.objective;
    const meta = document.createElement('span');
    meta.className = 'technical-value';
    meta.textContent = `${delivery.branch} -> ${delivery.baseBranch}`;
    const status = document.createElement('span');
    status.className = 'delivery-status';
    status.textContent = DELIVERY_STATUS_LABELS[delivery.status] || delivery.status;
    button.append(objective, meta, status);
    button.addEventListener('click', () => openDelivery(delivery.id));
    list.appendChild(button);
  });
}

async function openDelivery(deliveryId) {
  try {
    const delivery = await window.api.openDelivery(deliveryId);
    if (!delivery) {
      setStatus('Entrega não encontrada.', 'error');
      return;
    }
    renderDeliveryDetail(delivery);
    renderDeliveryList(deliveries);
  } catch (err) {
    setStatus(`Erro ao abrir entrega: ${err.message}`, 'error');
  }
}

function renderDeliveryDetail(delivery) {
  editingDeliveryId = delivery.id;
  renderDeliveryEditor(delivery);
  const header = document.getElementById('delivery-detail-header');
  header.textContent = '';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Entrega local';
  const title = document.createElement('h2');
  title.textContent = delivery.objective;
  const updated = document.createElement('p');
  updated.className = 'helper-text technical-value';
  updated.textContent = `Atualizada ${new Date(delivery.updatedAt).toLocaleString('pt-BR')}`;
  header.append(eyebrow, title, updated);
  renderDeliveryTimeline(delivery.events);
  selectedPolicyIds = new Set((delivery.flowSnapshot?.selectedPolicies || []).map((item) => item.id));
  selectedAgentProfileIds = new Set((delivery.flowSnapshot?.agentProfiles || []).map((item) => item.id));
  selectedQualitySkillIds = new Set((delivery.flowSnapshot?.qualitySkills || []).map((item) => item.id));
  discoveredRules = [];
  renderDiscoveredRules();
  renderDeliveryPolicyList();
  renderDeliveryTrackSelect(delivery.flowSnapshot?.track?.id || '');
  renderDeliveryAgentProfileList();
  renderDeliveryQualitySkillList();
  renderFlowSnapshotSummary(delivery.flowSnapshot);
  document.getElementById('delivery-flow-status').textContent = '';
  rejectChainSuggestion();
  document.getElementById('delivery-sync-status').textContent = '';
  renderInconsistencyList(delivery);
  renderChainConfirmed(delivery);
}

function renderDeliveryEditor(delivery) {
  editingDeliveryId = delivery?.id || null;
  document.getElementById('delivery-id').value = delivery?.id || '';
  document.getElementById('delivery-objective').value = delivery?.objective || '';
  document.getElementById('delivery-repo-path').value = delivery?.repoPath || '';
  document.getElementById('delivery-branch').value = delivery?.branch || '';
  document.getElementById('delivery-base-branch').value = delivery?.baseBranch || 'Dev';
  document.getElementById('delivery-status').value = delivery?.status || 'draft';
  document.getElementById('delivery-next-action').value = delivery?.nextAction || '';
  document.getElementById('delivery-blocked-reason').value = delivery?.blockedReason || '';
  if (!delivery) {
    const header = document.getElementById('delivery-detail-header');
    header.textContent = '';
    const title = document.createElement('h2');
    title.textContent = 'Nova entrega';
    header.appendChild(title);
    renderDeliveryTimeline([]);
    selectedPolicyIds = new Set();
    selectedAgentProfileIds = new Set();
    selectedQualitySkillIds = new Set();
    discoveredRules = [];
    renderDiscoveredRules();
    renderDeliveryPolicyList();
    renderDeliveryTrackSelect('');
    renderDeliveryAgentProfileList();
    renderDeliveryQualitySkillList();
    renderFlowSnapshotSummary(null);
    document.getElementById('delivery-flow-status').textContent = 'Salve a entrega antes de configurar o fluxo.';
    rejectChainSuggestion();
    document.getElementById('delivery-sync-status').textContent = '';
    renderInconsistencyList({ events: [] });
    renderChainConfirmed({ chain: null });
  }
}

function renderDeliveryTimeline(events) {
  const timeline = document.getElementById('delivery-timeline');
  timeline.textContent = '';
  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'helper-text';
    empty.textContent = 'Nenhum evento registrado neste marco.';
    timeline.appendChild(empty);
    return;
  }
  events.forEach((event) => {
    const item = document.createElement('article');
    item.className = 'delivery-event';
    const kind = document.createElement('strong');
    kind.textContent = event.kind;
    const detail = document.createElement('p');
    detail.textContent = event.detail;
    const timestamp = document.createElement('time');
    timestamp.className = 'technical-value';
    timestamp.dateTime = event.timestamp;
    timestamp.textContent = new Date(event.timestamp).toLocaleString('pt-BR');
    item.append(kind, detail, timestamp);
    timeline.appendChild(item);
  });
}

document.getElementById('new-delivery-btn').addEventListener('click', () => {
  renderDeliveryEditor(null);
  renderDeliveryList(deliveries);
  document.getElementById('delivery-objective').focus();
});

document.getElementById('delivery-editor').addEventListener('submit', saveDelivery);

async function saveDelivery(event) {
  event.preventDefault();
  try {
    const saved = await window.api.saveDelivery({
      id: document.getElementById('delivery-id').value || undefined,
      objective: document.getElementById('delivery-objective').value.trim(),
      repoPath: document.getElementById('delivery-repo-path').value.trim(),
      branch: document.getElementById('delivery-branch').value.trim(),
      baseBranch: document.getElementById('delivery-base-branch').value.trim(),
      nextAction: document.getElementById('delivery-next-action').value.trim(),
      blockedReason: document.getElementById('delivery-blocked-reason').value.trim()
    });
    renderDeliveryDetail(saved);
    await loadDeliveries();
    setStatus(`Entrega "${saved.objective}" salva.`);
  } catch (err) {
    setStatus(`Erro ao salvar entrega: ${err.message}`, 'error');
  }
}

// --- Delivery flow: policies, rules, track and snapshot ---

function setDeliveryFlowStatus(message, kind) {
  const el = document.getElementById('delivery-flow-status');
  el.textContent = message;
  el.classList.remove('running', 'error');
  if (kind) el.classList.add(kind);
}

// Fetches the raw lists the delivery-flow selection UI needs (policies, tracks,
// agent profiles, quality skills) and refreshes only that UI — unlike
// loadValidationTracks/loadAgentProfiles/loadQualitySkills, this never touches
// the Trilhas/Profiles/Skills tabs' own editor forms, so switching to the
// Deliveries tab can't clobber an in-progress edit there.
async function loadDeliveryFlowLists() {
  try {
    const [policies, tracks, profiles, skills] = await Promise.all([
      window.api.listProjectPolicies(),
      window.api.listValidationTracks(),
      window.api.listAgentProfiles(),
      window.api.listQualitySkills()
    ]);
    projectPolicies = policies;
    validationTracks = tracks;
    agentProfiles = profiles;
    qualitySkills = skills;
    const delivery = deliveries.find((item) => item.id === editingDeliveryId);
    renderDeliveryPolicyList();
    renderDeliveryTrackSelect(delivery?.flowSnapshot?.track?.id || '');
    renderDeliveryAgentProfileList();
    renderDeliveryQualitySkillList();
  } catch (err) {
    setDeliveryFlowStatus(`Erro ao carregar dados do fluxo: ${err.message}`, 'error');
  }
}

function renderDiscoveredRules() {
  const list = document.getElementById('discovered-rules-list');
  list.textContent = '';
  if (discoveredRules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma regra descoberta ainda.';
    list.appendChild(empty);
    return;
  }
  discoveredRules.forEach((rule) => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    const body = document.createElement('div');
    body.className = 'rule-row-body';
    const path = document.createElement('strong');
    path.className = 'technical-value';
    path.textContent = rule.path;
    const excerpt = document.createElement('pre');
    excerpt.className = 'rule-excerpt';
    excerpt.textContent = rule.excerpt;
    body.append(path, excerpt);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Adicionar como política';
    addBtn.addEventListener('click', () => addDiscoveredRuleAsPolicy(rule));
    row.append(body, addBtn);
    list.appendChild(row);
  });
}

async function addDiscoveredRuleAsPolicy(rule) {
  try {
    const id = `${rule.path}#${crypto.randomUUID().slice(0, 8)}`;
    const updated = await window.api.saveProjectPolicies([
      ...projectPolicies,
      { id, path: rule.path, excerpt: rule.excerpt }
    ]);
    projectPolicies = updated;
    selectedPolicyIds.add(id);
    renderDeliveryPolicyList();
    setDeliveryFlowStatus(`Política "${id}" adicionada a partir de ${rule.path}.`);
  } catch (err) {
    setDeliveryFlowStatus(`Erro ao adicionar política: ${err.message}`, 'error');
  }
}

function renderDeliveryPolicyList() {
  const list = document.getElementById('delivery-policy-list');
  list.textContent = '';
  if (projectPolicies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma política salva ainda.';
    list.appendChild(empty);
    return;
  }
  projectPolicies.forEach((policy) => {
    const row = document.createElement('label');
    row.className = 'check-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedPolicyIds.has(policy.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedPolicyIds.add(policy.id); else selectedPolicyIds.delete(policy.id);
    });
    const body = document.createElement('div');
    body.className = 'check-row-body';
    const id = document.createElement('strong');
    id.textContent = policy.id;
    const path = document.createElement('span');
    path.className = 'technical-value';
    path.textContent = policy.path;
    body.append(id, path);
    row.append(checkbox, body);
    list.appendChild(row);
  });
}

function renderDeliveryTrackSelect(selectedTrackId) {
  const select = document.getElementById('delivery-track-select');
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Nenhuma trilha selecionada';
  select.appendChild(none);
  validationTracks.forEach((track) => {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.name;
    select.appendChild(option);
  });
  select.value = validationTracks.some((track) => track.id === selectedTrackId) ? selectedTrackId : '';
}

function renderCheckboxList(containerId, items, selectedIds) {
  const list = document.getElementById(containerId);
  list.textContent = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nada disponível ainda.';
    list.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('label');
    row.className = 'check-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedIds.has(item.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedIds.add(item.id); else selectedIds.delete(item.id);
    });
    const name = document.createElement('span');
    name.textContent = item.name;
    row.append(checkbox, name);
    list.appendChild(row);
  });
}

function renderDeliveryAgentProfileList() {
  renderCheckboxList('delivery-agent-profile-list', agentProfiles, selectedAgentProfileIds);
}

function renderDeliveryQualitySkillList() {
  renderCheckboxList('delivery-quality-skill-list', qualitySkills, selectedQualitySkillIds);
}

function renderFlowSnapshotSummary(flowSnapshot) {
  const container = document.getElementById('delivery-flow-snapshot-summary');
  container.textContent = '';
  if (!flowSnapshot) return;
  const summary = document.createElement('div');
  summary.className = 'flow-snapshot-summary';
  const trackLine = document.createElement('p');
  trackLine.textContent = flowSnapshot.track ? `Trilha do snapshot: ${flowSnapshot.track.name}` : 'Snapshot sem trilha selecionada.';
  summary.appendChild(trackLine);
  const counts = document.createElement('p');
  counts.textContent = `${(flowSnapshot.selectedPolicies || []).length} política(s), ${(flowSnapshot.agentProfiles || []).length} perfil(is), ${(flowSnapshot.qualitySkills || []).length} skill(s).`;
  summary.appendChild(counts);
  container.appendChild(summary);
}

// --- Delivery chain and Azure sync ---

function renderInconsistencyList(delivery) {
  const list = document.getElementById('delivery-inconsistency-list');
  list.textContent = '';
  const inconsistencyEvents = (delivery.events || []).filter((event) => event.kind === 'inconsistency');
  if (inconsistencyEvents.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma inconsistência registrada.';
    list.appendChild(empty);
    return;
  }
  inconsistencyEvents.forEach((event) => {
    const item = document.createElement('li');
    const timestamp = document.createElement('time');
    timestamp.className = 'technical-value';
    timestamp.dateTime = event.timestamp;
    timestamp.textContent = new Date(event.timestamp).toLocaleString('pt-BR');
    const detail = document.createElement('p');
    detail.textContent = event.detail;
    item.append(timestamp, detail);
    list.appendChild(item);
  });
}

function renderChainConfirmed(delivery) {
  const container = document.getElementById('delivery-chain-confirmed');
  container.textContent = '';
  if (!delivery.chain) return;
  const summary = document.createElement('p');
  summary.textContent = `Posição ${delivery.chain.position} na cadeia ${delivery.chain.chainId}`;
  container.appendChild(summary);
}

function setSyncStatus(message, kind) {
  const el = document.getElementById('delivery-sync-status');
  el.textContent = message;
  el.classList.remove('running', 'error');
  if (kind) el.classList.add(kind);
}

async function syncAzure() {
  if (!editingDeliveryId) {
    setSyncStatus('Salve a entrega antes de sincronizar com o Azure.', 'error');
    return;
  }
  setSyncStatus('Sincronizando...', 'running');
  try {
    const updated = await window.api.syncAzure(editingDeliveryId);
    deliveries = deliveries.map((item) => item.id === updated.id ? updated : item);
    renderInconsistencyList(updated);
    setSyncStatus('Sincronizado.');
  } catch (err) {
    setSyncStatus(`Erro ao sincronizar com o Azure: ${err.message}`, 'error');
  }
}

async function suggestChain() {
  if (!editingDeliveryId) {
    setSyncStatus('Salve a entrega antes de sugerir uma cadeia.', 'error');
    return;
  }
  setSyncStatus('Sugerindo cadeia...', 'running');
  try {
    const result = await window.api.suggestChain([editingDeliveryId]);
    chainSuggestionState = result;
    const container = document.getElementById('delivery-chain-suggestion');
    const evidence = document.getElementById('chain-suggestion-evidence');
    const list = document.getElementById('chain-suggestion-list');
    evidence.textContent = result.evidence;
    list.textContent = '';
    (result.suggestion || []).forEach((entry) => {
      const item = document.createElement('li');
      item.textContent = `${entry.deliveryId} — posição ${entry.position}`;
      list.appendChild(item);
    });
    container.hidden = false;
    setSyncStatus('Sugestão pronta. Revise antes de confirmar.');
  } catch (err) {
    setSyncStatus(`Erro ao sugerir cadeia: ${err.message}`, 'error');
  }
}

async function acceptChainSuggestion() {
  if (!chainSuggestionState) return;
  const chainId = `chain-${Date.now()}`;
  const entries = chainSuggestionState.suggestion.map((entry) => ({
    deliveryId: entry.deliveryId,
    chainId,
    position: entry.position,
    dependsOn: entry.dependsOn
  }));
  try {
    const updated = await window.api.confirmChain(entries);
    deliveries = deliveries.map((item) => {
      const match = updated.find((u) => u.id === item.id);
      return match || item;
    });
    rejectChainSuggestion();
    const current = deliveries.find((item) => item.id === editingDeliveryId);
    if (current) renderChainConfirmed(current);
    setSyncStatus('Cadeia confirmada.');
  } catch (err) {
    setSyncStatus(`Erro ao confirmar cadeia: ${err.message}`, 'error');
  }
}

function rejectChainSuggestion() {
  chainSuggestionState = null;
  document.getElementById('delivery-chain-suggestion').hidden = true;
  document.getElementById('chain-suggestion-evidence').textContent = '';
  document.getElementById('chain-suggestion-list').textContent = '';
}

document.getElementById('sync-azure-btn').addEventListener('click', syncAzure);
document.getElementById('suggest-chain-btn').addEventListener('click', suggestChain);
document.getElementById('accept-chain-btn').addEventListener('click', acceptChainSuggestion);
document.getElementById('reject-chain-btn').addEventListener('click', rejectChainSuggestion);

document.getElementById('discover-rules-btn').addEventListener('click', async () => {
  const repoPath = document.getElementById('delivery-repo-path').value.trim();
  const branch = document.getElementById('delivery-branch').value.trim();
  if (!repoPath || !branch) {
    setDeliveryFlowStatus('Informe repositório e branch da entrega antes de descobrir regras.', 'error');
    return;
  }
  setDeliveryFlowStatus('Descobrindo regras...', 'running');
  try {
    discoveredRules = await window.api.discoverRepositoryRules({ repoPath, branch });
    renderDiscoveredRules();
    setDeliveryFlowStatus(`${discoveredRules.length} regra(s) descoberta(s).`);
  } catch (err) {
    setDeliveryFlowStatus(`Erro ao descobrir regras: ${err.message}`, 'error');
  }
});

document.getElementById('save-flow-snapshot-btn').addEventListener('click', async () => {
  if (!editingDeliveryId) {
    setDeliveryFlowStatus('Salve a entrega antes de configurar o fluxo.', 'error');
    return;
  }
  const trackId = document.getElementById('delivery-track-select').value;
  setDeliveryFlowStatus('Salvando snapshot do fluxo...', 'running');
  try {
    const saved = await window.api.buildDeliveryFlowSnapshot({
      deliveryId: editingDeliveryId,
      selection: {
        policyIds: [...selectedPolicyIds],
        trackId: trackId || undefined,
        agentProfileIds: [...selectedAgentProfileIds],
        qualitySkillIds: [...selectedQualitySkillIds]
      }
    });
    renderFlowSnapshotSummary(saved.flowSnapshot);
    await loadDeliveries();
    setDeliveryFlowStatus('Snapshot do fluxo salvo.');
  } catch (err) {
    setDeliveryFlowStatus(`Erro ao salvar snapshot: ${err.message}`, 'error');
  }
});

document.getElementById('run-delivery-track-btn').addEventListener('click', async () => {
  if (!editingDeliveryId) {
    setDeliveryFlowStatus('Salve a entrega antes de executar a trilha vinculada.', 'error');
    return;
  }
  const delivery = deliveries.find((item) => item.id === editingDeliveryId);
  if (!delivery || !delivery.flowSnapshot || !delivery.flowSnapshot.track) {
    setDeliveryFlowStatus('Salve um snapshot do fluxo com uma trilha selecionada antes de executar.', 'error');
    return;
  }
  const repoPath = delivery.repoPath;
  const branch = delivery.branch;
  const files = getSelectedFiles();
  if (files.length === 0 || repoPath !== getRepoPath() || branch !== document.getElementById('branch-select').value) {
    setDeliveryFlowStatus('Na aba Review, carregue o mesmo repositório/branch da entrega e selecione arquivos antes de executar.', 'error');
    return;
  }

  currentRepoPath = repoPath;
  invalidateReview();
  const runGeneration = executionGeneration;
  activeTrackExecutionId = crypto.randomUUID();
  livePhaseResults = new Map();
  setDeliveryFlowStatus('Executando trilha vinculada...', 'running');
  setExecutionRunning(true);
  try {
    const response = await window.api.runValidationTrack({
      executionId: activeTrackExecutionId,
      repoPath,
      branch,
      files,
      deliveryId: editingDeliveryId
    });
    if (runGeneration !== executionGeneration) return;
    let findingId = 0;
    currentFindings = response.phases.flatMap((phase) => (phase.findings || []).map((finding, findingIndex) => ({
      ...finding,
      id: findingId++,
      findingIndex,
      status: 'pending',
      applyRunId: phase.applyRunId,
      historyId: phase.historyId,
      canApply: phase.canApply,
      phaseName: phase.phaseName
    })));
    currentFileContents = response.fileContents;
    renderPhaseResults(response.phases);
    renderFindings();
    setDeliveryFlowStatus(response.status === 'cancelled'
      ? 'Trilha vinculada cancelada.'
      : `Trilha vinculada concluída: ${response.phases.length} fase(s), ${currentFindings.length} finding(s).`);
    await loadDeliveries();
  } catch (err) {
    if (runGeneration !== executionGeneration) return;
    setDeliveryFlowStatus(`Erro na trilha vinculada: ${err.message}`, 'error');
  } finally {
    setExecutionRunning(false);
    activeTrackExecutionId = null;
  }
});

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
const BUILT_IN_QUALITY_SKILL_IDS = new Set([
  'general', 'security', 'performance', 'tests', 'style',
  'scope-review', 'tdd-gaps', 'root-cause', 'electron-ipc-security', 'merge-readiness'
]);

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
  appendSelectOptions(agentSelect, agentProfiles.map((profile) => [profile.id, profile.name]), phase.agent || 'claude');
  agentLabel.appendChild(agentSelect);
  row.appendChild(agentLabel);

  const skillLabel = document.createElement('label');
  skillLabel.className = 'grow';
  skillLabel.textContent = 'Skill';
  const skillSelect = document.createElement('select');
  skillSelect.className = 'phase-skill';
  appendSelectOptions(skillSelect, qualitySkills.map((skill) => [skill.id, skill.name]), phase.skill || 'general');
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

  const parallelLabel = document.createElement('label');
  parallelLabel.className = 'checkbox-label';
  parallelLabel.textContent = 'Executar com subagentes paralelos';
  const parallelInput = document.createElement('input');
  parallelInput.type = 'checkbox';
  parallelInput.className = 'phase-parallel';
  parallelInput.checked = phase.parallel === true;
  parallelLabel.appendChild(parallelInput);
  claudeFields.appendChild(parallelLabel);
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

  const persistLogsLabel = document.createElement('label');
  persistLogsLabel.className = 'checkbox-label';
  persistLogsLabel.textContent = 'Salvar logs no histórico (podem conter segredos)';
  const persistLogsInput = document.createElement('input');
  persistLogsInput.type = 'checkbox';
  persistLogsInput.className = 'phase-persist-logs';
  persistLogsInput.checked = phase.persistLogs === true;
  persistLogsLabel.appendChild(persistLogsInput);
  commandFields.appendChild(persistLogsLabel);

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

  const gateRow = document.createElement('div');
  gateRow.className = 'row';
  const minCoverageLabel = document.createElement('label');
  minCoverageLabel.className = 'grow';
  minCoverageLabel.textContent = 'Cobertura mínima (%)';
  const minCoverageInput = document.createElement('input');
  minCoverageInput.type = 'number';
  minCoverageInput.className = 'phase-min-coverage';
  minCoverageInput.min = '0';
  minCoverageInput.max = '100';
  minCoverageInput.value = phase.coverageGate?.minLinesPct ?? '';
  minCoverageLabel.appendChild(minCoverageInput);
  gateRow.appendChild(minCoverageLabel);
  const maxDropLabel = document.createElement('label');
  maxDropLabel.className = 'grow';
  maxDropLabel.textContent = 'Queda máxima (p.p.)';
  const maxDropInput = document.createElement('input');
  maxDropInput.type = 'number';
  maxDropInput.className = 'phase-max-coverage-drop';
  maxDropInput.min = '0';
  maxDropInput.max = '100';
  maxDropInput.value = phase.coverageGate?.maxDropPct ?? '';
  maxDropLabel.appendChild(maxDropInput);
  gateRow.appendChild(maxDropLabel);
  const scopeLabel = document.createElement('label');
  scopeLabel.className = 'grow';
  scopeLabel.textContent = 'Escopo do gate';
  const scopeSelect = document.createElement('select');
  scopeSelect.className = 'phase-coverage-scope';
  appendSelectOptions(scopeSelect, [['all', 'Todo LCOV'], ['selected', 'Arquivos selecionados']], phase.coverageGate?.fileScope || 'all');
  scopeLabel.appendChild(scopeSelect);
  gateRow.appendChild(scopeLabel);
  commandFields.appendChild(gateRow);
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
    if (editingDeliveryId) {
      const delivery = deliveries.find((item) => item.id === editingDeliveryId);
      renderDeliveryTrackSelect(delivery?.flowSnapshot?.track?.id || '');
    }
  } catch (err) {
    setStatus(`Erro ao carregar trilhas: ${err.message}`, 'error');
  }
}

function refreshAgentProfileSelects() {
  document.querySelectorAll('.phase-agent').forEach((select) => {
    const selected = select.value;
    select.innerHTML = '';
    appendSelectOptions(select, agentProfiles.map((profile) => [profile.id, profile.name]), selected);
    if (![...select.options].some((option) => option.value === selected) && selected) {
      const unavailable = document.createElement('option');
      unavailable.value = selected;
      unavailable.textContent = 'Perfil indisponível';
      unavailable.selected = true;
      select.appendChild(unavailable);
    }
  });
}

function renderAgentProfileEditor(profile) {
  editingAgentProfileId = profile ? profile.id : null;
  document.getElementById('agent-profile-name').value = profile ? profile.name : '';
  document.getElementById('agent-profile-instructions').value = profile ? profile.instructions : '';
  document.getElementById('delete-agent-profile-btn').disabled = !profile || profile.id === 'claude';
}

function renderAgentProfileList() {
  const list = document.getElementById('agent-profile-list');
  list.innerHTML = '';
  agentProfiles.forEach((profile) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track-list-entry';
    if (profile.id === editingAgentProfileId) button.classList.add('active');
    const name = document.createElement('strong');
    name.textContent = profile.name;
    const runtime = document.createElement('span');
    runtime.textContent = 'Claude CLI';
    button.append(name, runtime);
    button.addEventListener('click', () => {
      renderAgentProfileEditor(profile);
      renderAgentProfileList();
    });
    list.appendChild(button);
  });
}

async function loadAgentProfiles() {
  try {
    agentProfiles = await window.api.listAgentProfiles();
    refreshAgentProfileSelects();
    const editedProfile = agentProfiles.find((profile) => profile.id === editingAgentProfileId);
    renderAgentProfileEditor(editedProfile || agentProfiles[0]);
    renderAgentProfileList();
    if (editingDeliveryId) renderDeliveryAgentProfileList();
  } catch (err) {
    setStatus(`Erro ao carregar perfis: ${err.message}`, 'error');
  }
}

function refreshQualitySkillSelects() {
  document.querySelectorAll('.phase-skill').forEach((select) => {
    const selected = select.value;
    select.innerHTML = '';
    appendSelectOptions(select, qualitySkills.map((skill) => [skill.id, skill.name]), selected);
    if (![...select.options].some((option) => option.value === selected) && selected) {
      const unavailable = document.createElement('option');
      unavailable.value = selected;
      unavailable.textContent = 'Skill indisponível';
      unavailable.selected = true;
      select.appendChild(unavailable);
    }
  });
}

function renderQualitySkillEditor(skill) {
  editingQualitySkillId = skill ? skill.id : null;
  const isBuiltIn = skill && BUILT_IN_QUALITY_SKILL_IDS.has(skill.id);
  document.getElementById('quality-skill-name').value = skill ? skill.name : '';
  document.getElementById('quality-skill-base').value = skill ? skill.baseSkill : 'general';
  document.getElementById('quality-skill-instructions').value = skill ? skill.instructions : '';
  document.getElementById('quality-skill-name').disabled = Boolean(isBuiltIn);
  document.getElementById('quality-skill-base').disabled = Boolean(isBuiltIn);
  document.getElementById('quality-skill-instructions').disabled = Boolean(isBuiltIn);
  document.getElementById('save-quality-skill-btn').disabled = Boolean(isBuiltIn);
  document.getElementById('delete-quality-skill-btn').disabled = !skill || Boolean(isBuiltIn);
}

function renderQualitySkillList() {
  const list = document.getElementById('quality-skill-list');
  list.innerHTML = '';
  qualitySkills.forEach((skill) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track-list-entry';
    if (skill.id === editingQualitySkillId) button.classList.add('active');
    const name = document.createElement('strong');
    name.textContent = skill.name;
    const base = document.createElement('span');
    base.textContent = skill.baseSkill;
    button.append(name, base);
    button.addEventListener('click', () => {
      renderQualitySkillEditor(skill);
      renderQualitySkillList();
    });
    list.appendChild(button);
  });
}

async function loadQualitySkills() {
  try {
    qualitySkills = await window.api.listQualitySkills();
    refreshQualitySkillSelects();
    const editedSkill = qualitySkills.find((skill) => skill.id === editingQualitySkillId);
    renderQualitySkillEditor(editedSkill || qualitySkills[0]);
    renderQualitySkillList();
    if (editingDeliveryId) renderDeliveryQualitySkillList();
  } catch (err) {
    setStatus(`Erro ao carregar skills: ${err.message}`, 'error');
  }
}

function getTrackDraft() {
  const phases = Array.from(document.querySelectorAll('.phase-editor')).map((editor) => {
    const type = editor.querySelector('.phase-type').value;
    if (type === 'command') {
      const minLinesPct = editor.querySelector('.phase-min-coverage').value;
      const maxDropPct = editor.querySelector('.phase-max-coverage-drop').value;
      const coverageGate = minLinesPct || maxDropPct ? {
        minLinesPct: minLinesPct === '' ? null : Number(minLinesPct),
        maxDropPct: maxDropPct === '' ? null : Number(maxDropPct),
        fileScope: editor.querySelector('.phase-coverage-scope').value
      } : null;
      return {
        id: editor.dataset.phaseId,
        type,
        name: editor.querySelector('.phase-command-name').value.trim(),
        command: editor.querySelector('.phase-command').value.trim(),
        timeoutMs: Number(editor.querySelector('.phase-timeout').value) * 1000,
        expectedExitCode: Number(editor.querySelector('.phase-exit-code').value),
        lcovPath: editor.querySelector('.phase-lcov-path').value.trim(),
        persistLogs: editor.querySelector('.phase-persist-logs').checked,
        coverageGate
      };
    }
    return {
      id: editor.dataset.phaseId,
      type,
      name: editor.querySelector('.phase-name').value.trim(),
      agent: editor.querySelector('.phase-agent').value,
      skill: editor.querySelector('.phase-skill').value,
      intensity: editor.querySelector('.phase-intensity').value,
      criteria: editor.querySelector('.phase-criteria').value.trim(),
      parallel: editor.querySelector('.phase-parallel').checked
    };
  });
  return { id: editingTrackId, name: document.getElementById('track-name').value.trim(), phases };
}

document.getElementById('new-track-btn').addEventListener('click', () => {
  renderTrackEditor(null);
  renderTrackList();
});

document.getElementById('new-agent-profile-btn').addEventListener('click', () => {
  renderAgentProfileEditor(null);
  renderAgentProfileList();
});

document.getElementById('new-quality-skill-btn').addEventListener('click', () => {
  renderQualitySkillEditor(null);
  renderQualitySkillList();
});

document.getElementById('save-quality-skill-btn').addEventListener('click', async () => {
  try {
    const draft = {
      id: editingQualitySkillId,
      name: document.getElementById('quality-skill-name').value.trim(),
      baseSkill: document.getElementById('quality-skill-base').value,
      instructions: document.getElementById('quality-skill-instructions').value.trim()
    };
    const skills = await window.api.saveQualitySkill(draft);
    qualitySkills = skills;
    editingQualitySkillId = draft.id || skills.at(-1).id;
    refreshQualitySkillSelects();
    const savedSkill = skills.find((skill) => skill.id === editingQualitySkillId);
    renderQualitySkillEditor(savedSkill);
    renderQualitySkillList();
    setStatus(`Skill "${savedSkill.name}" salva.`);
  } catch (err) {
    setStatus(`Erro ao salvar skill: ${err.message}`, 'error');
  }
});

document.getElementById('delete-quality-skill-btn').addEventListener('click', async () => {
  const skill = qualitySkills.find((item) => item.id === editingQualitySkillId);
  if (!skill || BUILT_IN_QUALITY_SKILL_IDS.has(skill.id) || !window.confirm(`Excluir a skill "${skill.name}"?`)) return;
  try {
    qualitySkills = await window.api.deleteQualitySkill(skill.id);
    editingQualitySkillId = null;
    refreshQualitySkillSelects();
    renderQualitySkillEditor(qualitySkills[0]);
    renderQualitySkillList();
    setStatus(`Skill "${skill.name}" excluída.`);
  } catch (err) {
    setStatus(`Erro ao excluir skill: ${err.message}`, 'error');
  }
});

document.getElementById('save-agent-profile-btn').addEventListener('click', async () => {
  try {
    const draft = {
      id: editingAgentProfileId,
      name: document.getElementById('agent-profile-name').value.trim(),
      instructions: document.getElementById('agent-profile-instructions').value.trim()
    };
    const profiles = await window.api.saveAgentProfile(draft);
    agentProfiles = profiles;
    editingAgentProfileId = draft.id || profiles.at(-1).id;
    refreshAgentProfileSelects();
    const savedProfile = profiles.find((profile) => profile.id === editingAgentProfileId);
    renderAgentProfileEditor(savedProfile);
    renderAgentProfileList();
    setStatus(`Perfil "${savedProfile.name}" salvo.`);
  } catch (err) {
    setStatus(`Erro ao salvar perfil: ${err.message}`, 'error');
  }
});

document.getElementById('delete-agent-profile-btn').addEventListener('click', async () => {
  const profile = agentProfiles.find((item) => item.id === editingAgentProfileId);
  if (!profile || profile.id === 'claude' || !window.confirm(`Excluir o perfil "${profile.name}"?`)) return;
  try {
    agentProfiles = await window.api.deleteAgentProfile(profile.id);
    editingAgentProfileId = null;
    refreshAgentProfileSelects();
    renderAgentProfileEditor(agentProfiles[0]);
    renderAgentProfileList();
    setStatus(`Perfil "${profile.name}" excluído.`);
  } catch (err) {
    setStatus(`Erro ao excluir perfil: ${err.message}`, 'error');
  }
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
  document.getElementById('run-delivery-track-btn').disabled = isRunning;
  document.getElementById('cancel-track-btn').disabled = !isRunning || !activeTrackExecutionId;
}

window.api.onValidationTrackProgress((progress) => {
  if (progress.executionId !== activeTrackExecutionId) return;
  if (progress.kind === 'phase') {
    const previous = livePhaseResults.get(progress.phaseId) || {};
    livePhaseResults.set(progress.phaseId, { ...previous, ...progress, ...(progress.result || {}) });
    renderPhaseResults([...livePhaseResults.values()]);
    setStatus(`Trilha: ${progress.phaseName} ${progress.status}.`, progress.status === 'running' ? 'running' : '');
  } else if (progress.kind === 'track') {
    renderPhaseResults(progress.phases);
    setStatus(progress.status === 'cancelled' ? 'Trilha cancelada.' : `Trilha ${progress.status}.`);
  }
});

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
    currentFindings = response.findings.map((finding, index) => ({ ...finding, id: index, findingIndex: index, status: 'pending' }));
    currentFileContents = response.fileContents;
    currentHistoryId = response.historyId;
    currentFindings = currentFindings.map((finding) => ({
      ...finding,
      canApply: response.canApply,
      applyRunId: response.applyRunId,
      historyId: response.historyId
    }));
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
  activeTrackExecutionId = crypto.randomUUID();
  livePhaseResults = new Map();
  setStatus(`Executando trilha "${track.name}" em ${track.phases.length} fase${track.phases.length === 1 ? '' : 's'}...`, 'running');
  setCoreState('running', { value: '···', label: 'Executando trilha' });
  setExecutionRunning(true);
  try {
    const response = await window.api.runValidationTrack({ executionId: activeTrackExecutionId, trackId, repoPath, branch, files });
    if (runGeneration !== executionGeneration) return;
    let findingId = 0;
    currentFindings = response.phases.flatMap((phase) => (phase.findings || []).map((finding, findingIndex) => ({
      ...finding,
      id: findingId++,
      findingIndex,
      status: 'pending',
      applyRunId: phase.applyRunId,
      historyId: phase.historyId,
      canApply: phase.canApply,
      phaseName: phase.phaseName
    })));
    currentFileContents = response.fileContents;
    const n = currentFindings.length;
    renderPhaseResults(response.phases);
    renderFindings();
    setStatus(response.status === 'cancelled'
      ? `Trilha "${track.name}" cancelada após ${response.phases.length} fases.`
      : `Trilha "${track.name}" concluída: ${response.phases.length} fases, ${n} finding${n === 1 ? '' : 's'}.`);
    setCoreState(worstSeverityClass(currentFindings), { value: n, label: n === 1 ? 'Finding' : 'Findings' });
    populateRecentRepos();
  } catch (err) {
    if (runGeneration !== executionGeneration) return;
    setStatus(`Erro na trilha: ${err.message}`, 'error');
    setCoreState('error', { value: '!!', label: 'Erro' });
  } finally {
    activeTrackExecutionId = null;
    setExecutionRunning(false);
  }
});

document.getElementById('cancel-track-btn').addEventListener('click', async () => {
  if (!activeTrackExecutionId) return;
  document.getElementById('cancel-track-btn').disabled = true;
  setStatus('Cancelamento solicitado...', 'running');
  try {
    await window.api.cancelValidationTrack(activeTrackExecutionId);
  } catch (err) {
    setStatus(`Erro ao cancelar trilha: ${err.message}`, 'error');
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
    if (phase.parallel) {
      const parallel = document.createElement('span');
      parallel.className = 'status-label';
      parallel.textContent = 'paralelo';
      header.appendChild(parallel);
    }
    card.appendChild(header);

    const detail = document.createElement('div');
    detail.className = 'helper-text';
    if (phase.type === 'claude') {
      detail.textContent = phase.status === 'running' || phase.status === 'queued'
        ? 'Aguardando ou executando a análise.'
        : phase.status === 'cancelled'
          ? 'Análise cancelada.'
          : phase.status === 'passed'
        ? `${phase.findings.length} finding${phase.findings.length === 1 ? '' : 's'} na análise.`
        : phase.error || 'A análise falhou.';
    } else {
      const result = phase.commandResult || {};
      const duration = typeof result.durationMs === 'number' ? `${(result.durationMs / 1000).toFixed(1)}s` : '';
      const exitCode = result.exitCode === null || result.exitCode === undefined ? '' : `saída ${result.exitCode}`;
      const coverage = phase.coverage ? `cobertura de linhas ${phase.coverage.lines.pct}%` : '';
      const gate = phase.coverageGate
        ? `gate ${phase.coverageGate.passed ? 'aprovado' : 'reprovado'}${phase.coverageGate.baseline ? ` vs ${phase.coverageGate.baseline.pct}%` : ' sem baseline anterior'}`
        : '';
      detail.textContent = [phase.error || phase.status, exitCode, duration, coverage, gate].filter(Boolean).join(' · ');
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
    const applyRunId = finding.applyRunId;
    await window.api.applyFinding({ repoPath: currentRepoPath, applyRunId, finding });
  } catch (err) {
    finding.status = 'pending';
    setStatus(`Erro ao aplicar: ${err.message}`, 'error');
    renderFindings();
    return;
  }

  finding.status = 'aplicado';
  const historyId = finding.historyId || currentHistoryId;
  if (historyId) {
    try {
      await window.api.recordFindingDecision({ historyId, findingIndex: finding.findingIndex, outcome: 'applied' });
    } catch (err) {
      finding.status = 'aplicado (não auditado)';
      setStatus(`Alteração aplicada, mas o registro auditável falhou: ${err.message}`, 'error');
    }
  }

  // ponytail: applying one finding shifts line numbers for any other
  // pending finding in the same file, invalidating its "lines" range.
  // Rather than remapping offsets, mark siblings stale and require a
  // fresh run — upgrade to offset remapping only if re-running becomes
  // a real friction point.
  currentFindings
    .filter((f) => f.file === finding.file && f.id !== finding.id && f.status === 'pending')
    .forEach((f) => { f.status = 'obsoleto (rode a análise de novo)'; });

  if (finding.status === 'aplicado') setStatus(`Finding aplicado em ${finding.file}.`);
  renderFindings();
}

async function rejectFinding(id) {
  const finding = currentFindings.find((f) => f.id === id);
  if (!finding || finding.status !== 'pending') return;
  finding.status = 'rejeitando';
  renderFindings();
  const historyId = finding.historyId || currentHistoryId;
  if (historyId) {
    try {
      await window.api.recordFindingDecision({ historyId, findingIndex: finding.findingIndex, outcome: 'rejected' });
    } catch (err) {
      finding.status = 'pending';
      setStatus(`Erro ao registrar rejeição: ${err.message}`, 'error');
      renderFindings();
      return;
    }
  }
  finding.status = 'rejeitado';
  renderFindings();
}

// --- History tab ---

async function loadHistorySettings() {
  try {
    const settings = await window.api.readHistorySettings();
    document.getElementById('history-retention').value = settings.maxEntries;
  } catch (err) {
    setStatus(`Erro ao carregar retenção: ${err.message}`, 'error');
  }
}

function matchesHistoryFilters(entry) {
  const query = document.getElementById('history-query').value.trim().toLocaleLowerCase();
  const kind = document.getElementById('history-kind-filter').value;
  const status = document.getElementById('history-status-filter').value;
  const from = document.getElementById('history-from-filter').value;
  const to = document.getElementById('history-to-filter').value;
  const searchText = [entry.branch, entry.trackName, entry.phaseName, entry.skillName, entry.skill, entry.agentProfileName]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  const day = String(entry.timestamp || '').slice(0, 10);
  return (!query || searchText.includes(query))
    && (!kind || entry.kind === kind)
    && (!status || entry.status === status)
    && (!from || day >= from)
    && (!to || day <= to);
}

async function loadHistory() {
  const summaryEl = document.getElementById('history-summary');
  const listEl = document.getElementById('history-list');
  document.getElementById('history-details').classList.add('hidden');
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

  const filteredHistory = history.filter(matchesHistoryFilters);
  const reviewHistory = filteredHistory.filter((entry) => entry.kind !== 'validation-command');
  const totalRuns = reviewHistory.length;
  const totalFindings = reviewHistory.reduce((sum, e) => sum + (e.findingsCount || 0), 0);
  const totalAccepted = reviewHistory.reduce((sum, e) => sum + (e.acceptedCount || 0), 0);
  const overallRate = totalFindings > 0 ? Math.round((totalAccepted / totalFindings) * 100) : null;

  summaryEl.appendChild(stat(filteredHistory.length, 'Execuções encontradas'));
  summaryEl.appendChild(stat(totalFindings, 'Findings totais'));
  summaryEl.appendChild(stat(overallRate === null ? '—' : `${overallRate}%`, 'Taxa de aceite'));

  if (filteredHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = history.length === 0 ? 'Nenhuma execução registrada ainda.' : 'Nenhuma execução corresponde aos filtros.';
    listEl.appendChild(empty);
    return;
  }

  [...filteredHistory].reverse().forEach((entry) => {
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
    meta.appendChild(document.createTextNode(` — ${[entry.branch, fileCount, entry.agentProfileName || entry.agent].filter(Boolean).join(' / ')} — ${when}`));
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

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.textContent = 'Abrir detalhes';
    openButton.addEventListener('click', () => openHistoryEntry(entry.id));
    row.appendChild(openButton);

    listEl.appendChild(row);
  });
}

async function openHistoryEntry(entryId) {
  try {
    const entry = await window.api.openHistoryEntry(entryId);
    if (!entry) {
      setStatus('Execução histórica não encontrada.', 'error');
      return;
    }
    renderHistoryDetails(entry);
  } catch (err) {
    setStatus(`Erro ao abrir histórico: ${err.message}`, 'error');
  }
}

function renderHistoryDetails(entry) {
  const details = document.getElementById('history-details');
  details.innerHTML = '';
  details.classList.remove('hidden');
  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = `Evidências: ${entry.phaseName || entry.skill || 'execução'}`;
  details.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'helper-text';
  meta.textContent = [entry.status, entry.branch, entry.headCommit || entry.commitHash, entry.agentProfileName, entry.skillName || entry.skill]
    .filter(Boolean).join(' · ');
  details.appendChild(meta);
  const exportActions = document.createElement('div');
  exportActions.className = 'actions';
  [['json', 'Exportar JSON'], ['markdown', 'Exportar Markdown']].forEach(([format, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      try {
        const filePath = await window.api.exportHistoryEntry({ entryId: entry.id, format });
        if (filePath) setStatus(`Relatório exportado em ${filePath}.`);
      } catch (err) {
        setStatus(`Erro ao exportar relatório: ${err.message}`, 'error');
      }
    });
    exportActions.appendChild(button);
  });
  details.appendChild(exportActions);

  if (entry.criteria) {
    const criteria = document.createElement('pre');
    criteria.className = 'history-evidence';
    criteria.textContent = entry.criteria;
    details.appendChild(criteria);
  }
  (entry.findings || []).forEach((finding) => {
    const findingEl = document.createElement('article');
    findingEl.className = `finding severity-${finding.severity}`;
    const location = document.createElement('strong');
    location.textContent = `${finding.file}:${finding.lines} · ${finding.severity} · ${finding.category}`;
    const message = document.createElement('p');
    message.textContent = finding.message;
    findingEl.append(location, message);
    if (finding.suggestion) {
      const suggestion = document.createElement('pre');
      suggestion.className = 'diff-added';
      suggestion.textContent = finding.suggestion;
      findingEl.appendChild(suggestion);
    }
    details.appendChild(findingEl);
  });

  if (entry.coverage) {
    const coverage = document.createElement('p');
    coverage.className = 'helper-text';
    coverage.textContent = `Cobertura de linhas: ${entry.coverage.lines.hit}/${entry.coverage.lines.found} (${entry.coverage.lines.pct}%)`;
    details.appendChild(coverage);
  }
  if (entry.coverageGate) {
    const gate = document.createElement('p');
    gate.className = 'helper-text';
    gate.textContent = `Gate de cobertura: ${entry.coverageGate.passed ? 'aprovado' : 'reprovado'} · ${entry.coverageGate.lines.pct}%${entry.coverageGate.baseline ? ` · baseline ${entry.coverageGate.baseline.pct}%` : ' · primeiro baseline'}`;
    details.appendChild(gate);
  }
  if (entry.logs?.stdout || entry.logs?.stderr) {
    const logs = document.createElement('pre');
    logs.className = 'phase-log';
    logs.textContent = [entry.logs.stdout, entry.logs.stderr].filter(Boolean).join('\n');
    details.appendChild(logs);
  }
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
