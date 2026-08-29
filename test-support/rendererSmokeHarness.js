'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.commandLine.appendSwitch('headless');
app.commandLine.appendSwitch('disable-gpu');

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'rendererSmokePreload.js'),
      contextIsolation: false,
      nodeIntegration: false
    }
  });
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (predicate, label) => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (predicate()) return;
          await wait(20);
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const setValue = (id, value) => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };

      await waitFor(() => document.getElementById('delivery-list').textContent.includes('Nenhuma entrega'), 'delivery list');
      setValue('delivery-objective', 'Validar fluxo da interface');
      setValue('delivery-repo-path', '/work/repository');
      setValue('delivery-branch', 'feature/renderer-smoke');
      setValue('delivery-base-branch', 'Dev');
      setValue('delivery-next-action', 'Executar smoke test');
      setValue('delivery-scope-files', 'src/deliveryStore.js');
      document.getElementById('delivery-editor').requestSubmit();
      await waitFor(() => document.getElementById('delivery-id').value !== '', 'saved delivery');

      setValue('scope-exception-files', 'src/shared.js');
      setValue('scope-exception-justification', 'Contrato compartilhado.');
      setValue('scope-exception-phase', 'implementation');
      setValue('scope-exception-actor', 'agent-1');
      document.getElementById('record-scope-exception-btn').click();
      await waitFor(() => document.getElementById('delivery-scope-exception-list').textContent.includes('src/shared.js'), 'scope exception');

      document.getElementById('tab-tracks').click();
      await waitFor(() => !document.getElementById('view-tracks').classList.contains('hidden'), 'tracks view');
      document.getElementById('new-track-btn').click();
      setValue('track-name', 'Trilha com escrita');
      document.querySelector('.phase-can-write').checked = true;
      document.getElementById('save-track-btn').click();
      await waitFor(() => document.querySelector('.track-list-entry')?.textContent.includes('Trilha com escrita'), 'saved track');

      document.getElementById('tab-review').click();
      setValue('repo-path', '/work/repository');
      document.getElementById('load-branches-btn').click();
      await waitFor(() => document.getElementById('branch-select').value === 'feature/renderer-smoke', 'loaded branch');
      document.getElementById('load-files-btn').click();
      await waitFor(() => document.querySelector('#file-list input[type="checkbox"]'), 'loaded files');
      document.getElementById('select-visible-files-btn').click();
      document.getElementById('track-select').value = 'track-1';
      document.getElementById('run-track-btn').click();
      await waitFor(() => !document.getElementById('cancel-track-btn').disabled, 'running track');
      document.getElementById('cancel-track-btn').click();
      await waitFor(() => document.getElementById('status').textContent.includes('cancelada'), 'cancelled track');
      const trackCancelled = document.getElementById('status').textContent.includes('cancelada');

      document.getElementById('tab-history').click();
      await waitFor(() => document.querySelector('#history-list button'), 'history entry');
      document.querySelector('#history-list button').click();
      await waitFor(() => !document.getElementById('history-details').classList.contains('hidden'), 'history details');
      [...document.querySelectorAll('#history-details button')].find((button) => button.textContent === 'Exportar JSON').click();
      await waitFor(() => document.getElementById('status').textContent.includes('Relatório exportado'), 'history export');

      return {
        deliveryObjective: document.getElementById('delivery-objective').value,
        exceptionCount: document.querySelectorAll('#delivery-scope-exception-list article').length,
        trackCanWrite: document.querySelector('.phase-can-write').checked,
        trackCancelled,
        historyExported: document.getElementById('status').textContent.includes('Relatório exportado')
      };
    })()
  `);
  process.stdout.write(`RESULT:${JSON.stringify(result)}\n`);
  await window.close();
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
