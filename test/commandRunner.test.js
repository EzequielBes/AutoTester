const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UNIX_TERMINATION_GRACE_MS, terminateProcessTree, runCommand } = require('../src/commandRunner');

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

test('terminates a command when the track is cancelled', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const controller = new AbortController();
  const execution = runCommand({
    command: 'slow',
    cwd: 'C:\\repo',
    timeoutMs: 1000,
    signal: controller.signal,
    spawnImpl: () => child,
    terminate: () => child.emit('close', null, 'SIGTERM')
  });
  controller.abort();

  const result = await execution;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

test('runs Unix commands in a separate process group', async () => {
  let invocation;
  await runCommand({
    command: 'true',
    cwd: '/repo',
    timeoutMs: 1000,
    platform: 'linux',
    spawnImpl: (shell, args, options) => {
      invocation = { shell, args, options };
      return childThatCloses();
    }
  });
  assert.equal(invocation.shell, '/bin/sh');
  assert.deepEqual(invocation.args, ['-lc', 'true']);
  assert.equal(invocation.options.detached, true);
});

test('terminates a Unix process group and escalates after the grace period', () => {
  const child = new EventEmitter();
  child.pid = 4321;
  const signals = [];
  let timer;
  const stop = terminateProcessTree(child, {
    platform: 'linux',
    processGroup: true,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    setTimeoutImpl: (callback, delay) => {
      timer = { callback, delay, cancelled: false };
      return timer;
    },
    clearTimeoutImpl: (entry) => { entry.cancelled = true; }
  });
  assert.deepEqual(signals, [[-4321, 'SIGTERM']]);
  assert.equal(timer.delay, UNIX_TERMINATION_GRACE_MS);
  timer.callback();
  assert.deepEqual(signals, [[-4321, 'SIGTERM'], [-4321, 'SIGKILL']]);
  stop();
});

test('cancels Unix escalation when the process closes', () => {
  const child = new EventEmitter();
  child.pid = 4321;
  const signals = [];
  let timer;
  terminateProcessTree(child, {
    platform: 'linux',
    processGroup: true,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    setTimeoutImpl: (callback) => { timer = { callback, cancelled: false }; return timer; },
    clearTimeoutImpl: (entry) => { entry.cancelled = true; }
  });
  child.emit('close');
  timer.callback();
  assert.equal(timer.cancelled, true);
  assert.deepEqual(signals, [[-4321, 'SIGTERM']]);
});
