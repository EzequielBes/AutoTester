'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const MAX_SKILL_NAME_LENGTH = 100;
const MAX_SKILL_INSTRUCTIONS_LENGTH = 4000;
const DEFAULT_QUALITY_SKILLS = [
  { id: 'general', name: 'Review geral', baseSkill: 'general', instructions: '', canApply: true },
  { id: 'security', name: 'Segurança', baseSkill: 'security', instructions: '', canApply: true },
  { id: 'performance', name: 'Performance', baseSkill: 'performance', instructions: '', canApply: true },
  { id: 'tests', name: 'Geração de testes', baseSkill: 'tests', instructions: '', canApply: false },
  { id: 'style', name: 'Refactor de estilo', baseSkill: 'style', instructions: '', canApply: true },
  {
    id: 'scope-review',
    name: 'Escopo e mudança',
    baseSkill: 'general',
    canApply: false,
    instructions: 'Revise aderência ao escopo selecionado, efeitos colaterais e arquivos inesperados. Reporte apenas desvios acionáveis usando categoria bug ou style.'
  },
  {
    id: 'tdd-gaps',
    name: 'TDD e lacunas de testes',
    baseSkill: 'tests',
    canApply: false,
    instructions: 'Priorize comportamentos novos, erros e bordas sem teste. Cada finding deve usar categoria test-coverage e sugerir o menor teste observável.'
  },
  {
    id: 'root-cause',
    name: 'Diagnóstico de regressões',
    baseSkill: 'general',
    canApply: false,
    instructions: 'Priorize evidências de causa raiz, invariantes quebradas e cenários de regressão. Use categoria bug e não sugira mudanças sem indicar o comportamento que deve ter teste de regressão.'
  },
  {
    id: 'electron-ipc-security',
    name: 'Segurança Electron e IPC',
    baseSkill: 'security',
    canApply: false,
    instructions: 'Foque em renderer, preload, IPC, paths, shell, subprocessos e segredos. Reporte apenas vulnerabilidades demonstráveis e use categoria security.'
  },
  {
    id: 'merge-readiness',
    name: 'Prontidão de merge',
    baseSkill: 'general',
    canApply: false,
    instructions: 'Foque em riscos que impedem entrega: regressões, cobertura ausente, validações não executadas, comportamento sem evidência e mudanças fora do escopo.'
  }
];

function validateSkill(skill) {
  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error('quality skill must be an object');
  if (typeof skill.id !== 'string' || skill.id.length === 0) throw new Error('quality skill id must be a non-empty string');
  if (typeof skill.name !== 'string' || skill.name.trim().length === 0 || skill.name.length > MAX_SKILL_NAME_LENGTH) {
    throw new Error('quality skill name is invalid');
  }
  if (!['general', 'security', 'performance', 'tests', 'style'].includes(skill.baseSkill)) {
    throw new Error('quality skill base is not supported');
  }
  if (typeof skill.instructions !== 'string' || skill.instructions.length > MAX_SKILL_INSTRUCTIONS_LENGTH) {
    throw new Error('quality skill instructions are invalid');
  }
  if (typeof skill.canApply !== 'boolean') throw new Error('quality skill canApply must be a boolean');
}

function validateSkills(skills) {
  const ids = new Set(DEFAULT_QUALITY_SKILLS.map((skill) => skill.id));
  const names = new Set(DEFAULT_QUALITY_SKILLS.map((skill) => skill.name.toLocaleLowerCase()));
  skills.forEach((skill) => {
    validateSkill(skill);
    if (ids.has(skill.id)) throw new Error('quality skill ids must be unique');
    const normalizedName = skill.name.trim().toLocaleLowerCase();
    if (names.has(normalizedName)) throw new Error('quality skill names must be unique');
    ids.add(skill.id);
    names.add(normalizedName);
  });
}

function readQualitySkills(filePath) {
  if (!fs.existsSync(filePath)) return DEFAULT_QUALITY_SKILLS;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('quality skill storage is corrupted');
  }
  if (!data || data.version !== STORE_VERSION || !Array.isArray(data.skills)) {
    throw new Error('quality skill storage has an unsupported schema');
  }
  validateSkills(data.skills);
  return [...DEFAULT_QUALITY_SKILLS, ...data.skills];
}

function writeQualitySkills(filePath, skills) {
  const customSkills = skills.filter((skill) => !DEFAULT_QUALITY_SKILLS.some((item) => item.id === skill.id));
  validateSkills(customSkills);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, skills: customSkills }, null, 2));
  fs.renameSync(temporaryPath, filePath);
  return [...DEFAULT_QUALITY_SKILLS, ...customSkills];
}

module.exports = {
  DEFAULT_QUALITY_SKILLS,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_INSTRUCTIONS_LENGTH,
  validateSkill,
  readQualitySkills,
  writeQualitySkills
};
