'use strict';

const { listAllFiles, readFileAtRef } = require('./git');
const { MAX_EXCERPT_LENGTH } = require('./projectPolicyStore');

const ALLOWLIST = [
  'AGENTS.md',
  'CLAUDE.md',
  'CONTEXT.md',
  'CONTRIBUTING.md',
  '.github/PULL_REQUEST_TEMPLATE/default.md',
  '.github/pull_request_template.md'
];

function extractExcerpt(content, maxLength = MAX_EXCERPT_LENGTH) {
  if (!content) return '';
  return content.slice(0, maxLength);
}

function discoverRepositoryRules(repoPath, branch) {
  try {
    const files = listAllFiles(repoPath, branch);
    const discovered = [];

    for (const file of files) {
      if (!ALLOWLIST.includes(file)) continue;

      try {
        const content = readFileAtRef(repoPath, branch, file);
        const excerpt = extractExcerpt(content);

        discovered.push({
          path: file,
          excerpt
        });
      } catch {
        // If we can't read a file, skip it
      }
    }

    return discovered;
  } catch {
    return [];
  }
}

module.exports = {
  discoverRepositoryRules
};
