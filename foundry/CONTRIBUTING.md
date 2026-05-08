# Contributing to the Wizzlethorpe Vaults Foundry Module

Thanks for your interest! Bug reports, feature requests, and pull requests are all welcome.

## Filing issues

- Use the GitHub issue tracker.
- For bugs, include your Foundry version (V13 or V14), the system you're running, the vault URL or a redacted manifest snippet, and any console errors.
- For feature requests, describe the use case before proposing the implementation.

## Pull requests

1. Fork the repo and create a topic branch.
2. Use `dev-install.sh` to symlink your fork into a local Foundry world for testing. Manually verify the change against a real vault before opening the PR — there's no automated test suite for the module.
3. Open a PR against `main` with a clear description of what changed and why. Reference any related issue.
4. Note any Foundry-version-specific behavior (V13 vs V14) you observed.

## Contributor License Agreement

By submitting a pull request to this repository, you agree your contribution is licensed under the terms of our [Contributor License Agreement](./CLA.md).

The CLA does two things: (1) confirms your contribution comes in under the project's MIT license, and (2) gives the maintainer (Wizzlethorpe Labs) the right to relicense your contribution if the project's license ever changes. You retain copyright on your contribution.

## Code style

- ES modules (`.mjs`) only. No bundler, no transpile step. Foundry loads `scripts/main.mjs` as the entry point.
- Named exports preferred; default exports only when an external API requires them.
- `async`/`await`, never `.then` chains.
- Files: `kebab-case.mjs`. Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- Foundry-side state lives in world-scoped settings (`vaults.vaults` array). See `scripts/settings.mjs` for the canonical schema and migration logic.
- DOM rewriting happens in `scripts/links.mjs` in a single `DOMParser` round-trip per page; new transforms generally belong there as a new pass rather than a new module.

## Commit messages

Brief and descriptive. The first line is the summary; if you need more detail, leave a blank line and a paragraph below. No conventional-commits prefixes required.

## Releases

Releases are cut via `release.sh` (which bumps `module.json` version, builds the zip, creates the GitHub release, and uploads the manifest). Don't bump version numbers in PRs; the maintainer handles that at release time.

## Questions?

Open an issue, or reach out on Discord (jrayc28).
