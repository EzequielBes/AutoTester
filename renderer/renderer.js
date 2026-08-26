'use strict';

let currentFindings = [];
let currentFileContents = {};
let currentRepoPath = '';

function getRepoPath() {
  return document.getElementById('repo-path').value.trim();
}

function getSelectedFiles() {
  return Array.from(document.querySelectorAll('#file-list input[type="checkbox"]:checked'))
    .map((checkbox) => checkbox.value);
}

function setStatus(message) {
  document.getElementById('status').textContent = message;
}

document.getElementById('load-branches-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  if (!repoPath) {
    setStatus('Informe o caminho do repositório primeiro.');
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
  } catch (err) {
    setStatus(`Erro: ${err.message}`);
  }
});

document.getElementById('load-files-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  const branch = document.getElementById('branch-select').value;
  const changedOnly = document.getElementById('changed-only').checked;
  if (!repoPath || !branch) {
    setStatus('Carregue as branches e selecione uma antes.');
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
      row.appendChild(document.createTextNode(' ' + file));
      container.appendChild(row);
    });
    setStatus(`${files.length} arquivos carregados.`);
  } catch (err) {
    setStatus(`Erro: ${err.message}`);
  }
});

document.getElementById('run-btn').addEventListener('click', async () => {
  const repoPath = getRepoPath();
  const files = getSelectedFiles();
  const skill = document.getElementById('skill-select').value;
  const intensity = document.getElementById('intensity-select').value;

  if (!repoPath || files.length === 0) {
    setStatus('Selecione ao menos um arquivo antes de rodar.');
    return;
  }

  currentRepoPath = repoPath;
  setStatus('Rodando análise...');
  document.getElementById('run-btn').disabled = true;

  try {
    const response = await window.api.runReview({ repoPath, files, skill, intensity });
    currentFindings = response.findings.map((finding, index) => ({ ...finding, id: index, status: 'pending' }));
    currentFileContents = response.fileContents;
    renderFindings();
    setStatus(`${currentFindings.length} findings encontrados.`);
  } catch (err) {
    setStatus(`Erro: ${err.message}`);
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
    card.className = 'finding';

    const header = document.createElement('div');
    header.className = 'finding-header';
    header.classList.add('severity-' + finding.severity);
    header.textContent = `${finding.file}:${finding.lines} [${finding.severity}/${finding.category}]`;
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

    const acceptBtn = document.createElement('button');
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
      statusLabel.textContent = ` [${finding.status}]`;
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
    setStatus(`Erro ao aplicar: ${err.message}`);
  }
  renderFindings();
}

function rejectFinding(id) {
  const finding = currentFindings.find((f) => f.id === id);
  if (!finding || finding.status !== 'pending') return;
  finding.status = 'rejeitado';
  renderFindings();
}
