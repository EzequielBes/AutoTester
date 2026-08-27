const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_QUALITY_SKILLS,
  validateSkill,
  readQualitySkills,
  writeQualitySkills
} = require('../src/qualitySkillStore');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-skills-'));
  return path.join(dir, 'quality-skills.json');
}

function skill() {
  return {
    id: 'accessibility',
    name: 'Accessibility review',
    baseSkill: 'general',
    instructions: 'Prioritize keyboard access.',
    canApply: false
  };
}

test('exposes the curated quality skill catalog by default', () => {
  const skills = readQualitySkills(tmpFile());
  assert.ok(skills.some((item) => item.id === 'tdd-gaps'));
  assert.ok(skills.some((item) => item.id === 'electron-ipc-security'));
});

test('writes and reads a custom quality skill', () => {
  const file = tmpFile();
  const skills = writeQualitySkills(file, [...DEFAULT_QUALITY_SKILLS, skill()]);
  assert.deepEqual(readQualitySkills(file), skills);
});

test('rejects an unsupported base skill', () => {
  const invalid = skill();
  invalid.baseSkill = 'unknown';
  assert.throws(() => validateSkill(invalid), /base is not supported/);
});
