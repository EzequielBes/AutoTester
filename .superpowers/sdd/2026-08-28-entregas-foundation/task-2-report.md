# Task 2 Report: Guarded Delivery IPC

## Scope

Implemented local-only delivery IPC. No Azure integration, policy handling, automatic writing, or renderer UI changes were added.

## Implementation

- Added `src/deliveryIpc.js`, which registers these origin-guarded handlers:
  - `deliveries:list`
  - `deliveries:open`
  - `deliveries:save`
- The handlers use Task 1's `readDeliveries`, `readDelivery`, and `writeDeliveries` APIs.
- Save operations construct persisted deliveries in the main process:
  - New deliveries receive a generated UUID, current timestamps, `draft` status, and no events.
  - Updates select the persisted delivery by the supplied ID, retain its ID, `createdAt`, and events, and assign a fresh `updatedAt`.
  - Renderer-provided IDs and timestamps are never persisted for new deliveries; renderer-provided timestamps are ignored for updates.
- Registered the module in `main.js` with the existing `assertTrustedRenderer` guard and a local `deliveries.json` user-data path.
- Exposed only `listDeliveries()`, `openDelivery(deliveryId)`, and `saveDelivery(draft)` through `preload.js`.

## TDD Evidence

1. Added `test/deliveryIpc.test.js` before `src/deliveryIpc.js` existed.
2. Ran `node --test test/deliveryIpc.test.js`.
3. Observed the expected failure: `Cannot find module '../src/deliveryIpc'`.
4. Added the minimal delivery IPC implementation and Electron wiring.
5. Re-ran focused tests: 3 passing, 0 failing.

## Test Coverage

- Trusted list/save calls invoke the origin guard and persist a newly created draft delivery.
- New deliveries ignore renderer-owned ID and timestamp values.
- Untrusted renderer calls are rejected by the configured guard.
- Updates retain the existing delivery ID and `createdAt`, replace editable fields, and ignore a renderer-provided `updatedAt`.

## Verification

- `node --test test/deliveryIpc.test.js`: 3 passed, 0 failed.
- `npm test`: 127 passed, 0 failed.
- `git diff --check`: no whitespace errors.

## Concerns

- This task intentionally keeps status and event lifecycle management in the main process as initial `draft` state. Later milestone work should add explicit, validated transitions rather than accepting those fields from renderer drafts.

## Fix Round 1: Monotonic Update Timestamps

- Root cause: an update used the wall-clock ISO timestamp directly, which can equal the stored `updatedAt` when both writes occur in one millisecond.
- Added a regression test with a stored future timestamp. Before the fix, `node --test test/deliveryIpc.test.js` failed because the persisted timestamp was not strictly later.
- Updates now use the current time when it is later than the stored timestamp; otherwise they persist one millisecond after the stored timestamp.
- Post-fix focused verification: `node --test test/deliveryIpc.test.js`: 4 passed, 0 failed.
