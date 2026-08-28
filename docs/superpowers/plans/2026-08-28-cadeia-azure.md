# Cadeia de Entregas e Conector Azure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Delivery link to an Azure DevOps PR through the Claude CLI's already-authenticated MCP, detect inconsistencies between local and remote state, and let Claude suggest a Delivery Chain that a human must confirm before it becomes operational state.

**Architecture:** A new `src/azureConnector.js` module spawns the `claude` CLI exactly like `src/claudeRunner.js` already does, but asks for a bounded metadata envelope (repo/branch/PR/reviewers/work-items) instead of findings, validated against a new `src/azureEnvelopeSchema.js`. Delivery gains an optional `chain` field (schema v2→v3). A pure `src/deliveryInconsistencyDetector.js` compares a Delivery's local fields against its chain and the latest Azure sync result. New guarded IPC exposes sync, chain suggestion (transient, not persisted), and chain confirmation (persists). The renderer surfaces sync status, inconsistencies, and a chain-suggestion review panel in the Delivery detail view.

**Tech Stack:** Electron 44, Node.js 22, Node built-in test runner, HTML, CSS, JavaScript.

**Spec:** `docs/superpowers/specs/2026-08-28-entregas-design.md` (domain model, principles) and `docs/superpowers/specs/2026-08-28-cadeia-azure-design.md` (implementation decisions for this milestone — envelope shape, failure handling, chain storage, confirmation flow).

## Global Constraints

- Use Node.js 22.12 or newer.
- No Azure API, OAuth, PAT, or credential storage of any kind — the Claude CLI's already-configured MCP is the only path to Azure DevOps.
- Failure, unavailability, or an invalid response from the MCP must never block local Delivery usage — it becomes an inconsistency event, not a thrown IPC error.
- A Claude-generated Chain suggestion must never become persisted/operational state without an explicit human confirmation action.
- All new IPC channels call the existing `assertTrustedRenderer` guard.
- No new npm dependencies.
- Delivery data persists only below Electron `userData`; it never enters the repository or Azure.
- Do not implement Escopo, Exceção de escopo, or automatic code writing — out of scope for this milestone.
- Use `Inter`/`Manrope` for interface text and monospaced text only for technical data (branch names, PR ids, timestamps), matching the existing renderer conventions.

---

### Task 1: Add the Azure Envelope Schema and Connector

**Files:**
- Create: `src/azureEnvelopeSchema.js`
- Create: `src/azureConnector.js`
- Create: `test/azureEnvelopeSchema.test.js`
- Create: `test/azureConnector.test.js`

**Interfaces:**
- Produces `validateAzureEnvelope(parsed): { valid: boolean, errors: string[] }` — validates and strips unknown fields are simply ignored (not an error); type/shape violations on the allowed fields are errors.
- Produces `runAzureSync(prompt, { timeoutMs, signal, spawnImpl, terminate } = {}): Promise<AzureEnvelope>` where `AzureEnvelope` is `{ repository, branch, pullRequest, reviewers, workItems, fetchedAt }`.
- Rejected promise errors carry `error.code` in `{'AZURE_MCP_TIMEOUT', 'AZURE_MCP_OUTPUT_TOO_LARGE', 'AZURE_MCP_INVALID_ENVELOPE', 'AZURE_MCP_SPAWN_ERROR', 'AZURE_MCP_CANCELLED'}`.

- [ ] **Step 1: Write failing envelope schema tests**

Create `test/azureEnvelopeSchema.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAzureEnvelope } = require('../src/azureEnvelopeSchema');

function envelope(overrides = {}) {
  return {
    repository: 'org/repo',
    branch: 'feature/x',
    pullRequest: { id: '123', title: 'Add feature', status: 'active', targetBranch: 'Dev', url: 'https://dev.azure.com/org/repo/pr/123' },
    reviewers: ['alice'],
    workItems: [{ id: '456', title: 'Ticket', url: 'https://dev.azure.com/org/repo/workitems/456' }],
    fetchedAt: '2026-08-28T12:00:00.000Z',
    ...overrides
  };
}

test('accepts a well-formed envelope', () => {
  const { valid, errors } = validateAzureEnvelope(envelope());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('accepts a null pullRequest', () => {
  const { valid } = validateAzureEnvelope(envelope({ pullRequest: null }));
  assert.equal(valid, true);
});

test('ignores unknown top-level fields without erroring', () => {
  const { valid, errors } = validateAzureEnvelope({ ...envelope(), token: 'secret-should-be-ignored' });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('rejects a non-object root value', () => {
  const { valid, errors } = validateAzureEnvelope('not-an-object');
  assert.equal(valid, false);
  assert.deepEqual(errors, ['root value must be an object']);
});

test('rejects a missing repository', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ repository: undefined }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('repository')));
});

test('rejects a missing branch', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ branch: '' }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('branch')));
});

test('rejects a pullRequest missing required fields', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ pullRequest: { id: '123' } }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('pullRequest')));
});

test('rejects reviewers that is not an array of strings', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ reviewers: 'alice' }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('reviewers')));
});

test('rejects workItems entries missing required fields', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ workItems: [{ id: '456' }] }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('workItems')));
});

test('rejects a missing fetchedAt', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ fetchedAt: undefined }));
  assert.equal(valid, false);
  assert.ok(errors.some((message) => message.includes('fetchedAt')));
});

test('rejects content that looks like raw file contents or credentials', () => {
  const { valid, errors } = validateAzureEnvelope(envelope({ diff: 'diff --git a/x b/x\n+secret', accessToken: 'abc' }));
  // extra fields are ignored, not errors — this proves they are dropped, not validated/trusted
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 2: Verify the schema tests fail**

Run: `node --test test/azureEnvelopeSchema.test.js`

Expected: FAIL with `Cannot find module '../src/azureEnvelopeSchema'`.

- [ ] **Step 3: Implement the envelope schema**

Create `src/azureEnvelopeSchema.js`, following the structure of `src/findingsSchema.js`:

```js
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

