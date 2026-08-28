'use strict';

const { spawn } = require('node:child_process');
const { validateAzureEnvelope } = require('./azureEnvelopeSchema');
const { MAX_LOG_CHARS, appendTail, terminateProcessTree } = require('./commandRunner');

const DEFAULT_AZURE_TIMEOUT_MS = 120000;
const MAX_AZURE_STDOUT_CHARS = 2 * 1024 * 1024;
const MAX_AZURE_STDERR_CHARS = MAX_LOG_CHARS;

function parseCliOutput(stdout) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    const error = new Error('Azure CLI output is not valid JSON');
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  if (typeof outer.result !== 'string') {
    const error = new Error('Azure CLI output is missing a string "result" field');
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(outer.result);
  } catch {
    const error = new Error('Azure CLI "result" field is not valid JSON');
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  const { valid, errors } = validateAzureEnvelope(parsed);
  if (!valid) {
    const error = new Error(`Azure envelope does not match schema: ${errors.join('; ')}`);
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  return parsed;
}

function runAzureSync(prompt, {
  timeoutMs = DEFAULT_AZURE_TIMEOUT_MS,
  signal,
  spawnImpl = spawn,
  terminate = terminateProcessTree
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Azure sync cancelled');
      error.code = 'AZURE_MCP_CANCELLED';
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
      const error = new Error('Azure sync cancelled');
      error.code = 'AZURE_MCP_CANCELLED';
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
        '--append-system-prompt', prompt
      ], { windowsHide: true });
    } catch (error) {
      error.code = 'AZURE_MCP_SPAWN_ERROR';
      finish(() => reject(error));
      return;
    }

    timer = setTimeout(() => {
      const error = new Error(`Azure sync timed out after ${timeoutMs}ms`);
      error.code = 'AZURE_MCP_TIMEOUT';
      requestStop(error);
    }, timeoutMs);
    signal?.addEventListener('abort', abortListener, { once: true });
    if (signal?.aborted) abortListener();
    child.stdout?.on('data', (chunk) => {
      const output = chunk.toString();
      if (stdout.length + output.length > MAX_AZURE_STDOUT_CHARS) {
        const error = new Error(`Azure CLI output exceeded ${MAX_AZURE_STDOUT_CHARS} characters`);
        error.code = 'AZURE_MCP_OUTPUT_TOO_LARGE';
        requestStop(error);
        return;
      }
      stdout += output;
    });
    child.stderr?.on('data', (chunk) => { stderr = appendTail(stderr, chunk, MAX_AZURE_STDERR_CHARS); });
    child.on('error', (error) => {
      error.code = error.code || 'AZURE_MCP_SPAWN_ERROR';
      finish(() => reject(stopError || error));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end();
    child.on('close', (code) => {
      if (stopError) {
        finish(() => reject(stopError));
      } else if (code !== 0) {
        const error = new Error(`claude CLI exited with code ${code}: ${stderr}`);
        error.code = 'AZURE_MCP_SPAWN_ERROR';
        finish(() => reject(error));
      } else {
        try {
          const envelope = parseCliOutput(stdout);
          finish(() => resolve(envelope));
        } catch (error) {
          finish(() => reject(error));
        }
      }
    });
  });
}

module.exports = { DEFAULT_AZURE_TIMEOUT_MS, MAX_AZURE_STDOUT_CHARS, MAX_AZURE_STDERR_CHARS, parseCliOutput, runAzureSync };
