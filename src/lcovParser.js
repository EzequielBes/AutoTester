'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveInRepo } = require('./resolveInRepo');

const MAX_LCOV_BYTES = 25 * 1024 * 1024;

function percentage(hit, found) {
  return found === 0 ? 0 : Math.round((hit / found) * 10000) / 100;
}

function relativeCoveragePath(repoPath, sourcePath) {
  const root = path.resolve(repoPath);
  const absolute = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(root, sourcePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return path.relative(root, absolute).split(path.sep).join('/');
}

function parseLcov(text, repoPath) {
  const records = new Map();
  let sourcePath = null;
  let lineHits = new Map();
  const finishRecord = () => {
    if (sourcePath === null) throw new Error('LCOV record is missing SF');
    const relativePath = relativeCoveragePath(repoPath, sourcePath);
    if (relativePath) {
      const existing = records.get(relativePath) || new Map();
      lineHits.forEach((hits, line) => existing.set(line, Math.max(existing.get(line) || 0, hits)));
      records.set(relativePath, existing);
    }
    sourcePath = null;
    lineHits = new Map();
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith('TN:')) continue;
    if (rawLine.startsWith('SF:')) {
      if (sourcePath !== null) throw new Error('LCOV record has multiple SF entries');
      sourcePath = rawLine.slice(3);
    } else if (rawLine.startsWith('DA:')) {
      if (sourcePath === null) throw new Error('LCOV DA entry appears before SF');
      const match = rawLine.match(/^DA:(\d+),(\d+)(?:,.*)?$/);
      if (!match || Number(match[1]) < 1) throw new Error(`invalid LCOV DA entry: ${rawLine}`);
      lineHits.set(Number(match[1]), Number(match[2]));
    } else if (rawLine === 'end_of_record') {
      finishRecord();
    }
  }
  if (sourcePath !== null) throw new Error('LCOV record is missing end_of_record');

  const files = [...records.entries()].map(([file, lines]) => {
    const found = lines.size;
    const hit = [...lines.values()].filter((value) => value > 0).length;
    return { file, lines: { found, hit, pct: percentage(hit, found) } };
  }).filter((file) => file.lines.found > 0).sort((a, b) => a.file.localeCompare(b.file));
  const found = files.reduce((total, file) => total + file.lines.found, 0);
  if (found === 0) throw new Error('LCOV report has no covered source lines inside the repository');
  const hit = files.reduce((total, file) => total + file.lines.hit, 0);
  return { lines: { found, hit, pct: percentage(hit, found) }, files };
}

function readLcovCoverage(repoPath, lcovPath) {
  const absolutePath = resolveInRepo(repoPath, lcovPath);
  const size = fs.statSync(absolutePath).size;
  if (size > MAX_LCOV_BYTES) throw new Error(`LCOV report exceeds ${MAX_LCOV_BYTES} bytes`);
  return parseLcov(fs.readFileSync(absolutePath, 'utf8'), repoPath);
}

function selectCoverageFiles(coverage, selectedFiles) {
  const selected = new Set(selectedFiles.map((file) => file.replace(/\\/g, '/')));
  const files = coverage.files.filter((file) => selected.has(file.file));
  const found = files.reduce((total, file) => total + file.lines.found, 0);
  const hit = files.reduce((total, file) => total + file.lines.hit, 0);
  if (found === 0) throw new Error('selected files have no instrumented LCOV lines');
  return { lines: { found, hit, pct: percentage(hit, found) }, files };
}

module.exports = { MAX_LCOV_BYTES, parseLcov, readLcovCoverage, selectCoverageFiles };