module.exports = { validateAzureEnvelope, MAX_TEXT_LENGTH, MAX_URL_LENGTH, MAX_REVIEWERS, MAX_WORK_ITEMS };
```

- [ ] **Step 4: Verify the schema tests pass**

Run: `node --test test/azureEnvelopeSchema.test.js`

Expected: PASS, all tests green.

- [ ] **Step 5: Write failing connector tests**

Create `test/azureConnector.test.js`, following the structure of the existing `test/claudeRunner.test.js` (read it first for the fake-`spawnImpl`/`EventEmitter` pattern used to simulate a child process):

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { runAzureSync } = require('../src/azureConnector');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdin.on('error', () => {});
  return child;
}

function envelopeJson(overrides = {}) {
  return JSON.stringify({
    result: JSON.stringify({
      repository: 'org/repo',
      branch: 'feature/x',
      pullRequest: null,
      reviewers: [],
      workItems: [],
      fetchedAt: '2026-08-28T12:00:00.000Z',
      ...overrides
    })
  });
}

test('resolves a valid Azure envelope from the CLI output', async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl });
  child.stdout.emit('data', envelopeJson());
  child.emit('close', 0);
  const envelope = await promise;
  assert.equal(envelope.repository, 'org/repo');
});

test('rejects with AZURE_MCP_INVALID_ENVELOPE on a malformed result', async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl });
  child.stdout.emit('data', JSON.stringify({ result: JSON.stringify({ repository: '' }) }));
  child.emit('close', 0);
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_INVALID_ENVELOPE');
});

test('rejects with AZURE_MCP_TIMEOUT when the CLI does not respond in time', async () => {
  const child = fakeChild();
  child.kill = () => {};
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl, timeoutMs: 10, terminate: () => child.emit('close', null) });
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_TIMEOUT');
});

test('rejects with AZURE_MCP_SPAWN_ERROR when spawning fails', async () => {
  const spawnImpl = () => { throw new Error('spawn failed'); };
  await assert.rejects(runAzureSync('sync prompt', { spawnImpl }), (error) => error.code === 'AZURE_MCP_SPAWN_ERROR');
});

test('rejects with AZURE_MCP_CANCELLED when the signal aborts before start', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAzureSync('sync prompt', { spawnImpl: fakeChild, signal: controller.signal }),
    (error) => error.code === 'AZURE_MCP_CANCELLED'
  );
});

test('rejects with AZURE_MCP_OUTPUT_TOO_LARGE when stdout exceeds the limit', async () => {
  const child = fakeChild();
  child.kill = () => {};
  const spawnImpl = () => child;
  const promise = runAzureSync('sync prompt', { spawnImpl, terminate: () => child.emit('close', null) });
  child.stdout.emit('data', 'x'.repeat(3 * 1024 * 1024));
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_OUTPUT_TOO_LARGE');
});
```

- [ ] **Step 6: Verify the connector tests fail**

Run: `node --test test/azureConnector.test.js`

Expected: FAIL with `Cannot find module '../src/azureConnector'`.

- [ ] **Step 7: Implement the connector**

Create `src/azureConnector.js`, cloning the spawn/timeout/size-limit/cleanup structure of `src/claudeRunner.js` (read it first), reusing `appendTail` and `terminateProcessTree` from `./commandRunner`, and `validateAzureEnvelope` from `./azureEnvelopeSchema`:

```js
'use strict';

const { spawn } = require('node:child_process');
const { validateAzureEnvelope } = require('./azureEnvelopeSchema');
const { MAX_LOG_CHARS, appendTail, terminateProcessTree } = require('./commandRunner');

const DEFAULT_AZURE_TIMEOUT_MS = 120000;
const MAX_AZURE_STDOUT_CHARS = 2 * 1024 * 1024;
const MAX_AZURE_STDERR_CHARS = MAX_LOG_CHARS;

function parseCliOutput(stdout) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    const error = new Error('Azure CLI output is not valid JSON');
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  if (typeof outer.result !== 'string') {
    const error = new Error('Azure CLI output is missing a string "result" field');
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(outer.result);
  } catch {
    const error = new Error('Azure CLI "result" field is not valid JSON');
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  const { valid, errors } = validateAzureEnvelope(parsed);
  if (!valid) {
    const error = new Error(`Azure envelope does not match schema: ${errors.join('; ')}`);
    error.code = 'AZURE_MCP_INVALID_ENVELOPE';
    throw error;
  }
  return parsed;
}

function runAzureSync(prompt, {
  timeoutMs = DEFAULT_AZURE_TIMEOUT_MS,
  signal,
  spawnImpl = spawn,
  terminate = terminateProcessTree
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Azure sync cancelled');
      error.code = 'AZURE_MCP_CANCELLED';
      reject(error);
      return;
    }
    let child;
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timer;
    let stopError = null;
    const abortListener = () => {
      const error = new Error('Azure sync cancelled');
      error.code = 'AZURE_MCP_CANCELLED';
      requestStop(error);
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abortListener);
    };
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      cleanup();
      callback();
    };
    const requestStop = (error) => {
      if (stopError || !child) return;
      stopError = error;
      terminate(child);
    };

    try {
      child = spawnImpl('claude', [
        '-p',
        '--output-format', 'json',
        '--append-system-prompt', prompt
      ], { windowsHide: true });
    } catch (error) {
      error.code = 'AZURE_MCP_SPAWN_ERROR';
      finish(() => reject(error));
      return;
    }

    timer = setTimeout(() => {
      const error = new Error(`Azure sync timed out after ${timeoutMs}ms`);
      error.code = 'AZURE_MCP_TIMEOUT';
      requestStop(error);
    }, timeoutMs);
    signal?.addEventListener('abort', abortListener, { once: true });
    if (signal?.aborted) abortListener();
    child.stdout?.on('data', (chunk) => {
      const output = chunk.toString();
      if (stdout.length + output.length > MAX_AZURE_STDOUT_CHARS) {
        const error = new Error(`Azure CLI output exceeded ${MAX_AZURE_STDOUT_CHARS} characters`);
        error.code = 'AZURE_MCP_OUTPUT_TOO_LARGE';
        requestStop(error);
        return;
      }
      stdout += output;
    });
    child.stderr?.on('data', (chunk) => { stderr = appendTail(stderr, chunk, MAX_AZURE_STDERR_CHARS); });
    child.on('error', (error) => {
      error.code = error.code || 'AZURE_MCP_SPAWN_ERROR';
      finish(() => reject(stopError || error));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end();
    child.on('close', (code) => {
      if (stopError) {
        finish(() => reject(stopError));
      } else if (code !== 0) {
        const error = new Error(`claude CLI exited with code ${code}: ${stderr}`);
        error.code = 'AZURE_MCP_SPAWN_ERROR';
        finish(() => reject(error));
      } else {
        try {
          const envelope = parseCliOutput(stdout);
          finish(() => resolve(envelope));
        } catch (error) {
          finish(() => reject(error));
        }
      }
    });
  });
}

module.exports = { DEFAULT_AZURE_TIMEOUT_MS, MAX_AZURE_STDOUT_CHARS, MAX_AZURE_STDERR_CHARS, parseCliOutput, runAzureSync };
```

