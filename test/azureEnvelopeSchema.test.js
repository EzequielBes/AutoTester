'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAzureEnvelope } = require('../src/azureEnvelopeSchema');

function envelope(overrides = {}) {
  return {
    repository: 'org/repo',
    branch: 'feature/x',
    pullRequest: { id: '123', title: 'Add feature', status: 'active', targetBranch: 'Dev', url: 'https://dev.azure.com/org/repo/pr/123' },
    reviewers: ['alice'],
    workItems: [{ id: '456', title: 'Ticket', url: 'https://dev.azure.com/org/repo/workitems/456' }],
    fetchedAt: '2026-08-28T12:00:00.000Z',
    ...overrides
  };
}

test('accepts a well-formed envelope', () => {
  const { valid, errors } = validateAzureEnvelope(envelope());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('accepts a null pullRequest', () => {
  const { valid } = validateAzureEnvelope(envelope({ pullRequest: null }));
  assert.equal(valid, true);
});

test('ignores unknown top-level fields without erroring', () => {
  const { valid, errors } = validateAzureEnvelope({ ...envelope(), token: 'secret-should-be-ignored' });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('rejects a non-object root value', () => {
  const { valid, errors } = validateAzureEnvelope('not-an-object');
  assert.equal(valid, false);
  assert.deepEqual(errors, ['root value must be an object']);
});

test('rejects a missing repository', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ repository: undefined }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('repository')));
});

test('rejects a missing branch', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ branch: '' }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('branch')));
});

test('rejects a pullRequest missing required fields', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ pullRequest: { id: '123' } }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('pullRequest')));
});

test('rejects reviewers that is not an array of strings', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ reviewers: 'alice' }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('reviewers')));
});

test('rejects workItems entries missing required fields', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ workItems: [{ id: '456' }] }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('workItems')));
});

test('rejects a missing fetchedAt', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ fetchedAt: undefined }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('fetchedAt')));
});

test('rejects content that looks like raw file contents or credentials', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ diff: 'diff --git a/x b/x\n+secret', accessToken: 'abc' }));
  // extra fields are ignored, not errors — this proves they are dropped, not validated/trusted
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});
