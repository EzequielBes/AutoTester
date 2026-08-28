const test = require('node:test');
const assert = require('node:assert/strict');
const { findVSCodeExe } = require('../src/editorLocator');

test('resolves Code.exe next to code.cmd found via `where`', () => {
  const exe = findVSCodeExe({
    execFileSync: () => 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd\n',
    existsSync: (p) => p.endsWith('Microsoft VS Code\\Code.exe'),
    env: {},
    platform: 'win32'
  });
  assert.equal(exe, 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
});

test('falls back to LOCALAPPDATA candidate when `where` fails', () => {
  const exe = findVSCodeExe({
    execFileSync: () => { throw new Error('not found'); },
    existsSync: (p) => p === 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32'
  });
  assert.equal(exe, 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
});

test('returns null when nothing is found', () => {
  const exe = findVSCodeExe({
    execFileSync: () => { throw new Error('not found'); },
    existsSync: () => false,
    env: {},
    platform: 'win32'
  });
  assert.equal(exe, null);
});

test('resolves the stable VS Code command on Linux or macOS', () => {
  const exe = findVSCodeExe({
    execFileSync: (command, args) => {
      assert.equal(command, 'which');
      assert.deepEqual(args, ['code']);
      return '/usr/bin/code\n';
    },
    existsSync: (candidate) => candidate === '/usr/bin/code',
    platform: 'linux'
  });
  assert.equal(exe, '/usr/bin/code');
});

test('falls back to code-insiders when stable VS Code is unavailable', () => {
  const calls = [];
  const exe = findVSCodeExe({
    execFileSync: (_command, [candidate]) => {
      calls.push(candidate);
      if (candidate === 'code') throw new Error('not found');
      return '/opt/code-insiders/bin/code-insiders\n';
    },
    existsSync: (candidate) => candidate.endsWith('code-insiders'),
    platform: 'darwin'
  });
  assert.deepEqual(calls, ['code', 'code-insiders']);
  assert.equal(exe, '/opt/code-insiders/bin/code-insiders');
});
