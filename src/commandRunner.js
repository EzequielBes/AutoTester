'use strict';

const { spawn, execFile } = require('node:child_process');

const MAX_LOG_CHARS = 256 * 1024;

function appendTail(existing, chunk) {
  const combined = existing + chunk.toString();
  return combined.length > MAX_LOG_CHARS ? combined.slice(-MAX_LOG_CHARS) : combined;
}

function terminateProcessTree(child, execFileImpl = execFile) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    execFileImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
  } else {
    child.kill('SIGTERM');
  }
}

function runCommand({ command, cwd, timeoutMs, signal, spawnImpl = spawn, now = Date.now, terminate = terminateProcessTree }) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ exitCode: null, signal: null, timedOut: false, cancelled: true, durationMs: 0, stdout: '', stderr: '', error: null });
      return;
    }
    const startedAt = now();
    let child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let finished = false;
    let spawnError = null;
    let timeout;
    const abortListener = () => {
      cancelled = true;
      terminate(child);
    };
    const finish = (exitCode, childSignal) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', abortListener);
      resolve({
        exitCode,
        signal: childSignal,
        timedOut,
        cancelled,
        durationMs: now() - startedAt,
        stdout,
        stderr,
        error: spawnError ? spawnError.message : null
      });
    };

    try {
      const shell = process.platform === 'win32'
        ? process.env.ComSpec || 'cmd.exe'
        : '/bin/sh';
      const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', command]
        : ['-lc', command];
      child = spawnImpl(shell, args, { cwd, windowsHide: true });
    } catch (error) {
      spawnError = error;
      finish(null, null);
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);
    signal?.addEventListener('abort', abortListener, { once: true });
    child.stdout?.on('data', (chunk) => { stdout = appendTail(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendTail(stderr, chunk); });
    child.on('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.on('close', finish);
  });
}

module.exports = { MAX_LOG_CHARS, appendTail, terminateProcessTree, runCommand };
