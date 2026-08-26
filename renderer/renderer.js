'use strict';

let currentFindings = [];
let currentFileContents = {};
let currentRepoPath = '';
let currentHistoryId = null;

function getRepoPath() {
  return document.getElementById('repo-path').value.trim();
}

function getSelectedFiles() {
  return Array.from(document.querySelectorAll('#file-list input[type="checkbox"]:checked'))
    .map((checkbox) => checkbox.value);
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
  }
});

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

// --- Tabs ---

document.getElementById('tab-review').addEventListener('click', () => switchTab('review'));
document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));

function switchTab(name) {
  const isReview = name === 'review';
  document.getElementById('view-review').classList.toggle('hidden', !isReview);
  document.getElementById('view-history').classList.toggle('hidden', isReview);
  document.getElementById('tab-review').classList.toggle('active', isReview);
  document.getElementById('tab-review').setAttribute('aria-selected', String(isReview));
  document.getElementById('tab-history').classList.toggle('active', !isReview);
  document.getElementById('tab-history').setAttribute('aria-selected', String(!isReview));
  if (!isReview) loadHistory();
}

// --- Branch loading + info panel ---

document.getElementById('load-branches-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  if (!repoPath) {
    setStatus('Informe o caminho do repositório primeiro.', 'error');
    return;
  }
  currentRepoPath = repoPath;
  try {
    const branches = await window.api.listBranches(repoPath);
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

document.getElementById('branch-select').addEventListener('change', refreshBranchInfo);

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

// --- Files ---

document.getElementById('load-files-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  const branch = document.getElementById('branch-select').value;
  const changedOnly = document.getElementById('changed-only').checked;
  if (!repoPath || !branch) {
    setStatus('Carregue as branches e selecione uma antes.', 'error');
    return;
  }
  try {
    const files = await window.api.listFiles(repoPath, branch, changedOnly);
    const container = document.getElementById('file-list');
    container.innerHTML = '';
    files.forEach((file) => {
      const row = document.createElement('label');
      row.className = 'file-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = file;
      row.appendChild(checkbox);
      row.appendChild(document.createTextNode(file));
      container.appendChild(row);
    });
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

  if (!repoPath || files.length === 0) {
    setStatus('Selecione ao menos um arquivo antes de rodar.', 'error');
    return;
  }

  currentRepoPath = repoPath;
  setStatus('Rodando análise...', 'running');
  setCoreState('running', { value: '···', label: 'Executando' });
  document.getElementById('run-btn').disabled = true;

  try {
    const response = await window.api.runReview({ repoPath, files, skill, intensity });
    currentFindings = response.findings.map((finding, index) => ({ ...finding, id: index, status: 'pending' }));
    currentFileContents = response.fileContents;
    currentHistoryId = response.historyId;
    renderFindings();
    const n = currentFindings.length;
    setStatus(`${n} finding${n === 1 ? '' : 's'} encontrado${n === 1 ? '' : 's'}.`);
    setCoreState(worstSeverityClass(currentFindings), { value: n, label: n === 1 ? 'Finding' : 'Findings' });
    populateRecentRepos();
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Review GUI', { body: `${n} finding${n === 1 ? '' : 's'} encontrado${n === 1 ? '' : 's'} em ${repoPath}` });
    }
  } catch (err) {
    setStatus(`Erro: ${err.message}`, 'error');
    setCoreState('error', { value: '!!', label: 'Erro' });
  } finally {
    document.getElementById('run-btn').disabled = false;
  }
});

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
    acceptBtn.textContent = 'Aceitar';
    acceptBtn.disabled = !isPending;
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
  if (!finding || finding.status !== 'pending') return;

  // Set an in-flight sentinel synchronously (before the await) so a second
  // fast click on the same finding is rejected by the guard above instead
  // of racing past it and double-applying the edit.
  finding.status = 'aplicando';
  renderFindings();

  try {
    await window.api.applyFinding({ repoPath: currentRepoPath, finding });
    finding.status = 'aplicado';
    if (currentHistoryId) {
      window.api.recordAccept(currentHistoryId).catch(() => {});
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

  const totalRuns = history.length;
  const totalFindings = history.reduce((sum, e) => sum + (e.findingsCount || 0), 0);
  const totalAccepted = history.reduce((sum, e) => sum + (e.acceptedCount || 0), 0);
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
    const branch = entry.files && entry.files.length ? `${entry.files.length} arquivo${entry.files.length === 1 ? '' : 's'}` : '';
    const strong = document.createElement('strong');
    strong.textContent = `${entry.skill} / ${entry.intensity}`;
    meta.appendChild(strong);
    meta.appendChild(document.createTextNode(` — ${branch} — ${when}`));
    row.appendChild(meta);

    const rate = document.createElement('div');
    rate.className = 'rate';
    const accepted = entry.acceptedCount || 0;
    const found = entry.findingsCount || 0;
    const pct = found > 0 ? Math.round((accepted / found) * 100) : null;
    rate.textContent = found === 0 ? 'sem findings' : `${accepted}/${found} aceitos (${pct}%)`;
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