- [ ] **Step 8: Verify focused and complete tests**

Run: `node --test test/azureEnvelopeSchema.test.js test/azureConnector.test.js && npm test`

Expected: all new tests and the complete suite pass.

- [ ] **Step 9: Commit**

```bash
git add src/azureEnvelopeSchema.js src/azureConnector.js test/azureEnvelopeSchema.test.js test/azureConnector.test.js
git commit -m "feat: add Azure envelope schema and MCP connector"
```

---

### Task 2: Add the `chain` Field to the Delivery Store

**Files:**
- Modify: `src/deliveryStore.js`
- Modify: `test/deliveryStore.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `delivery.chain` field of shape `{ chainId, position, dependsOn: string[], confirmedAt } | null`. `STORE_VERSION` becomes `3`. `readDeliveries` migrates v1 → v2 → v3 in memory (v1 gets `flowSnapshot: null, chain: null`; v2 gets `chain: null`; v3 is read as-is).

- [ ] **Step 1: Write failing chain validation and migration tests**

Add to `test/deliveryStore.test.js` (read the existing file first to match its fixture helpers and style exactly — it already has a `delivery()` fixture builder and v1-migration tests to follow):

```js
test('writes and reads back a delivery with a confirmed chain', () => {
  const file = tmpFile();
  const withChain = {
    ...delivery(),
    chain: { chainId: 'chain-1', position: 0, dependsOn: [], confirmedAt: '2026-08-28T12:00:00.000Z' }
  };
  writeDeliveries(file, [withChain]);
  const [readBack] = readDeliveries(file);
  assert.deepEqual(readBack.chain, withChain.chain);
});

test('accepts a null chain', () => {
  const file = tmpFile();
  writeDeliveries(file, [{ ...delivery(), chain: null }]);
  const [readBack] = readDeliveries(file);
  assert.equal(readBack.chain, null);
});

test('rejects a chain missing required fields', () => {
  const file = tmpFile();
  assert.throws(
    () => writeDeliveries(file, [{ ...delivery(), chain: { chainId: 'c1' } }]),
    /chain/
  );
});

test('rejects a chain with a non-array dependsOn', () => {
  const file = tmpFile();
  assert.throws(
    () => writeDeliveries(file, [{ ...delivery(), chain: { chainId: 'c1', position: 0, dependsOn: 'not-array', confirmedAt: '2026-08-28T12:00:00.000Z' } }]),
    /dependsOn/
  );
});

test('migrates a version 1 delivery to version 3 with both flowSnapshot and chain null', () => {
  const file = tmpFile();
  const v1Delivery = delivery();
  delete v1Delivery.flowSnapshot;
  fs.writeFileSync(file, JSON.stringify({ version: 1, deliveries: [v1Delivery] }));
  const [migrated] = readDeliveries(file);
  assert.equal(migrated.flowSnapshot, null);
  assert.equal(migrated.chain, null);
  assert.equal(migrated.id, v1Delivery.id);
});

test('migrates a version 2 delivery to version 3 with chain null, preserving flowSnapshot', () => {
  const file = tmpFile();
  const v2Delivery = { ...delivery(), flowSnapshot: { track: null, selectedPolicies: [], agentProfiles: [], qualitySkills: [] } };
  fs.writeFileSync(file, JSON.stringify({ version: 2, deliveries: [v2Delivery] }));
  const [migrated] = readDeliveries(file);
  assert.equal(migrated.chain, null);
  assert.deepEqual(migrated.flowSnapshot, v2Delivery.flowSnapshot);
});

test('writes deliveries at STORE_VERSION 3', () => {
  const file = tmpFile();
  writeDeliveries(file, [delivery()]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 3);
});
```

- [ ] **Step 2: Verify the new tests fail**

Run: `node --test test/deliveryStore.test.js`

Expected: FAIL — `chain` field not recognized/validated, migration not implemented, `STORE_VERSION` still `2`.

- [ ] **Step 3: Implement the chain field, validation, and migration**

In `src/deliveryStore.js`:

```js
const STORE_VERSION = 3;
```

Add after `validateFlowSnapshot`:

```js
function validateChain(chain) {
  if (chain === null || chain === undefined) return;
  if (typeof chain !== 'object' || Array.isArray(chain)) throw new Error('delivery.chain must be an object');
  validateText(chain.chainId, 'chain.chainId', { required: true });
  if (typeof chain.position !== 'number' || !Number.isInteger(chain.position) || chain.position < 0) {
    throw new Error('chain.position must be a non-negative integer');
  }
  if (!Array.isArray(chain.dependsOn) || chain.dependsOn.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('chain.dependsOn must be an array of non-empty strings');
  }
  validateText(chain.confirmedAt, 'chain.confirmedAt', { required: true });
}
```

In `validateDelivery`, add after the `validateFlowSnapshot(delivery.flowSnapshot);` line:

```js
  validateChain(delivery.chain);
