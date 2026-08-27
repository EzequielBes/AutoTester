const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSystemPrompt } = require('../src/promptBuilder');

function writeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptbuilder-'));
  const filePath = path.join(dir, 'review-prompt.md');
  fs.writeFileSync(filePath, [
    '## Base',
    'BASE_TEXT',
    '',
    '## Skill: general',
    'SKILL_GENERAL_TEXT',
    '',
    '## Skill: security',
    'SKILL_SECURITY_TEXT',
    '',
    '## Skill: performance',
    'SKILL_PERFORMANCE_TEXT',
    '',
    '## Skill: tests',
    'SKILL_TESTS_TEXT',
    '',
    '## Skill: style',
    'SKILL_STYLE_TEXT',
    '',
    '## Intensity: quick',
    'INTENSITY_QUICK_TEXT',
    '',
    '## Intensity: full',
    'INTENSITY_FULL_TEXT',
    ''
  ].join('\n'));
  return filePath;
}

test('assembles base + skill + intensity blocks in order', () => {
  const filePath = writeFixture();
  const prompt = buildSystemPrompt(filePath, 'security', 'full');
  const baseIdx = prompt.indexOf('BASE_TEXT');
  const skillIdx = prompt.indexOf('SKILL_SECURITY_TEXT');
  const intensityIdx = prompt.indexOf('INTENSITY_FULL_TEXT');
  assert.ok(baseIdx >= 0 && skillIdx > baseIdx && intensityIdx > skillIdx);
});

test('appends optional phase criteria after the prompt blocks', () => {
  const filePath = writeFixture();
  const prompt = buildSystemPrompt(filePath, 'security', 'full', 'Require authorization checks.');
  assert.ok(prompt.endsWith('Require authorization checks.'));
});

test('throws on unknown skill', () => {
  const filePath = writeFixture();
  assert.throws(() => buildSystemPrompt(filePath, 'nope', 'full'), /unknown skill/);
});

test('throws on unknown intensity', () => {
  const filePath = writeFixture();
  assert.throws(() => buildSystemPrompt(filePath, 'general', 'medium'), /unknown intensity/);
});

test('every skill/intensity combo resolves against the real prompt file', () => {
  const real = path.join(__dirname, '..', 'prompts', 'review-prompt.md');
  for (const s of ['general', 'security', 'performance', 'tests', 'style']) {
    for (const i of ['quick', 'full']) {
      assert.ok(buildSystemPrompt(real, s, i).length > 0);
    }
  }
});
