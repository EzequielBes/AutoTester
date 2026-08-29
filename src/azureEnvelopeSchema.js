'use strict';

const MAX_TEXT_LENGTH = 2000;
const MAX_URL_LENGTH = 2000;
const MAX_REVIEWERS = 50;
const MAX_WORK_ITEMS = 100;

function isNonEmptyString(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validatePullRequest(pullRequest, errors) {
  if (pullRequest === null) return;
  if (typeof pullRequest !== 'object' || Array.isArray(pullRequest)) {
    errors.push('pullRequest must be an object or null');
    return;
  }
  if (!isNonEmptyString(pullRequest.id)) errors.push('pullRequest.id must be a non-empty string');
  if (!isNonEmptyString(pullRequest.title)) errors.push('pullRequest.title must be a non-empty string');
  if (!isNonEmptyString(pullRequest.status)) errors.push('pullRequest.status must be a non-empty string');
  if (!isNonEmptyString(pullRequest.targetBranch)) errors.push('pullRequest.targetBranch must be a non-empty string');
  if (!isNonEmptyString(pullRequest.url, MAX_URL_LENGTH)) errors.push('pullRequest.url must be a non-empty string');
}

function validateWorkItems(workItems, errors) {
  if (!Array.isArray(workItems)) {
    errors.push('workItems must be an array');
    return;
  }
  if (workItems.length > MAX_WORK_ITEMS) {
    errors.push(`workItems must not contain more than ${MAX_WORK_ITEMS} items`);
    return;
  }
  workItems.forEach((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`workItems[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(item.id)) errors.push(`workItems[${index}].id must be a non-empty string`);
    if (!isNonEmptyString(item.title)) errors.push(`workItems[${index}].title must be a non-empty string`);
    if (!isNonEmptyString(item.url, MAX_URL_LENGTH)) errors.push(`workItems[${index}].url must be a non-empty string`);
  });
}

function validateAzureEnvelope(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['root value must be an object'] };
  }
  const errors = [];
  if (!isNonEmptyString(parsed.repository)) errors.push('repository must be a non-empty string');
  if (!isNonEmptyString(parsed.branch)) errors.push('branch must be a non-empty string');
  validatePullRequest(parsed.pullRequest, errors);
  if (!Array.isArray(parsed.reviewers) || parsed.reviewers.length > MAX_REVIEWERS || parsed.reviewers.some((name) => !isNonEmptyString(name))) {
    errors.push('reviewers must be an array of non-empty strings');
  }
  validateWorkItems(parsed.workItems, errors);
  if (!isNonEmptyString(parsed.fetchedAt)) errors.push('fetchedAt must be a non-empty string');
  return { valid: errors.length === 0, errors };
}

function projectAzureEnvelope(parsed) {
  return {
    repository: parsed.repository,
    branch: parsed.branch,
    pullRequest: parsed.pullRequest === null ? null : {
      id: parsed.pullRequest.id,
      title: parsed.pullRequest.title,
      status: parsed.pullRequest.status,
      targetBranch: parsed.pullRequest.targetBranch,
      url: parsed.pullRequest.url
    },
    reviewers: [...parsed.reviewers],
    workItems: parsed.workItems.map((item) => ({ id: item.id, title: item.title, url: item.url })),
    fetchedAt: parsed.fetchedAt
  };
}

module.exports = { validateAzureEnvelope, projectAzureEnvelope, MAX_TEXT_LENGTH, MAX_URL_LENGTH, MAX_REVIEWERS, MAX_WORK_ITEMS };
