const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { discoverRepositoryRules } = require('../src/repositoryRuleDiscovery');

function run(cwd, args) {
  execFileSync('git', args, { cwd });
}

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-rules-fixture-'));
  run(dir, ['init', '--initial-branch=main']);
  run(dir, ['config', 'user.email', 'test@example.com']);
  run(dir, ['config', 'user.name', 'Test']);
  return dir;
}

test('discovers AGENTS.md policies from the repository', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Agent configuration rules\n');
  run(dir, ['add', 'AGENTS.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.ok(rules.length > 0);
  assert.ok(rules.some((r) => r.path === 'AGENTS.md'));
});

test('discovers CLAUDE.md policies from the repository', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Claude configuration\n');
  run(dir, ['add', 'CLAUDE.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.ok(rules.some((r) => r.path === 'CLAUDE.md'));
});

test('discovers CONTEXT.md policies from the repository', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), 'Context and conventions\n');
  run(dir, ['add', 'CONTEXT.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.ok(rules.some((r) => r.path === 'CONTEXT.md'));
});

test('discovers CONTRIBUTING.md policies from the repository', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'CONTRIBUTING.md'), 'Contributing guidelines\n');
  run(dir, ['add', 'CONTRIBUTING.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.ok(rules.some((r) => r.path === 'CONTRIBUTING.md'));
});

test('discovers PR templates from the repository', () => {
  const dir = makeFixtureRepo();
  const templatesDir = path.join(dir, '.github', 'PULL_REQUEST_TEMPLATE');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(templatesDir, 'default.md'), 'PR template content\n');
  run(dir, ['add', '.github']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.ok(rules.some((r) => r.path.includes('PULL_REQUEST_TEMPLATE')));
});

test('does not discover files outside the allowlist', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), 'This should not be discovered\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Agent rules\n');
  run(dir, ['add', 'README.md', 'AGENTS.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.equal(rules.filter((r) => r.path === 'README.md').length, 0);
  assert.ok(rules.some((r) => r.path === 'AGENTS.md'));
});

test('includes excerpts bounded by maximum length', () => {
  const dir = makeFixtureRepo();
  const longContent = 'Policy: ' + 'a'.repeat(3000);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), longContent);
  run(dir, ['add', 'AGENTS.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  const agentsRule = rules.find((r) => r.path === 'AGENTS.md');
  assert.ok(agentsRule);
  assert.ok(agentsRule.excerpt);
  assert.ok(agentsRule.excerpt.length < longContent.length);
});

test('returns empty array when no policy files are found', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), 'Only readme\n');
  run(dir, ['add', 'README.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.equal(rules.length, 0);
});

test('returns objects with path and excerpt properties', () => {
  const dir = makeFixtureRepo();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Agent configuration\n');
  run(dir, ['add', 'AGENTS.md']);
  run(dir, ['commit', '-m', 'initial']);

  const rules = discoverRepositoryRules(dir, 'main');
  assert.ok(rules.length > 0);
  rules.forEach((rule) => {
    assert.ok(typeof rule.path === 'string');
    assert.ok(typeof rule.excerpt === 'string');
  });
});