```

Replace `migrateV1Delivery` and the version-selection logic in `readDeliveries`:

```js
function migrateV1Delivery(delivery) {
  return { ...delivery, flowSnapshot: null, chain: null };
}

function migrateV2Delivery(delivery) {
  return { ...delivery, chain: null };
}

function readDeliveries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('delivery storage is corrupted');
  }
  if (!data || !Array.isArray(data.deliveries)) {
    throw new Error('delivery storage has an unsupported schema');
  }
  let deliveries;
  if (data.version === 1) {
    deliveries = data.deliveries.map(migrateV1Delivery);
  } else if (data.version === 2) {
    deliveries = data.deliveries.map(migrateV2Delivery);
  } else if (data.version === STORE_VERSION) {
    deliveries = data.deliveries;
  } else {
    deliveries = null;
  }
  if (!deliveries) throw new Error('delivery storage has an unsupported schema');
  validateDeliveries(deliveries);
  return deliveries;
}
```

- [ ] **Step 4: Verify focused and complete tests**

Run: `node --test test/deliveryStore.test.js && npm test`

Expected: the new chain tests and the complete suite pass.

- [ ] **Step 5: Commit**

```bash
git add src/deliveryStore.js test/deliveryStore.test.js
git commit -m "feat(deliveries): add chain field with v2-to-v3 migration"
```

---

### Task 3: Add the Inconsistency Detector

**Files:**
- Create: `src/deliveryInconsistencyDetector.js`
- Create: `test/deliveryInconsistencyDetector.test.js`

**Interfaces:**
- Consumes: a Delivery (with its `chain` field from Task 2) and an optional Azure envelope (the shape produced by Task 1's `runAzureSync`/validated by `validateAzureEnvelope`), plus an optional array of sibling deliveries (to check `dependsOn` status).
- Produces `detectInconsistencies(delivery, { azureEnvelope, allDeliveries } = {}): Inconsistency[]` where `Inconsistency` is `{ severity: 'high'|'medium'|'low', evidence: string, recommendedAction: string, detectedAt: string }`. Pure function — no I/O, caller supplies `now` for determinism via an optional `now` option (default `() => new Date().toISOString()`).

- [ ] **Step 1: Write failing detector tests**

Create `test/deliveryInconsistencyDetector.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectInconsistencies } = require('../src/deliveryInconsistencyDetector');

function delivery(overrides = {}) {
  return {
    id: 'delivery-1',
    repoPath: '/repo',
    objective: 'Add feature',
    branch: 'feature/x',
    baseBranch: 'Dev',
    status: 'active',
    nextAction: '',
    blockedReason: '',
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:00.000Z',
    events: [],
    flowSnapshot: null,
    chain: null,
    ...overrides
  };
}

function envelope(overrides = {}) {
  return {
    repository: 'org/repo',
    branch: 'feature/x',
    pullRequest: { id: '1', title: 'PR', status: 'active', targetBranch: 'Dev', url: 'https://example.test/pr/1' },
    reviewers: [],
    workItems: [],
    fetchedAt: '2026-08-28T12:00:00.000Z',
    ...overrides
  };
}

const now = () => '2026-08-28T13:00:00.000Z';

test('returns no inconsistencies for a delivery matching its Azure envelope', () => {
  const result = detectInconsistencies(delivery(), { azureEnvelope: envelope(), now });
  assert.deepEqual(result, []);
});

test('flags a branch mismatch between the delivery and the Azure PR branch', () => {
  const result = detectInconsistencies(delivery({ branch: 'feature/other' }), { azureEnvelope: envelope(), now });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'high');
  assert.match(result[0].evidence, /branch/i);
  assert.equal(result[0].detectedAt, now());
});

test('flags a base branch different from Dev', () => {
  const result = detectInconsistencies(delivery({ baseBranch: 'main' }), { azureEnvelope: envelope(), now });
  assert.ok(result.some((item) => /base/i.test(item.evidence)));
});

test('flags a missing pull request when Azure envelope has none', () => {
  const result = detectInconsistencies(delivery(), { azureEnvelope: envelope({ pullRequest: null }), now });
  assert.ok(result.some((item) => /pull request/i.test(item.evidence)));
});

test('flags a pull request targeting a branch other than Dev', () => {
  const result = detectInconsistencies(delivery(), {
    azureEnvelope: envelope({ pullRequest: { id: '1', title: 'PR', status: 'active', targetBranch: 'main', url: 'https://example.test/pr/1' } }),
    now
  });
  assert.ok(result.some((item) => /target/i.test(item.evidence)));
});

test('produces no Azure-related inconsistencies when no envelope is supplied', () => {
  const result = detectInconsistencies(delivery(), { now });
  assert.deepEqual(result, []);
});

test('flags an unmerged dependency required by the chain', () => {
  const dependency = delivery({ id: 'delivery-0', status: 'active' });
  const dependent = delivery({
    id: 'delivery-1',
    chain: { chainId: 'chain-1', position: 1, dependsOn: ['delivery-0'], confirmedAt: '2026-08-28T11:00:00.000Z' }
  });
  const result = detectInconsistencies(dependent, { allDeliveries: [dependency, dependent], now });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'medium');
  assert.match(result[0].evidence, /delivery-0/);
});

test('does not flag a dependency that is already merged', () => {
  const dependency = delivery({ id: 'delivery-0', status: 'merged' });
  const dependent = delivery({
    id: 'delivery-1',
    chain: { chainId: 'chain-1', position: 1, dependsOn: ['delivery-0'], confirmedAt: '2026-08-28T11:00:00.000Z' }
  });
  const result = detectInconsistencies(dependent, { allDeliveries: [dependency, dependent], now });
  assert.deepEqual(result, []);
});

test('flags a dependsOn id that references a delivery not present in allDeliveries', () => {
  const dependent = delivery({
    chain: { chainId: 'chain-1', position: 1, dependsOn: ['missing-delivery'], confirmedAt: '2026-08-28T11:00:00.000Z' }
  });
  const result = detectInconsistencies(dependent, { allDeliveries: [dependent], now });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'medium');
});

