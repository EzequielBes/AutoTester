const test = require('node:test');
const assert = require('node:assert/strict');
const { configureWindowSecurity } = require('../src/windowSecurity');

test('denies popup windows and blocks navigation away from the local renderer', () => {
  let openHandler;
  let navigateListener;
  const webContents = {
    setWindowOpenHandler: (handler) => { openHandler = handler; },
    on: (event, listener) => { if (event === 'will-navigate') navigateListener = listener; }
  };
  configureWindowSecurity(webContents, 'file:///app/renderer/index.html');

  assert.deepEqual(openHandler(), { action: 'deny' });
  const blocked = { preventDefault: () => { blocked.prevented = true; } };
  navigateListener(blocked, 'https://example.com');
  assert.equal(blocked.prevented, true);
  const allowed = { preventDefault: () => { allowed.prevented = true; } };
  navigateListener(allowed, 'file:///app/renderer/index.html');
  assert.equal(allowed.prevented, undefined);
});
