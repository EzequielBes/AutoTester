const test = require('node:test');
const assert = require('node:assert/strict');
const { findVSCodeExe } = require('../src/editorLocator');

test('resolves Code.exe next to code.cmd found via `where`', () => {
  const exe = findVSCodeExe({
    execFileSync: () => 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd\n',
    existsSync: (p) => p.endsWith('Microsoft VS Code\\Code.exe'),
    env: {}
  });
  assert.equal(exe, 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
});

test('falls back to LOCALAPPDATA candidate when `where` fails', () => {
  const exe = findVSCodeExe({
    execFileSync: () => { throw new Error('not found'); },
    existsSync: (p) => p === 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }
  });
  assert.equal(exe, 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
});

test('returns null when nothing is found', () => {
  const exe = findVSCodeExe({
    execFileSync: () => { throw new Error('not found'); },
    existsSync: () => false,
    env: {}
  });
  assert.equal(exe, null);
});
