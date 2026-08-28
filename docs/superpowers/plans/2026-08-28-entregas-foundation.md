# Entregas Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Entregas the local, persistent entry point for feature work, with context, blockers, next actions, and an auditable timeline.

**Architecture:** A versioned local `deliveryStore` persists the Delivery model and events atomically. Guarded IPC exposes only list, open, and save operations; the renderer uses those operations to show a Delivery-first workspace while preserving the existing review, tracks, and log flows.

**Tech Stack:** Electron 44, Node.js 22, Node built-in test runner, HTML, CSS, JavaScript.

**Spec:** `docs/superpowers/specs/2026-08-28-entregas-design.md`

## Global Constraints

- Use Node.js 22.12 or newer.
- Delivery data persists only below Electron `userData`; it never enters the repository or Azure.
- Preserve the existing trusted-renderer guard on every new IPC handler.
- Do not add dependencies or a new UI framework.
- The first milestone excludes Azure, policies, flow changes, automated writing, and scope exceptions.
- Use `Inter` or `Manrope` for interface text and monospaced text only for technical data.
- Keep keyboard focus, reduced-motion support, and responsive layouts.

---

### Task 1: Add the Delivery Store

**Files:**
- Create: `src/deliveryStore.js`
- Create: `test/deliveryStore.test.js`

**Interfaces:**
- Produces `readDeliveries(filePath): Delivery[]`.
- Produces `readDelivery(filePath, deliveryId): Delivery | null`.
- Produces `writeDeliveries(filePath, deliveries): Delivery[]`.
- Produces `validateDelivery(delivery): void`.
- A Delivery has `id`, `repoPath`, `objective`, `branch`, `baseBranch`, `status`, `nextAction`, `blockedReason`, `createdAt`, `updatedAt`, and `events`.

- [ ] **Step 1: Write failing store tests**

Create `test/deliveryStore.test.js` with a valid fixture and tests for the missing-file default, versioned round trip, corrupted JSON rejection, invalid status rejection, duplicate identifiers, and event validation.

```js
test('writes a versioned delivery store and reads it back', () => {
  const file = tmpFile();
  const deliveries = [delivery()];
  writeDeliveries(file, deliveries);

  assert.deepEqual(readDeliveries(file), deliveries);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
});
```

- [ ] **Step 2: Verify the tests fail because the module is absent**

Run: `node --test test/deliveryStore.test.js`

Expected: FAIL with `Cannot find module '../src/deliveryStore'`.

- [ ] **Step 3: Implement the versioned store**

Create `src/deliveryStore.js` using the validation and atomic write approach from `src/validationTrackStore.js`.

```js
const STORE_VERSION = 1;
const DELIVERY_STATUSES = new Set(['draft', 'active', 'blocked', 'validating', 'ready-for-pr', 'waiting-approval', 'merged', 'cancelled']);

function readDeliveries(filePath) { /* return [] for a missing file; reject corrupt or unsupported storage */ }
function writeDeliveries(filePath, deliveries) { /* validate; write versioned JSON through a temporary path; rename */ }
```

Validate all persisted strings with bounded lengths, require non-empty `id`, `repoPath`, `objective`, `branch`, `baseBranch`, timestamps, and an event array. An event requires `id`, `timestamp`, `kind`, and `detail` strings.

- [ ] **Step 4: Verify focused and complete tests**

Run: `node --test test/deliveryStore.test.js && npm test`

Expected: the new store tests and the complete suite pass.

### Task 2: Expose Guarded Delivery IPC

**Files:**
- Create: `src/deliveryIpc.js`
- Modify: `main.js:78-114`
- Modify: `preload.js:5-37`
- Create: `test/deliveryIpc.test.js`

**Interfaces:**
- Consumes `readDeliveries`, `readDelivery`, and `writeDeliveries` from `src/deliveryStore.js`.
- Produces IPC channels `deliveries:list`, `deliveries:open`, and `deliveries:save`.
- Produces preload methods `listDeliveries()`, `openDelivery(deliveryId)`, and `saveDelivery(draft)`.
- The main process assigns IDs and timestamps; the renderer supplies only editable draft fields.

- [ ] **Step 1: Write failing IPC tests**

Create `test/deliveryIpc.test.js` with a fake `ipcMain` handler map and a temporary store file.

