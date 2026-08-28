'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { runAzureSync } = require('../src/azureConnector');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdin.on('error', () => {});
  return child;
}

function envelopeJson(overrides = {}) {
  return JSON.stringify({
    result: JSON.stringify({
      repository: 'org/repo',
      branch: 'feature/x',
      pullRequest: null,
      reviewers: [],
      workItems: [],
      fetchedAt: '2026-08-28T12:00:00.000Z',
      ...overrides
    })
  });
}

test('resolves a valid Azure envelope from the CLI output', async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl });
  child.stdout.emit('data', envelopeJson());
  child.emit('close', 0);
  const envelope = await promise;
  assert.equal(envelope.repository, 'org/repo');
});

test('rejects with AZURE_MCP_INVALID_ENVELOPE on a malformed result', async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl });
  child.stdout.emit('data', JSON.stringify({ result: JSON.stringify({ repository: '' }) }));
  child.emit('close', 0);
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_INVALID_ENVELOPE');
});

test('rejects with AZURE_MCP_TIMEOUT when the CLI does not respond in time', async () => {
  const child = fakeChild();
  child.kill = () => {};
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl, timeoutMs: 10, terminate: () => child.emit('close', null) });
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_TIMEOUT');
});

test('rejects with AZURE_MCP_SPAWN_ERROR when spawning fails', async () => {
  const spawnImpl = () => { throw new Error('spawn failed'); };
  await assert.rejects(runAzureSync('sync prompt', { spawnImpl }), (error) => error.code === 'AZURE_MCP_SPAWN_ERROR');
});

test('rejects with AZURE_MCP_CANCELLED when the signal aborts before start', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAzureSync('sync prompt', { spawnImpl: fakeChild, signal: controller.signal }),
    (error) => error.code === 'AZURE_MCP_CANCELLED'
  );
});

test('rejects with AZURE_MCP_OUTPUT_TOO_LARGE when stdout exceeds the limit', async () => {
  const child = fakeChild();
  child.kill = () => {};
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl, terminate: () => child.emit('close', null) });
  child.stdout.emit('data', 'x'.repeat(3 * 1024 * 1024));
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_OUTPUT_TOO_LARGE');
});
