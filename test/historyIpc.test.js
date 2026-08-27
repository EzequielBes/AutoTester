const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendHistoryEntry } = require('../src/historyStore');
const { writeExportFile, registerHistoryIpc } = require('../src/historyIpc');

function tmpPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'history-ipc-')), name);
}

function setup(options = {}) {
  const handlers = new Map();
  const historyPath = tmpPath('history.json');
  appendHistoryEntry(historyPath, {
    id: 'audit/1', kind: 'review', findings: [], status: 'passed', timestamp: '2026-08-27T12:00:00.000Z'
  });
  registerHistoryIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    historyFilePath: () => historyPath,
    assertTrustedRenderer: options.assertTrustedRenderer || (() => {}),
    showSaveDialog: options.showSaveDialog || (async () => ({ canceled: true })),
    getWindowFromWebContents: () => 'window',
    writeFile: options.writeFile
  });
  return { handlers, historyPath };
}

test('registers guarded history handlers and reads history from trusted renderers', () => {
  let checks = 0;
  const { handlers } = setup({ assertTrustedRenderer: () => { checks += 1; } });
  const history = handlers.get('history:read')({ sender: {} });
  assert.equal(history.length, 1);
  assert.equal(checks, 1);
  assert.throws(() => setup({ assertTrustedRenderer: () => { throw new Error('untrusted'); } }).handlers.get('history:open')({}, 'audit/1'), /untrusted/);
});

test('exports the selected entry atomically with a sanitized name', async () => {
  const destination = tmpPath('report.json');
  let dialogOptions;
  const { handlers } = setup({
    showSaveDialog: async (_window, options) => {
      dialogOptions = options;
      return { canceled: false, filePath: destination };
    }
  });
  const result = await handlers.get('history:export')({ sender: {} }, { entryId: 'audit/1', format: 'json' });
  assert.equal(result, destination);
  assert.equal(dialogOptions.defaultPath, 'audit-audit-1.json');
  assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8')).entry.id, 'audit/1');
  assert.equal(fs.readdirSync(path.dirname(destination)).some((name) => name.endsWith('.tmp')), false);
});

test('does not leave a temporary export file when replacement fails', () => {
  const destination = tmpPath('report.json');
  const writes = [];
  const fakeFs = {
    writeFileSync: (filePath) => writes.push(filePath),
    renameSync: () => { throw new Error('replace failed'); },
    existsSync: () => true,
    unlinkSync: (filePath) => writes.push(`deleted:${filePath}`)
  };
  assert.throws(() => writeExportFile(destination, 'content', fakeFs), /replace failed/);
  assert.equal(writes.some((value) => String(value).startsWith('deleted:')), true);
});
