const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('renderer smoke flow creates a delivery, records an exception, and saves write permission', async () => {
  const electron = require('electron');
  const harness = path.join(__dirname, '..', 'test-support', 'rendererSmokeHarness.js');
  const child = spawn(electron, [harness], { windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0, output);

  const result = JSON.parse(output.match(/RESULT:(.+)/)?.[1] || '{}');
  assert.equal(result.deliveryObjective, 'Validar fluxo da interface');
  assert.equal(result.exceptionCount, 1);
  assert.equal(result.trackCanWrite, true);
});
