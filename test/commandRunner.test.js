const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runCommand } = require('../src/commandRunner');

function childThatCloses({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode, null);
  });
  return child;
}

test('runs a configured command through the platform shell and captures logs', async () => {
  let invocation;
  const result = await runCommand({
    command: 'npm test',
    cwd: 'C:\\repo',
    timeoutMs: 1000,
    spawnImpl: (shell, args, options) => {
      invocation = { shell, args, options };
      return childThatCloses({ stdout: 'ok', stderr: 'warning' });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.stderr, 'warning');
  assert.equal(invocation.options.cwd, 'C:\\repo');
  assert.equal(invocation.args.at(-1), 'npm test');
});

test('reports a spawn failure without throwing', async () => {
  const result = await runCommand({
    command: 'missing',
    cwd: 'C:\\repo',
    timeoutMs: 1000,
    spawnImpl: () => { throw new Error('not found'); }
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.error, 'not found');
});

test('terminates a command after its timeout', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let terminated = false;
  const resultPromise = runCommand({
    command: 'slow',
    cwd: 'C:\\repo',
    timeoutMs: 5,
    spawnImpl: () => child,
    terminate: () => {
      terminated = true;
      child.emit('close', null, 'SIGTERM');
    }
  });
  const result = await resultPromise;

  assert.equal(terminated, true);
  assert.equal(result.timedOut, true);
});
