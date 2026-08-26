'use strict';

const fs = require('node:fs');

function parseSections(markdown) {
  const sections = new Map();
  const parts = markdown.split(/\n(?=## )/);
  for (const part of parts) {
    const match = part.match(/^## (.+)\n([\s\S]*)$/);
    if (!match) continue;
    sections.set(match[1].trim(), match[2].trim());
  }
  return sections;
}

const SKILL_HEADINGS = {
  general: 'Skill: general',
  security: 'Skill: security',
  performance: 'Skill: performance',
  tests: 'Skill: tests',
  style: 'Skill: style'
};

const INTENSITY_HEADINGS = {
  quick: 'Intensity: quick',
  full: 'Intensity: full'
};

function buildSystemPrompt(promptFilePath, skill, intensity) {
  const skillHeading = SKILL_HEADINGS[skill];
  const intensityHeading = INTENSITY_HEADINGS[intensity];
  if (!skillHeading) throw new Error(`unknown skill: ${skill}`);
  if (!intensityHeading) throw new Error(`unknown intensity: ${intensity}`);

  const markdown = fs.readFileSync(promptFilePath, 'utf8');
  const sections = parseSections(markdown);

  const base = sections.get('Base');
  const skillBlock = sections.get(skillHeading);
  const intensityBlock = sections.get(intensityHeading);
  if (!base) throw new Error('prompt file is missing a "## Base" section');
  if (!skillBlock) throw new Error(`prompt file is missing a "## ${skillHeading}" section`);
  if (!intensityBlock) throw new Error(`prompt file is missing a "## ${intensityHeading}" section`);

  return [base, skillBlock, intensityBlock].join('\n\n');
}

module.exports = { buildSystemPrompt, parseSections, SKILL_HEADINGS, INTENSITY_HEADINGS };
