'use strict';

const { spawn } = require('node:child_process');
const { validateFindings } = require('./findingsSchema');

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

function runClaudeReview(systemPrompt, content) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--output-format', 'json',
      '--append-system-prompt', systemPrompt
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.stdin.on('error', () => {}); // child died; 'close' below reports the real reason
    child.stdin.end(content);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(parseCliOutput(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = { parseCliOutput, runClaudeReview };
