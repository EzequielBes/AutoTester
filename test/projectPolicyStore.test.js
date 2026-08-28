const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readProjectPolicies,
  writeProjectPolicies
} = require('../src/projectPolicyStore');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-policies-'));
  return path.join(dir, 'policies.json');
}

test('returns no policies before the store exists', () => {
  assert.deepEqual(readProjectPolicies(tmpFile()), []);
});

test('writes a versioned policy store and reads it back', () => {
  const file = tmpFile();
  const policies = [
    { id: 'policy-1', path: 'AGENTS.md', excerpt: 'Sample policy content' }
  ];
  writeProjectPolicies(file, policies);

  assert.deepEqual(readProjectPolicies(file), policies);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).version);
});

test('rejects a corrupted policy store instead of silently discarding it', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');
  assert.throws(() => readProjectPolicies(file), /storage is corrupted/);
});

test('rejects a policy store with an unsupported schema', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({}));
  assert.throws(() => readProjectPolicies(file), /unsupported schema/);
});

test('rejects excerpts that exceed the maximum length', () => {
  const file = tmpFile();
  const longExcerpt = 'a'.repeat(5000);
  const policies = [
    { id: 'policy-1', path: 'AGENTS.md', excerpt: longExcerpt }
  ];

  assert.throws(() => writeProjectPolicies(file, policies), /excerpt must not exceed/);
});

test('rejects policies with invalid structure', () => {
  const file = tmpFile();
  const invalidPolicies = [
    { id: 'policy-1', path: 'AGENTS.md' } // missing excerpt
  ];

  assert.throws(() => writeProjectPolicies(file, invalidPolicies), /excerpt must be a string/);
});

test('accepts multiple policies and persists them', () => {
  const file = tmpFile();
  const policies = [
    { id: 'policy-1', path: 'AGENTS.md', excerpt: 'Agent rules' },
    { id: 'policy-2', path: 'CLAUDE.md', excerpt: 'Claude config' }
  ];
  writeProjectPolicies(file, policies);

  const read = readProjectPolicies(file);
  assert.equal(read.length, 2);
  assert.equal(read[0].path, 'AGENTS.md');
  assert.equal(read[1].path, 'CLAUDE.md');
});

test('rejects duplicate policy ids', () => {
  const file = tmpFile();
  const policies = [
    { id: 'policy-1', path: 'AGENTS.md', excerpt: 'Agent rules' },
    { id: 'policy-1', path: 'CLAUDE.md', excerpt: 'Claude config' }
  ];

  assert.throws(() => writeProjectPolicies(file, policies), /policy ids must be unique/);
});
