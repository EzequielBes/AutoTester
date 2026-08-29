# Changelog

All notable changes to AutoTester are documented in this file.

The project uses semantic versioning. Release tags use the `vMAJOR.MINOR.PATCH`
format and match the `version` in `package.json`.

## [1.0.0] - 2026-08-29

### Added

- Local, atomic and versioned delivery records with policies, validation-flow snapshots, scopes and auditable scope exceptions.
- Azure DevOps metadata synchronization through the authenticated Claude CLI MCP, without storing credentials.
- Delivery-chain suggestions requiring explicit human confirmation.
- Claude and command validation phases, coverage gates, cancellation and local audit history.
- Native Windows NSIS and Linux AppImage builds, with CI validation on Windows and Linux.

### Security

- Trusted-renderer IPC, isolated renderer, blocked navigation and bounded external-process output.
- Azure metadata allowlist and guarded schema migrations for persisted local state.
