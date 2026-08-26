'use strict';

const path = require('node:path');

// ponytail: `code` on PATH is a .cmd wrapper, and Windows can't CreateProcess
// a .cmd directly without going through cmd.exe's own metacharacter parsing
// (the class of bug behind CVE-2024-27980). Locating the real Code.exe next
// to it lets openInEditor spawn a plain PE binary with argv, no shell at all.
function findVSCodeExe({
  execFileSync = require('node:child_process').execFileSync,
  existsSync = require('node:fs').existsSync,
  env = process.env
} = {}) {
  try {
    const whereOut = execFileSync('where', ['code.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
    if (whereOut) {
      const exePath = path.join(path.dirname(whereOut), '..', 'Code.exe');
      if (existsSync(exePath)) return exePath;
    }
  } catch {
    // code.cmd not on PATH, fall through to known install locations
  }

  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    'C:\\Program Files\\Microsoft VS Code\\Code.exe'
  ].filter(Boolean);

  return candidates.find((p) => existsSync(p)) || null;
}

module.exports = { findVSCodeExe };
