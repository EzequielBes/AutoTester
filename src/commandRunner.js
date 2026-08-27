'use strict';

const { spawn, execFile } = require('node:child_process');

const MAX_LOG_CHARS = 256 * 1024;
const UNIX_TERMINATION_GRACE_MS = 2000;

function appendTail(existing, chunk, maxChars = MAX_LOG_CHARS) {
  const combined = existing + chunk.toString();
  return combined.length > maxChars ? combined.slice(-maxChars) : combined;
}

function terminateProcessTree(child, options = {}) {
  const resolvedOptions = typeof options === 'function' ? { execFileImpl: options } : options;
  const {
    execFileImpl = execFile,
    platform = process.platform,
    killImpl = process.kill.bind(process),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    graceMs = UNIX_TERMINATION_GRACE_MS,
    processGroup = false
  } = resolvedOptions;
  if (!child?.pid) return () => {};
  if (platform === 'win32') {
    execFileImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    return () => {};
  }
  const target = processGroup ? -child.pid : child.pid;
  let timer;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeoutImpl(timer);
    child.removeListener?.('close', stop);
    child.removeListener?.('error', stop);
  };
  const send = (signal) => {
    try {
      killImpl(target, signal);
    } catch {
      // The process may have exited between the stop request and signal delivery.
    }
  };
  send('SIGTERM');
  timer = setTimeoutImpl(() => {
    if (stopped) return;
    send('SIGKILL');
    stop();
  }, graceMs);
  child.once?.('close', stop);
  child.once?.('error', stop);
  return stop;
}

function runCommand({ command, cwd, timeoutMs, signal, spawnImpl = spawn, now = Date.now, terminate = terminateProcessTree, platform = process.platform }) {
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
    let terminationRequested = false;
    let stopTermination = () => {};
    const requestTermination = () => {
      if (terminationRequested) return;
      terminationRequested = true;
      const stop = terminate(child, { platform, processGroup: platform !== 'win32' });
      if (typeof stop === 'function') stopTermination = stop;
    };
    const abortListener = () => {
      cancelled = true;
      requestTermination();
    };
    const finish = (exitCode, childSignal) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      stopTermination();
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
      const shell = platform === 'win32'
        ? process.env.ComSpec || 'cmd.exe'
        : '/bin/sh';
      const args = platform === 'win32'
        ? ['/d', '/s', '/c', command]
        : ['-lc', command];
      child = spawnImpl(shell, args, { cwd, windowsHide: true, detached: platform !== 'win32' });
    } catch (error) {
      spawnError = error;
      finish(null, null);
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      requestTermination();
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

module.exports = { MAX_LOG_CHARS, UNIX_TERMINATION_GRACE_MS, appendTail, terminateProcessTree, runCommand };
