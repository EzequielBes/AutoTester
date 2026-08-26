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

function splitLinesWithEol(fileContent) {
  const matches = fileContent.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [''];
  if (matches.length > 1 && matches[matches.length - 1] === '') {
    matches.pop();
  }
  return matches.map((line) => {
    if (line.endsWith('\r\n')) return { content: line.slice(0, -2), eol: '\r\n' };
    if (line.endsWith('\n')) return { content: line.slice(0, -1), eol: '\n' };
    if (line.endsWith('\r')) return { content: line.slice(0, -1), eol: '\r' };
    return { content: line, eol: '' };
  });
}

function applyFinding(fileContent, finding) {
  const { start, end } = parseLineRange(finding.lines);
  const lines = splitLinesWithEol(fileContent);
  if (start < 1 || end > lines.length) {
    throw new Error(`line range ${finding.lines} is outside the file (${lines.length} lines)`);
  }
  const originalEol = lines[end - 1].eol;
  const interiorEol = originalEol || '\n';
  const suggestionLines = finding.suggestion.length === 0 ? [] : finding.suggestion.split(/\r\n|\n/);
  const newEntries = suggestionLines.map((content, idx) => ({
    content,
    eol: idx === suggestionLines.length - 1 ? originalEol : interiorEol
  }));
  lines.splice(start - 1, end - start + 1, ...newEntries);
  return lines.map((line) => line.content + line.eol).join('');
}

module.exports = { parseLineRange, applyFinding };
