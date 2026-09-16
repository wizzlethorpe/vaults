# Contributing to Wizzlethorpe Vaults

Bug reports, feature requests, and pull requests are all welcome, in the CLI or in the landing demo.

## Filing issues

- Use the GitHub issue tracker on this repo (covers the CLI and landing).
- For **CLI bugs**: include your Node version, OS, the `vaults --version` output, and any console errors. A minimal vault that reproduces the issue is gold.
- For **Foundry import bugs**: include your Foundry version, your [graft](https://github.com/wizzlethorpe/graft) version, the system you're running, and the build report graft prints to the console. What a reader imports is the deploy's `grafts.json`.
- For **landing-page issues**: a screenshot of what you expected vs. what you saw helps a lot.
- For **feature requests**: describe the use case before proposing the implementation.

## Pull requests

1. Fork the repo and create a topic branch.
2. Make your change in one subdirectory if at all possible, `cli/` or `landing/`. Changes across both are fine but should be one logical unit per PR.
3. Run the gates that apply to what you touched:

   | Touched | Run |
   |---|---|
   | `cli/` | `pnpm typecheck && pnpm -r test && pnpm --filter @wizzlethorpe/vaults run build` |
   | `landing/` | `cd landing && vaults build` |

4. Open a PR against `main` with a clear description of what changed and why. Reference any related issue.

## Contributor License Agreement

By submitting a pull request to this repository, you agree your contribution is licensed under the terms of our [Contributor License Agreement](./CLA.md).

The CLA does two things: (1) confirms your contribution comes in under the project's MIT license, and (2) gives the maintainer (Wizzlethorpe Labs) the right to relicense your contribution if the project's license ever changes. You retain copyright on your contribution.

## Code style

The full project conventions live in [CLAUDE.md](./CLAUDE.md). The short version:

**TypeScript (`cli/`)**
- ES modules only. `strict: true`, `noUncheckedIndexedAccess: true`.
- Named exports preferred; default exports only when an external API requires them.
- `async`/`await`, never `.then` chains.
- Files: `kebab-case.ts`. Types: `PascalCase`. Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.

**Across the board**
- No dead code. Remove the callee when you remove the caller.
- No speculative abstraction. Extract a helper at the third caller, not the second.
- No backwards-compat shims for code that hasn't shipped.
- No defensive programming against your own code. Validate at system boundaries only.
- Comments explain *why*, not *what*. Don't restate the code.
- Scope the PR to its task. Flag adjacent issues you noticed but didn't fix.

## Commit messages

Brief and descriptive. The first line is the summary; if you need more detail, leave a blank line and a paragraph below. No conventional-commits prefixes required.

## Releases

Releases are cut from the repo root via `release.sh <X.Y.Z>`, which bumps `cli/package.json`, tags, and publishes the CLI to npm. Don't bump version numbers in PRs; the maintainer handles that at release time.

## Questions?

Open an issue, or reach out on Discord (jrayc28).