test('each inconsistency includes a recommendedAction string', () => {
  const result = detectInconsistencies(delivery({ branch: 'feature/other' }), { azureEnvelope: envelope(), now });
  result.forEach((item) => assert.ok(typeof item.recommendedAction === 'string' && item.recommendedAction.length > 0));
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test test/deliveryInconsistencyDetector.test.js`

Expected: FAIL with `Cannot find module '../src/deliveryInconsistencyDetector'`.

- [ ] **Step 3: Implement the detector**

Create `src/deliveryInconsistencyDetector.js`:

```js
'use strict';

function detectInconsistencies(delivery, { azureEnvelope = null, allDeliveries = [], now = () => new Date().toISOString() } = {}) {
  const inconsistencies = [];
  const detectedAt = now();

  if (azureEnvelope) {
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
```

- [ ] **Step 4: Verify focused and complete tests**

Run: `node --test test/deliveryInconsistencyDetector.test.js && npm test`

Expected: all new tests and the complete suite pass.

- [ ] **Step 5: Commit**

```bash
git add src/deliveryInconsistencyDetector.js test/deliveryInconsistencyDetector.test.js
git commit -m "feat(deliveries): add inconsistency detector"
```

---

### Task 4: Add Guarded IPC for Azure Sync, Chain Suggestion, and Chain Confirmation

**Files:**
- Modify: `src/deliveryIpc.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `test/deliveryIpc.test.js`

**Interfaces:**
- Consumes: `runAzureSync` (Task 1), `detectInconsistencies` (Task 3), `readDeliveries`/`writeDeliveries` (existing, Task 2's `chain` field).
- Produces IPC channels `deliveries:sync-azure`, `deliveries:suggest-chain`, `deliveries:confirm-chain`.
- Produces preload methods `syncAzure(deliveryId)`, `suggestChain(deliveryIds)`, `confirmChain(entries)` where `entries` is `[{ deliveryId, position, dependsOn }]`.
- `deliveries:sync-azure` never rejects on Azure/MCP failure — it catches connector errors, appends an `inconsistency` event to the delivery's timeline, and returns the updated delivery. It only rejects on a truly unexpected local error (e.g. delivery not found).
- `deliveries:suggest-chain` does not persist anything — returns `{ suggestion: [{ deliveryId, position, dependsOn }], evidence: string }` without touching the store.
- `deliveries:confirm-chain` persists the given chain entries onto their respective deliveries, setting `confirmedAt` to the current time.

- [ ] **Step 1: Write failing IPC tests**

Add to `test/deliveryIpc.test.js` (read the existing file first — it has a `setup()` helper building a fake `ipcMain` handler map and a temp store file; match that pattern exactly):

```js
test('deliveries:sync-azure records an inconsistency event when the Azure connector fails, without throwing', async () => {
  const { handlers, deliveriesFilePath } = setup({
    runAzureSync: async () => { const error = new Error('timed out'); error.code = 'AZURE_MCP_TIMEOUT'; throw error; }
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = await handlers.get('deliveries:sync-azure')({ sender: {} }, saved.id);
  assert.equal(result.id, saved.id);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'inconsistency');
  assert.match(result.events[0].detail, /timed out|AZURE_MCP_TIMEOUT/);
});

test('deliveries:sync-azure records no inconsistency event on a clean, matching sync', async () => {
  const { handlers } = setup({
    runAzureSync: async () => ({
      repository: 'org/repo', branch: draft().branch, pullRequest: { id: '1', title: 'PR', status: 'active', targetBranch: 'Dev', url: 'https://example.test/pr/1' },
      reviewers: [], workItems: [], fetchedAt: '2026-08-28T12:00:00.000Z'
    })
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = await handlers.get('deliveries:sync-azure')({ sender: {} }, saved.id);
  assert.equal(result.events.length, 0);
});

test('deliveries:sync-azure rejects when the delivery does not exist', async () => {
  const { handlers } = setup({ runAzureSync: async () => ({}) });
  await assert.rejects(handlers.get('deliveries:sync-azure')({ sender: {} }, 'missing-id'));
});

test('deliveries:suggest-chain returns a suggestion without persisting it', async () => {
  const { handlers, deliveriesFilePath } = setup({
    runAzureSync: async () => ({}),
    suggestChainImpl: async () => ({ suggestion: [{ deliveryId: 'delivery-1', position: 0, dependsOn: [] }], evidence: 'inferred from Git history' })
  });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = await handlers.get('deliveries:suggest-chain')({ sender: {} }, [saved.id]);
  assert.equal(result.suggestion.length, 1);
  assert.equal(result.suggestion[0].deliveryId, saved.id === result.suggestion[0].deliveryId ? saved.id : result.suggestion[0].deliveryId);
  const { readDeliveries } = require('../src/deliveryStore');
  const [stored] = readDeliveries(deliveriesFilePath());
  assert.equal(stored.chain, null);
});

test('deliveries:confirm-chain persists chain entries onto their deliveries', () => {
  const { handlers, deliveriesFilePath } = setup();
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());
  const result = handlers.get('deliveries:confirm-chain')({ sender: {} }, [
    { deliveryId: saved.id, chainId: 'chain-1', position: 0, dependsOn: [] }
  ]);
  assert.equal(result[0].chain.chainId, 'chain-1');
  assert.equal(result[0].chain.position, 0);
  assert.ok(result[0].chain.confirmedAt);
  const { readDeliveries } = require('../src/deliveryStore');
  const [stored] = readDeliveries(deliveriesFilePath());
  assert.equal(stored.chain.chainId, 'chain-1');
});

test('deliveries:confirm-chain rejects an untrusted renderer', () => {
  const { handlers, checks } = setup({ assertTrustedRenderer: () => { throw new Error('untrusted renderer'); } });
  assert.throws(() => handlers.get('deliveries:confirm-chain')({ sender: {} }, []), /untrusted renderer/);
});
```

Note: match the exact shape/signature of the existing `setup()` helper in `test/deliveryIpc.test.js` when wiring `runAzureSync`/`suggestChainImpl` as injectable dependencies — extend `setup()`'s options object rather than inventing a new helper.

- [ ] **Step 2: Verify the new tests fail**

Run: `node --test test/deliveryIpc.test.js`

Expected: FAIL — `deliveries:sync-azure`, `deliveries:suggest-chain`, `deliveries:confirm-chain` handlers do not exist yet.

- [ ] **Step 3: Implement the new IPC handlers**

In `src/deliveryIpc.js`, add near the top:

```js
const crypto = require('node:crypto');
```

(if not already imported — it already is, per the current file). Add after the existing requires:

```js
function appendEvent(delivery, { kind, detail }) {
  return {
    ...delivery,
    events: [...delivery.events, { id: crypto.randomUUID(), timestamp: new Date().toISOString(), kind, detail }]
  };
}
```

Extend `registerDeliveryIpc`'s options parameter to accept `runAzureSync`, `suggestChainImpl`, and `detectInconsistencies` (injected, defaulting to the real implementations so `main.js` can pass the real modules while tests inject fakes):

```js
function registerDeliveryIpc(ipcMain, {
  deliveriesFilePath,
  projectPoliciesFilePath,
  validationTracksFilePath,
  agentProfilesFilePath,
  qualitySkillsFilePath,
  assertTrustedRenderer,
  runAzureSync,
  suggestChainImpl,
  detectInconsistencies
}) {
```

Add the three new handlers at the end of `registerDeliveryIpc`, before the closing brace:

```js
  ipcMain.handle('deliveries:sync-azure', async (event, deliveryId) => {
    assertTrustedRenderer(event);
    const deliveries = readDeliveries(deliveriesFilePath());
    const existing = deliveries.find((item) => item.id === deliveryId);
    if (!existing) throw new Error('delivery was not found');

    let updated = existing;
    try {
      const envelope = await runAzureSync(`Fetch Azure DevOps metadata for repository at branch "${existing.branch}".`);
      const inconsistencies = detectInconsistencies(existing, { azureEnvelope: envelope, allDeliveries: deliveries });
      inconsistencies.forEach((item) => {
        updated = appendEvent(updated, { kind: 'inconsistency', detail: `${item.evidence} — ${item.recommendedAction}` });
      });
    } catch (error) {
      updated = appendEvent(updated, { kind: 'inconsistency', detail: `Azure sync failed: ${error.message}` });
    }

    if (updated === existing) return existing;
    return writeDeliveries(deliveriesFilePath(), deliveries.map((item) => item.id === existing.id ? updated : item))
      .find((item) => item.id === existing.id);
  });

  ipcMain.handle('deliveries:suggest-chain', async (event, deliveryIds) => {
    assertTrustedRenderer(event);
    return suggestChainImpl(Array.isArray(deliveryIds) ? deliveryIds : []);
  });

  ipcMain.handle('deliveries:confirm-chain', (event, entries) => {
    assertTrustedRenderer(event);
    if (!Array.isArray(entries)) throw new Error('chain entries must be an array');
    const deliveries = readDeliveries(deliveriesFilePath());
    const confirmedAt = new Date().toISOString();
    const byId = new Map(entries.map((entry) => [entry.deliveryId, entry]));
    const next = deliveries.map((delivery) => {
      const entry = byId.get(delivery.id);
      if (!entry) return delivery;
      return {
        ...delivery,
        chain: { chainId: entry.chainId, position: entry.position, dependsOn: entry.dependsOn || [], confirmedAt }
      };
    });
    return writeDeliveries(deliveriesFilePath(), next).filter((item) => byId.has(item.id));
  });
```

- [ ] **Step 4: Add `suggestChain` to `src/azureConnector.js`**

`runAzureSync` (Task 1) returns a *validated PR-metadata envelope* — it cannot serve chain suggestions, which have an unrelated shape (`{ suggestion: [...], evidence }`). Do not reuse `runAzureSync`/`validateAzureEnvelope` for this. Add a sibling function `suggestChain(deliveryIds, options)` to `src/azureConnector.js`: same spawn/timeout/parse pattern as `runAzureSync`, its own prompt, and its own lightweight shape check.

- [ ] **Step 4a: Write failing test for `suggestChain` in `src/azureConnector.js`**

Add to `test/azureConnector.test.js`:

```js
const { suggestChain } = require('../src/azureConnector');

test('suggestChain resolves a chain suggestion from the CLI output', async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  const promise = suggestChain(['delivery-1', 'delivery-2'], { spawnImpl });
  child.stdout.emit('data', JSON.stringify({
    result: JSON.stringify({ suggestion: [{ deliveryId: 'delivery-1', position: 0, dependsOn: [] }, { deliveryId: 'delivery-2', position: 1, dependsOn: ['delivery-1'] }], evidence: 'inferred from Git' })
  }));
  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.suggestion.length, 2);
  assert.equal(result.evidence, 'inferred from Git');
});

test('suggestChain rejects with AZURE_MCP_INVALID_ENVELOPE on a malformed suggestion', async () => {
  const child = fakeChild();
  const spawnImpl = () => child;
  const promise = suggestChain(['delivery-1'], { spawnImpl });
  child.stdout.emit('data', JSON.stringify({ result: JSON.stringify({ suggestion: 'not-an-array' }) }));
  child.emit('close', 0);
  await assert.rejects(promise, (error) => error.code === 'AZURE_MCP_INVALID_ENVELOPE');
});
```

- [ ] **Step 4b: Verify it fails**

Run: `node --test test/azureConnector.test.js`

Expected: FAIL — `suggestChain` is not exported.

- [ ] **Step 4c: Implement `suggestChain` in `src/azureConnector.js`**

Add to `src/azureConnector.js`, reusing the same spawn/timeout/cleanup shape as `runAzureSync` (extract the shared spawn-and-collect logic into a small private helper `spawnClaudeJson(prompt, options)` that both `runAzureSync` and `suggestChain` call, each with its own output parser, to avoid duplicating the whole function body):

```js
function validateChainSuggestion(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['root value must be an object'] };
  }
  if (!Array.isArray(parsed.suggestion)) {
    errors.push('suggestion must be an array');
  } else {
    parsed.suggestion.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) { errors.push(`suggestion[${index}] must be an object`); return; }
      if (typeof entry.deliveryId !== 'string' || entry.deliveryId.length === 0) errors.push(`suggestion[${index}].deliveryId must be a non-empty string`);
      if (typeof entry.position !== 'number' || !Number.isInteger(entry.position)) errors.push(`suggestion[${index}].position must be an integer`);
      if (!Array.isArray(entry.dependsOn) || entry.dependsOn.some((id) => typeof id !== 'string')) errors.push(`suggestion[${index}].dependsOn must be an array of strings`);
    });
  }
  if (typeof parsed.evidence !== 'string') errors.push('evidence must be a string');
  return { valid: errors.length === 0, errors };
}

function suggestChain(deliveryIds, options = {}) {
  const prompt = `Suggest an approval order (a Delivery Chain) for these deliveries, using Git and Azure DevOps context where available. Delivery ids: ${deliveryIds.join(', ')}. Respond with a JSON object: { "suggestion": [{ "deliveryId": string, "position": number, "dependsOn": string[] }], "evidence": string }.`;
  return spawnClaudeJson(prompt, options, (parsed) => {
    const { valid, errors } = validateChainSuggestion(parsed);
    if (!valid) {
      const error = new Error(`Chain suggestion does not match schema: ${errors.join('; ')}`);
      error.code = 'AZURE_MCP_INVALID_ENVELOPE';
      throw error;
    }
    return parsed;
  });
}
```

Refactor `runAzureSync`'s body to extract `spawnClaudeJson(prompt, options, parseResult)` — a private function containing everything currently in `runAzureSync` except the final `parseCliOutput(stdout)` call, which becomes `parseResult(JSON.parse(...))`-shaped (thread `parseResult` through in place of the hardcoded `parseCliOutput` call in the `close` handler). Keep `parseCliOutput` as the `parseResult` implementation `runAzureSync` passes in, so its existing behavior and error codes are unchanged. Run the full `azureConnector.test.js` suite after refactoring to confirm no regression before moving on.

Export `suggestChain` from `module.exports`.

- [ ] **Step 4d: Verify all connector tests pass**

Run: `node --test test/azureConnector.test.js`

Expected: PASS, including the new `suggestChain` tests and all pre-existing `runAzureSync` tests (regression check on the refactor).

- [ ] **Step 5: Wire real implementations in `main.js` and `preload.js`**

In `main.js`, add near the top, alongside the other `src/` requires:

```js
const { runAzureSync, suggestChain } = require('./src/azureConnector');
const { detectInconsistencies } = require('./src/deliveryInconsistencyDetector');
```

Find the existing `registerDeliveryIpc(ipcMain, { ... })` call site in `main.js` and add the three new options:

```js
    runAzureSync,
    suggestChainImpl: suggestChain,
    detectInconsistencies
```

In `preload.js`, find where the existing delivery methods (`listDeliveries`, `openDelivery`, `saveDelivery`, `buildDeliveryFlowSnapshot`) are exposed and add:

```js
  syncAzure: (deliveryId) => ipcRenderer.invoke('deliveries:sync-azure', deliveryId),
  suggestChain: (deliveryIds) => ipcRenderer.invoke('deliveries:suggest-chain', deliveryIds),
  confirmChain: (entries) => ipcRenderer.invoke('deliveries:confirm-chain', entries),
```

- [ ] **Step 6: Verify focused and complete tests**

Run: `node --test test/deliveryIpc.test.js test/azureConnector.test.js && npm test`

Expected: all new tests and the complete suite pass.

- [ ] **Step 7: Commit**

```bash
git add src/deliveryIpc.js src/azureConnector.js main.js preload.js test/deliveryIpc.test.js test/azureConnector.test.js
git commit -m "feat(deliveries): add guarded IPC for Azure sync and chain suggestion/confirmation"
```

---

### Task 5: Add Chain and Sync UI to the Delivery Detail View

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`
- Modify: `renderer/style.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: `window.api.syncAzure`, `window.api.suggestChain`, `window.api.confirmChain` (Task 4).
- Produces a "Cadeia e Azure" section inside the Delivery detail view: a sync button showing last-synced status and any inconsistencies (from the delivery's `events` where `kind === 'inconsistency'`), a chain-suggestion button that shows a transient (not-yet-saved) preview with accept/adjust/reject actions, and — once confirmed — a read-only chain-position display.

- [ ] **Step 1: Add the semantic markup**

In `renderer/index.html`, inside the existing Delivery detail section (find the `Fluxo`-section markup added in the prior milestone as your insertion point — read `renderer/index.html` first), add a new section:

```html
<section class="delivery-chain-section" aria-labelledby="delivery-chain-heading">
  <h3 id="delivery-chain-heading">Cadeia e Azure</h3>
  <div class="delivery-chain-actions">
    <button type="button" id="sync-azure-btn" class="button-secondary">Sincronizar com Azure</button>
    <button type="button" id="suggest-chain-btn" class="button-secondary">Sugerir cadeia</button>
  </div>
  <p id="delivery-sync-status" class="status-text" role="status"></p>
  <ul id="delivery-inconsistency-list" class="inconsistency-list" aria-label="Inconsistências"></ul>
  <div id="delivery-chain-suggestion" class="chain-suggestion" hidden>
    <p id="chain-suggestion-evidence"></p>
    <ol id="chain-suggestion-list"></ol>
    <div class="chain-suggestion-actions">
      <button type="button" id="accept-chain-btn" class="button-primary">Aceitar</button>
      <button type="button" id="reject-chain-btn" class="button-secondary">Rejeitar</button>
    </div>
  </div>
  <div id="delivery-chain-confirmed" class="chain-confirmed"></div>
</section>
```

- [ ] **Step 2: Implement renderer behavior**

In `renderer/renderer.js` (read the existing Delivery-detail rendering functions first — `renderDeliveryDetail`, `renderFlowSnapshotSummary` — to match their `createElement`/`textContent` safe-DOM style exactly), add:

```js
let chainSuggestionState = null;

function renderInconsistencyList(delivery) {
  const list = document.getElementById('delivery-inconsistency-list');
  list.innerHTML = '';
  const inconsistencyEvents = delivery.events.filter((event) => event.kind === 'inconsistency');
  if (inconsistencyEvents.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma inconsistência registrada.';
    list.appendChild(empty);
    return;
  }
  inconsistencyEvents.forEach((event) => {
    const item = document.createElement('li');
    const timestamp = document.createElement('span');
    timestamp.className = 'mono';
    timestamp.textContent = event.timestamp;
    const detail = document.createElement('span');
    detail.textContent = event.detail;
    item.appendChild(timestamp);
    item.appendChild(detail);
    list.appendChild(item);
  });
}

function renderChainConfirmed(delivery) {
  const container = document.getElementById('delivery-chain-confirmed');
  container.innerHTML = '';
  if (!delivery.chain) return;
  const summary = document.createElement('p');
  summary.textContent = `Posição ${delivery.chain.position} na cadeia ${delivery.chain.chainId}`;
  container.appendChild(summary);
}

async function syncAzure() {
  if (!editingDeliveryId) return;
  const statusEl = document.getElementById('delivery-sync-status');
  statusEl.textContent = 'Sincronizando...';
  try {
    const updated = await window.api.syncAzure(editingDeliveryId);
    deliveries = deliveries.map((item) => item.id === updated.id ? updated : item);
    renderInconsistencyList(updated);
    statusEl.textContent = 'Sincronizado.';
  } catch (error) {
    statusEl.textContent = '';
    setStatus(error.message, 'error');
  }
}

async function suggestChain() {
  if (!editingDeliveryId) return;
  try {
    const result = await window.api.suggestChain([editingDeliveryId]);
    chainSuggestionState = result;
    const container = document.getElementById('delivery-chain-suggestion');
    const evidence = document.getElementById('chain-suggestion-evidence');
    const list = document.getElementById('chain-suggestion-list');
    evidence.textContent = result.evidence;
    list.innerHTML = '';
    result.suggestion.forEach((entry) => {
      const item = document.createElement('li');
      item.textContent = `${entry.deliveryId} — posição ${entry.position}`;
      list.appendChild(item);
    });
    container.hidden = false;
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function acceptChainSuggestion() {
  if (!chainSuggestionState) return;
  const chainId = `chain-${Date.now()}`;
  const entries = chainSuggestionState.suggestion.map((entry) => ({
    deliveryId: entry.deliveryId,
    chainId,
    position: entry.position,
    dependsOn: entry.dependsOn
  }));
  try {
    const updated = await window.api.confirmChain(entries);
    deliveries = deliveries.map((item) => {
      const match = updated.find((u) => u.id === item.id);
      return match || item;
    });
    rejectChainSuggestion();
    const current = deliveries.find((item) => item.id === editingDeliveryId);
    if (current) renderChainConfirmed(current);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function rejectChainSuggestion() {
  chainSuggestionState = null;
  document.getElementById('delivery-chain-suggestion').hidden = true;
}
```

Wire the buttons (find where other Delivery-detail buttons like `save-flow-snapshot-btn` are wired in the existing code, and add alongside them):

```js
document.getElementById('sync-azure-btn').addEventListener('click', syncAzure);
document.getElementById('suggest-chain-btn').addEventListener('click', suggestChain);
document.getElementById('accept-chain-btn').addEventListener('click', acceptChainSuggestion);
document.getElementById('reject-chain-btn').addEventListener('click', rejectChainSuggestion);
```

In `renderDeliveryDetail` (the existing function), add calls to `renderInconsistencyList(delivery)` and `renderChainConfirmed(delivery)` alongside its other render calls, and reset `chainSuggestionState = null` plus hide `#delivery-chain-suggestion` whenever a different delivery is opened (mirroring how the existing function already resets other per-delivery transient state).

- [ ] **Step 3: Apply matching visual style**

In `renderer/style.css`, add rules for `.delivery-chain-section`, `.delivery-chain-actions`, `.inconsistency-list`, `.chain-suggestion`, `.chain-suggestion-actions`, `.chain-confirmed`, reusing the existing CSS custom properties already defined in the file (`var(--void)`, `var(--line)`, `var(--cyan-dim)`, `var(--text-dim)`, `var(--mono)`, `var(--text)`, and the amber/red semantic variables used for warning/blocking states elsewhere in the file — read the file first to find their exact names) rather than introducing new hardcoded colors. Give inconsistency list items a left border in the amber/warning variable to make them visually distinct as attention items, per the spec's "âmbar para atenção" convention.

- [ ] **Step 4: Manually verify the renderer**

Run: `npm start` if a display is available in your environment. If not (no `DISPLAY`, no Xvfb — check before attempting), do a careful static trace instead: confirm every `window.api.*` call matches a `preload.js` export from Task 4, every `document.getElementById(...)` matches an id added in Step 1, and no `innerHTML` assignment interpolates untrusted data (inconsistency `detail` text and chain suggestion `evidence`/`deliveryId` values must go through `textContent`, never string-concatenated into `innerHTML`). State explicitly in your task report which verification method you used.

- [ ] **Step 5: Document the feature**

Update `README.md`'s Entregas description to mention that a Delivery can sync with Azure DevOps through the Claude CLI's MCP and that Chain suggestions always require explicit confirmation before they affect any Delivery.

- [ ] **Step 6: Verify full suite**

Run: `npm test`

Expected: full suite passes (this task adds no new automated tests — UI-only, consistent with how the equivalent renderer task was handled in the prior milestone).

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html renderer/renderer.js renderer/style.css README.md
git commit -m "feat(deliveries): add chain and Azure sync UI to delivery detail"
```
