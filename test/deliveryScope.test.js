const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDeliveryScope, validateScopeException, isFileInScope, findScopeViolations } = require('../src/deliveryScope');

const scope = { files: ['src/app.js'], folders: ['test'], glob: 'docs/**/*.md, !docs/drafts/**' };

test('matches delivery scope across explicit files, folders, and globs', () => {
  assert.equal(isFileInScope('src/app.js', scope), true);
  assert.equal(isFileInScope('test/app.test.js', scope), true);
  assert.equal(isFileInScope('docs/guide.md', scope), true);
  assert.equal(isFileInScope('docs/drafts/idea.md', scope), false);
  assert.equal(isFileInScope('src/private.js', scope), false);
});

test('rejects scope paths that escape the repository', () => {
  assert.throws(() => validateDeliveryScope({ files: ['../secret.js'], folders: [], glob: '' }), /relative to the repository/);
});

test('allows an exception only for its recorded phase and actor', () => {
  const exception = {
    id: 'exception-1', files: ['src/private.js'], justification: 'Required shared validation.',
    phaseId: 'implementation', actorId: 'agent-1', createdAt: '2026-08-29T12:00:00.000Z'
  };
  validateScopeException(exception);
  assert.deepEqual(findScopeViolations(['src/app.js', 'src/private.js'], scope, [exception], {
    phaseId: 'implementation', actorId: 'agent-1'
  }), []);
  assert.deepEqual(findScopeViolations(['src/private.js'], scope, [exception], {
    phaseId: 'review', actorId: 'agent-1'
  }), ['src/private.js']);
});
