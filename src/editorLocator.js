'use strict';

const path = require('node:path');

function findVSCodeExe({
  execFileSync = require('node:child_process').execFileSync,
  existsSync = require('node:fs').existsSync,
  env = process.env,
  platform = process.platform
} = {}) {
  if (platform !== 'win32') {
    for (const command of ['code', 'code-insiders']) {
      try {
        const executable = execFileSync('which', [command], { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
        if (executable && existsSync(executable)) return executable;
      } catch {
        // Try the next editor command available on PATH.
      }
    }
    return null;
  }

  const platformPath = path.win32;

  // `code` on PATH is a .cmd wrapper, and Windows can't CreateProcess a .cmd
  // directly without cmd.exe parsing. Locate the adjacent PE binary instead.
  try {
    const whereOut = execFileSync('where', ['code.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
    if (whereOut) {
      const exePath = platformPath.join(platformPath.dirname(whereOut), '..', 'Code.exe');
      if (existsSync(exePath)) return exePath;
    }
  } catch {
    // code.cmd not on PATH, fall through to known install locations
  }

  const candidates = [
    env.LOCALAPPDATA && platformPath.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    'C:\\Program Files\\Microsoft VS Code\\Code.exe'
  ].filter(Boolean);

  return candidates.find((p) => existsSync(p)) || null;
}

module.exports = { findVSCodeExe };
