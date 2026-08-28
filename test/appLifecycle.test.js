const test = require('node:test');
const assert = require('node:assert/strict');
const { startSingleInstanceApp } = require('../src/appLifecycle');

test('quits before startup when another app instance owns the lock', () => {
  let quitCalls = 0;
  let readyCalls = 0;
  const app = {
    requestSingleInstanceLock: () => false,
    quit: () => { quitCalls += 1; },
    whenReady: () => { readyCalls += 1; return Promise.resolve(); }
  };

  assert.equal(startSingleInstanceApp(app, () => {}), false);
  assert.equal(quitCalls, 1);
  assert.equal(readyCalls, 0);
});

test('starts a window after readiness when the app owns the lock', async () => {
  let createCalls = 0;
  let secondInstanceListener;
  const app = {
    requestSingleInstanceLock: () => true,
    quit: () => { throw new Error('must not quit'); },
    on: (event, listener) => { if (event === 'second-instance') secondInstanceListener = listener; },
    whenReady: () => Promise.resolve()
  };

  let focusCalls = 0;
  assert.equal(startSingleInstanceApp(app, () => { createCalls += 1; }, () => { focusCalls += 1; }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createCalls, 1);
  secondInstanceListener();
  assert.equal(focusCalls, 1);
});
