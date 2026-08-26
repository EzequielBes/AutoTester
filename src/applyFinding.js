'use strict';

function parseLineRange(lines) {
  const match = /^(\d+)(?:-(\d+))?$/.exec(lines);
  if (!match) {
    throw new Error(`invalid line range: ${lines}`);
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (end < start) {
    throw new Error(`invalid line range: ${lines}`);
  }
  return { start, end };
}

function applyFinding(fileContent, finding) {
  const { start, end } = parseLineRange(finding.lines);
  const eol = fileContent.includes('\r\n') ? '\r\n' : '\n';
  const fileLines = fileContent.split(/\r\n|\n/);
  if (start < 1 || end > fileLines.length) {
    throw new Error(`line range ${finding.lines} is outside the file (${fileLines.length} lines)`);
  }
  const suggestionLines = finding.suggestion.length === 0 ? [] : finding.suggestion.split(/\r\n|\n/);
  fileLines.splice(start - 1, end - start + 1, ...suggestionLines);
  return fileLines.join(eol);
}

module.exports = { parseLineRange, applyFinding };
