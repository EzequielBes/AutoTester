# review-gui

A local Electron GUI for running code review over a git repo via the `claude` CLI in headless mode. Pick a branch, a set of files, a review skill, and an intensity level; each finding the model returns can be individually accepted (applied to disk) or rejected — nothing is written to disk without a per-finding decision.

## Requirements

- The `claude` CLI must be installed and available on `PATH`, and already authenticated via a Claude Pro/Max subscription login (`claude` interactive login). This app never reads or sets `ANTHROPIC_API_KEY` — headless calls are billed against the subscription, not an API key, by design.
- Git must be on `PATH`.

## Running

```
npm install
npm start
```

## Tests

```
npm test
```

## Notes

Review file content is piped to the `claude` CLI via stdin rather than passed as a command-line argument, to stay under Windows' ~32767-character command-line length limit for large file selections.
