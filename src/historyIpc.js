'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readHistory, readHistoryEntry, recordFindingDecision } = require('./historyStore');
const { serializeAuditJson, renderAuditMarkdown } = require('./historyExport');

function writeExportFile(filePath, content, fileSystem = fs) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fileSystem.writeFileSync(temporaryPath, content, 'utf8');
    fileSystem.renameSync(temporaryPath, filePath);
  } catch (err) {
    try {
      if (fileSystem.existsSync(temporaryPath)) fileSystem.unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write failure when temporary-file cleanup also fails.
    }
    throw err;
  }
}

function registerHistoryIpc(ipcMain, {
  historyFilePath,
  assertTrustedRenderer,
  showSaveDialog,
  getWindowFromWebContents,
  writeFile = writeExportFile
}) {
  ipcMain.handle('history:read', (event) => {
    assertTrustedRenderer(event);
    return readHistory(historyFilePath());
  });

  ipcMain.handle('history:open', (event, entryId) => {
    assertTrustedRenderer(event);
    return readHistoryEntry(historyFilePath(), entryId);
  });

  ipcMain.handle('history:export', async (event, { entryId, format }) => {
    assertTrustedRenderer(event);
    if (!['json', 'markdown'].includes(format)) throw new Error('history export format is not supported');
    const entry = readHistoryEntry(historyFilePath(), entryId);
    if (!entry) throw new Error('history entry was not found');
    const extension = format === 'json' ? 'json' : 'md';
    const safeEntryId = String(entry.id).replace(/[^a-zA-Z0-9._-]/g, '-');
    const result = await showSaveDialog(getWindowFromWebContents(event.sender), {
      defaultPath: `audit-${safeEntryId}.${extension}`,
      filters: [{ name: format === 'json' ? 'JSON' : 'Markdown', extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return null;
    writeFile(result.filePath, format === 'json' ? serializeAuditJson(entry) : renderAuditMarkdown(entry));
    return result.filePath;
  });

  ipcMain.handle('history:record-finding-decision', (event, { historyId, findingIndex, outcome }) => {
    assertTrustedRenderer(event);
    return recordFindingDecision(historyFilePath(), historyId, findingIndex, outcome);
  });
}

module.exports = { writeExportFile, registerHistoryIpc };