```js
test('registers guarded delivery handlers and creates a delivery', () => {
  const { handlers } = setup({ assertTrustedRenderer: () => { checks += 1; } });
  const saved = handlers.get('deliveries:save')({ sender: {} }, draft());

  assert.equal(saved.status, 'draft');
  assert.equal(handlers.get('deliveries:list')({ sender: {} }).length, 1);
  assert.equal(checks, 2);
});
```

Also assert that an untrusted renderer is rejected and that saving a draft with an existing ID preserves `createdAt` while changing `updatedAt`.

- [ ] **Step 2: Verify the IPC tests fail because the module is absent**

Run: `node --test test/deliveryIpc.test.js`

Expected: FAIL with `Cannot find module '../src/deliveryIpc'`.

- [ ] **Step 3: Implement delivery draft construction and IPC**

Create `src/deliveryIpc.js` following `src/historyIpc.js` and inject `deliveriesFilePath` plus `assertTrustedRenderer`.

```js
ipcMain.handle('deliveries:save', (event, draft) => {
  assertTrustedRenderer(event);
  const deliveries = readDeliveries(deliveriesFilePath());
  const existing = deliveries.find((item) => item.id === draft.id);
  const delivery = buildDeliveryFromDraft(draft, existing);
  return writeDeliveries(deliveriesFilePath(), replaceOrAppend(deliveries, delivery)).find((item) => item.id === delivery.id);
});
```

In `main.js`, add `deliveriesFilePath()` under the existing local store path helpers and register the delivery module with the current origin guard. In `preload.js`, expose only the three delivery calls.

- [ ] **Step 4: Verify focused and complete tests**

Run: `node --test test/deliveryIpc.test.js && npm test`

Expected: all delivery IPC tests and the complete suite pass.

### Task 3: Add the Delivery-First Workspace

**Files:**
- Modify: `renderer/index.html:12-124`
- Modify: `renderer/renderer.js:1-187`
- Modify: `renderer/style.css:1-399`
- Modify: `README.md:1-15`

**Interfaces:**
- Consumes `window.api.listDeliveries`, `window.api.openDelivery`, and `window.api.saveDelivery`.
- Produces a default `Entregas` tab with list, empty state, create/edit form, detail view, and timeline.
- Existing `Review`, `Trilhas`, and `Log` tabs remain available and retain their IDs.

- [ ] **Step 1: Add the semantic Delivery view**

Make `Entregas` the first active tab. Add a `view-deliveries` section with a delivery list, new-delivery action, editor, detail header, context fields, status selector, next-action field, blocked-reason field, and event timeline.

Use the draft fields exposed by Task 2: objective, repoPath, branch, baseBranch, status, nextAction, and blockedReason. Do not render Azure, policies, flows, or permissions in this milestone.

- [ ] **Step 2: Implement safe renderer behavior**

Add `loadDeliveries`, `renderDeliveryList`, `openDelivery`, `renderDeliveryDetail`, `renderDeliveryEditor`, and `saveDelivery` using `createElement` and `textContent` for all user-provided values.

```js
async function loadDeliveries() {
  const deliveries = await window.api.listDeliveries();
  renderDeliveryList(deliveries);
}
```

Initialize the list when the renderer loads and refresh it when `Entregas` becomes active. Save through the new preload API and show errors through the existing `setStatus` function.

- [ ] **Step 3: Apply the approved visual language**

Replace the `REVIEW / GUI` branding with `AT / AUTOTESTER`. Introduce a quiet slate workspace, a narrow navigation rail on wide screens, readable UI text through a local system fallback for `Inter`/`Manrope`, and monospaced styles only for branches, paths, hashes, commands, and event timestamps.

Use semantic variables for neutral, success, warning, and danger states. Preserve visible focus indicators, the reduced-motion override, and a single-column mobile layout.

- [ ] **Step 4: Manually verify the renderer**

Run: `npm start`

Expected: Entregas opens first; a Delivery can be created, edited, reopened after restarting the app, and its event timeline remains visible. Review, Trilhas, and Log continue to switch correctly.

- [ ] **Step 5: Document the local workflow**

Update the README introduction and capabilities to state that Entregas persist local feature context, decisions, impediments, next steps, and validation evidence across sessions.
