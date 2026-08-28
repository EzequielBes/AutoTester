# Policies, Flows, and Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Delivery preserve the policy, validation flow, agents, and skills used to validate it.

**Architecture:** Store reusable local policies separately, discover a bounded set of repository rule documents, and copy selected policy/track/agent/skill definitions into an immutable Delivery flow snapshot. Existing validation tracks remain the flow engine.

**Tech Stack:** Electron 44, Node.js 22, Node built-in test runner, HTML, CSS, JavaScript.

**Spec:** `docs/superpowers/specs/2026-08-28-entregas-design.md`

## Global Constraints

- Keep all state local to Electron `userData`.
- Use guarded IPC and no new dependencies.
- Discovery reads an allowlist of repository documentation only.
- A Delivery snapshot must not change when a policy, agent, or skill is edited later.
- Exclude Azure, automatic code writing, and scope exceptions.

---

### Task 1: Persist and Discover Project Rules

**Files:**
- Create: `src/projectPolicyStore.js`
- Create: `src/repositoryRuleDiscovery.js`
- Create: `test/projectPolicyStore.test.js`
- Create: `test/repositoryRuleDiscovery.test.js`

- [ ] Write failing tests for versioned policy round trips, corrupted storage, bounded rule text, and discovery of `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `CONTRIBUTING.md`, and PR templates only.
- [ ] Run: `node --test test/projectPolicyStore.test.js test/repositoryRuleDiscovery.test.js`; expected: missing-module failures.
- [ ] Implement atomic local policy storage and discovery through existing Git helpers, returning `{ path, excerpt }` records with bounded excerpts.
- [ ] Run: `npm test`; expected: full suite passes.

### Task 2: Snapshot Policies and Flows in Deliveries

**Files:**
- Modify: `src/deliveryStore.js`
- Modify: `src/deliveryIpc.js`
- Modify: `test/deliveryStore.test.js`
- Modify: `test/deliveryIpc.test.js`

- [ ] Write failing tests for v1-to-v2 Delivery migration and immutable `flowSnapshot` data containing selected rules, track phases, agent definitions, and skill definitions.
- [ ] Run focused Delivery tests; expected: snapshot behavior fails before implementation.
- [ ] Upgrade the store schema and add guarded IPC that builds snapshots in the main process from selected local policy, track, profile, and skill records.
- [ ] Run: `npm test`; expected: full suite passes.

### Task 3: Connect Delivery Flow Execution

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `src/validationRunner.js`
- Modify: `test/validationRunner.test.js`

- [ ] Write failing tests for Delivery-linked execution rejecting a mismatched repository or branch and using saved snapshots rather than live profiles or skills.
- [ ] Run focused validation-runner tests; expected: new Delivery-linked cases fail.
- [ ] Add guarded policy/discovery IPC and an optional `deliveryId` to existing track execution; resolve and validate the stored snapshot before running phases.
- [ ] Run: `npm test`; expected: full suite passes.

### Task 4: Add Policy and Flow Controls to Deliveries

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`
- Modify: `renderer/style.css`
- Modify: `README.md`

- [ ] Add compact policy discovery, rule selection, track selection, snapshot summary, and Delivery-linked run controls to the Delivery detail.
- [ ] Use safe DOM construction and preserve existing Review, Trilhas, and Log behavior.
- [ ] Manually run `npm start` to verify that a Delivery can discover rules, save a flow snapshot, and run a linked track.
- [ ] Run: `npm test`; expected: full suite passes.
