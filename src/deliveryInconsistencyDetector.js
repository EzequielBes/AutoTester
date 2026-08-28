'use strict';

function detectInconsistencies(delivery, { azureEnvelope = null, allDeliveries = [], now = () => new Date().toISOString() } = {}) {
  const inconsistencies = [];
  const detectedAt = now();

  if (azureEnvelope) {
    const repoDirName = String(delivery.repoPath || '').split(/[\\/]/).filter(Boolean).pop() || '';
    const azureRepoName = String(azureEnvelope.repository || '').split('/').filter(Boolean).pop() || '';
    if (repoDirName && azureRepoName && repoDirName.toLowerCase() !== azureRepoName.toLowerCase()) {
      inconsistencies.push({
        severity: 'high',
        evidence: `delivery repository "${delivery.repoPath}" does not match the Azure repository "${azureEnvelope.repository}"`,
        recommendedAction: 'confirm the Azure sync is targeting the correct repository',
        detectedAt
      });
    }
    if (azureEnvelope.branch !== delivery.branch) {
      inconsistencies.push({
        severity: 'high',
        evidence: `delivery branch "${delivery.branch}" does not match the Azure PR branch "${azureEnvelope.branch}"`,
        recommendedAction: 'confirm which branch is correct and update the delivery or push the intended branch to Azure',
        detectedAt
      });
    }
    if (delivery.baseBranch !== 'Dev') {
      inconsistencies.push({
        severity: 'medium',
        evidence: `delivery base branch is "${delivery.baseBranch}", expected "Dev"`,
        recommendedAction: 'rebase the delivery onto Dev or correct the recorded base branch',
        detectedAt
      });
    }
    if (!azureEnvelope.pullRequest) {
      inconsistencies.push({
        severity: 'medium',
        evidence: 'no pull request was found in Azure for this delivery',
        recommendedAction: 'open a pull request in Azure DevOps or link one manually',
        detectedAt
      });
    } else if (azureEnvelope.pullRequest.targetBranch !== 'Dev') {
      inconsistencies.push({
        severity: 'high',
        evidence: `pull request targets "${azureEnvelope.pullRequest.targetBranch}" instead of "Dev"`,
        recommendedAction: 'retarget the pull request to Dev',
        detectedAt
      });
    }
  }

  const chain = delivery.chain;
  if (chain) {
    chain.dependsOn.forEach((dependencyId) => {
      const dependency = allDeliveries.find((item) => item.id === dependencyId);
      if (!dependency) {
        inconsistencies.push({
          severity: 'medium',
          evidence: `chain dependency "${dependencyId}" was not found among known deliveries`,
          recommendedAction: 'confirm the dependency still exists or update the chain',
          detectedAt
        });
      } else if (dependency.status !== 'merged') {
        inconsistencies.push({
          severity: 'medium',
          evidence: `chain dependency "${dependencyId}" is not merged (status: ${dependency.status})`,
          recommendedAction: 'wait for the dependency to merge before proceeding, or update the chain order',
          detectedAt
        });
      }
    });
  }

  return inconsistencies;
}

module.exports = { detectInconsistencies };
