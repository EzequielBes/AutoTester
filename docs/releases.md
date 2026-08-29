# Releases

AutoTester uses semantic versioning: `MAJOR.MINOR.PATCH`. The value in
`package.json`, `package-lock.json` and the release tag `vMAJOR.MINOR.PATCH`
must match.

## Release Checklist

1. Update `CHANGELOG.md` with the release date and user-visible changes.
2. Update the version with `npm version <major|minor|patch>`.
3. Run `npm test` locally.
4. Commit the version and changelog changes, then create and push the tag
   created by `npm version`.
5. Publish a GitHub release for that tag. The CI workflow validates the suite
   on Windows and Linux and uploads the NSIS installer and AppImage as workflow
   artifacts.

## Signing And Icons

Windows code signing remains disabled until a certificate and its secure CI
storage are available. The default Electron icon remains in use until approved
Windows and Linux icon assets are supplied.
