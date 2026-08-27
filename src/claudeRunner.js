'use strict';

const { spawn } = require('node:child_process');
const { validateFindings } = require('./findingsSchema');
const { terminateProcessTree } = require('./commandRunner');

const DEFAULT_CLAUDE_TIMEOUT_MS = 600000;

function parseCliOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error('CLI output is not valid JSON');
  }
  if (typeof envelope.result !== 'string') {
    throw new Error('CLI output is missing a string "result" field');
  }
  let parsed;
  try {
    parsed = JSON.parse(envelope.result);
  } catch {
    throw new Error('CLI "result" field is not valid JSON');
  }
  const { valid, errors } = validateFindings(parsed);
  if (!valid) {
    throw new Error(`CLI "result" does not match the findings schema: ${errors.join('; ')}`);
  }
  return parsed.findings;
}

function runClaudeReview(systemPrompt, content, {
  timeoutMs = DEFAULT_CLAUDE_TIMEOUT_MS,
  signal,
  spawnImpl = spawn,
  terminate = terminateProcessTree
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Claude review cancelled');
      error.code = 'TRACK_CANCELLED';
      reject(error);
      return;
    }
    let child;
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timer;
    let stopError = null;
    const abortListener = () => {
      const error = new Error('Claude review cancelled');
      error.code = 'TRACK_CANCELLED';
      requestStop(error);
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abortListener);
    };
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      cleanup();
      callback();
    };
    const requestStop = (error) => {
      if (stopError || !child) return;
      stopError = error;
      terminate(child);
    };

    try {
      child = spawnImpl('claude', [
        '-p',
        '--output-format', 'json',
        '--append-system-prompt', systemPrompt
      ], { windowsHide: true });
    } catch (error) {
      finish(() => reject(error));
      return;
    }

    timer = setTimeout(() => {
      const error = new Error(`Claude review timed out after ${timeoutMs}ms`);
      error.code = 'CLAUDE_TIMEOUT';
      requestStop(error);
    }, timeoutMs);
    signal?.addEventListener('abort', abortListener, { once: true });
    if (signal?.aborted) abortListener();
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(() => reject(stopError || error)));
    child.stdin?.on('error', () => {});
    child.stdin?.end(content);
    child.on('close', (code) => {
      if (stopError) {
        finish(() => reject(stopError));
      } else if (code !== 0) {
        finish(() => reject(new Error(`claude CLI exited with code ${code}: ${stderr}`)));
      } else {
        try {
          const findings = parseCliOutput(stdout);
          finish(() => resolve(findings));
        } catch (error) {
          finish(() => reject(error));
        }
      }
    });
  });
}

module.exports = { DEFAULT_CLAUDE_TIMEOUT_MS, parseCliOutput, runClaudeReview };
