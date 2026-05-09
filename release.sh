#!/bin/bash
# Unified release across cli + foundry. Bumps both to the same version,
# tags the monorepo, then runs each subproject's release pipeline.
#
# Usage:
#   ./release.sh 1.1.0
#   ./release.sh 1.1.0 --skip-cli       # skip npm publish
#   ./release.sh 1.1.0 --skip-foundry   # skip Foundry release.sh
#
# Prereqs:
#   - jq, gh, npm, pnpm on PATH
#   - npm logged in (`npm whoami`) for cli publish
#   - gh authenticated (`gh auth login`) for foundry release
#   - working tree clean

set -e

NEW_VERSION="$1"
shift || true
if [[ -z "$NEW_VERSION" ]]; then
  echo "Usage: $0 <version> [--skip-cli] [--skip-foundry]"
  exit 1
fi
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  echo "Error: version must be semver (e.g. 1.0.0 or 1.0.0-rc.1), got: $NEW_VERSION"
  exit 1
fi

SKIP_CLI=0
SKIP_FOUNDRY=0
for arg in "$@"; do
  case "$arg" in
    --skip-cli)     SKIP_CLI=1 ;;
    --skip-foundry) SKIP_FOUNDRY=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

command -v jq   >/dev/null || { echo "Error: jq required"; exit 1; }
command -v gh   >/dev/null || { echo "Error: gh required"; exit 1; }
command -v pnpm >/dev/null || { echo "Error: pnpm required"; exit 1; }
command -v npm  >/dev/null || { echo "Error: npm required"; exit 1; }

CURRENT_CLI=$(jq -r '.version' cli/package.json)
CURRENT_FOUNDRY=$(jq -r '.version' foundry/module.json)
echo "Current versions:"
echo "  cli:     $CURRENT_CLI"
echo "  foundry: $CURRENT_FOUNDRY"
echo "Releasing as: $NEW_VERSION"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
[[ "$REPLY" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# Bump cli/package.json
jq --arg v "$NEW_VERSION" '.version = $v' cli/package.json > cli/package.json.tmp
mv cli/package.json.tmp cli/package.json

# Bump foundry/module.json (foundry's own release.sh would do this too,
# but bumping here keeps the monorepo commit consistent)
jq --arg v "$NEW_VERSION" '.version = $v' foundry/module.json > foundry/module.json.tmp
mv foundry/module.json.tmp foundry/module.json

# Single commit + tag for the monorepo. If versions were already at the
# target (user pre-bumped, or re-running after a partial failure), skip
# the commit but still tag the current HEAD.
git add cli/package.json foundry/module.json
if git diff --cached --quiet; then
  echo "Versions already at $NEW_VERSION; skipping release commit."
else
  git commit -m "Release v$NEW_VERSION"
fi
if git rev-parse "v$NEW_VERSION" >/dev/null 2>&1; then
  echo "Tag v$NEW_VERSION already exists; reusing it."
else
  git tag -a "v$NEW_VERSION" -m "v$NEW_VERSION"
fi

# Push main + tag BEFORE subproject release pipelines. foundry/release.sh
# does `gh release create v$NEW_VERSION` which would create the tag on the
# remote pointed at the remote default-branch HEAD if the tag isn't already
# pushed — that would mismatch the local commit and cause confusion.
echo ""
echo "=== Pushing main + tag to origin ==="
git push origin main "v$NEW_VERSION"

# Per-subproject release pipelines
if [[ $SKIP_CLI -eq 0 ]]; then
  echo ""
  echo "=== Publishing CLI to npm ==="
  pnpm --filter @wizzlethorpe/vaults run build
  pnpm --filter @wizzlethorpe/vaults publish --access public --no-git-checks
fi

if [[ $SKIP_FOUNDRY -eq 0 ]]; then
  echo ""
  echo "=== Releasing Foundry module ==="
  # foundry/release.sh swaps module.json's URLs to /v$NEW_VERSION/ for the
  # build, ships the release, then resets the working copy to /latest/. The
  # reset leaves foundry/module.json dirty in the working tree afterwards;
  # commit + push that as a follow-up so dev installs see the floating
  # /latest/ URLs.
  (cd foundry && ./release.sh "$NEW_VERSION")
  if ! git diff --quiet foundry/module.json; then
    git add foundry/module.json
    git commit -m "Reset foundry module.json URLs to /latest/ after v$NEW_VERSION release"
    git push origin main
  fi
fi

echo ""
echo "Released v$NEW_VERSION."
echo "  npm:     https://www.npmjs.com/package/@wizzlethorpe/vaults/v/$NEW_VERSION"
echo "  github:  https://github.com/wizzlethorpe/vaults/releases/tag/v$NEW_VERSION"
echo ""
echo "Landing deploy is separate (no version coupling): cd landing && vaults push"
