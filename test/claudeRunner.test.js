const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MAX_CLAUDE_STDOUT_CHARS, MAX_CLAUDE_STDERR_CHARS, parseCliOutput, runClaudeReview } = require('../src/claudeRunner');

function slowChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  return child;
}

test('extracts and validates findings from a CLI envelope', () => {
  const envelope = JSON.stringify({
    result: JSON.stringify({
      findings: [
        { file: 'a.js', lines: '1-2', severity: 'low', category: 'style', message: 'm', suggestion: 's' }
      ]
    })
  });
  const findings = parseCliOutput(envelope);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'a.js');
});

test('throws when the outer payload is not JSON', () => {
  assert.throws(() => parseCliOutput('not json'), /not valid JSON/);
});

test('throws when the result field is missing', () => {
  assert.throws(() => parseCliOutput(JSON.stringify({})), /missing a string "result"/);
});

test('throws when result is not valid JSON', () => {
  assert.throws(() => parseCliOutput(JSON.stringify({ result: 'not json' })), /"result" field is not valid JSON/);
});

test('throws when findings fail schema validation', () => {
  const envelope = JSON.stringify({ result: JSON.stringify({ findings: [{ file: 'a.js' }] }) });
  assert.throws(() => parseCliOutput(envelope), /does not match the findings schema/);
});

test('terminates Claude and reports a timeout', async () => {
  const child = slowChild();
  const execution = runClaudeReview('prompt', 'content', {
    timeoutMs: 5,
    spawnImpl: () => child,
    terminate: () => child.emit('close', null)
  });

  await assert.rejects(execution, (error) => error.code === 'CLAUDE_TIMEOUT');
});

test('terminates Claude when the track is cancelled', async () => {
  const child = slowChild();
  const controller = new AbortController();
  const execution = runClaudeReview('prompt', 'content', {
    signal: controller.signal,
    spawnImpl: () => child,
    terminate: () => child.emit('close', null)
  });
  controller.abort();

  await assert.rejects(execution, (error) => error.code === 'TRACK_CANCELLED');
});

test('terminates Claude when its JSON output exceeds the configured limit', async () => {
  const child = slowChild();
  let terminated = false;
  const execution = runClaudeReview('prompt', 'content', {
    spawnImpl: () => child,
    terminate: () => { terminated = true; child.emit('close', null); }
  });
  child.stdout.emit('data', 'x'.repeat(MAX_CLAUDE_STDOUT_CHARS + 1));

  await assert.rejects(execution, (error) => error.code === 'CLAUDE_OUTPUT_TOO_LARGE');
  assert.equal(terminated, true);
});

test('limits Claude stderr to its configured tail', async () => {
  const child = slowChild();
  const execution = runClaudeReview('prompt', 'content', { spawnImpl: () => child });
  child.stderr.emit('data', `${'x'.repeat(MAX_CLAUDE_STDERR_CHARS)}tail`);
  child.emit('close', 1);

  await assert.rejects(execution, (error) => {
    assert.equal(error.message.includes('x'.repeat(MAX_CLAUDE_STDERR_CHARS)), false);
    return error.message.endsWith('tail');
  });
});
