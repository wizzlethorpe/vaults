#!/bin/bash
# Release the CLI: bump, tag the monorepo, publish to npm.
#
# Usage:
#   ./release.sh                         # interactive: pick major/minor/patch bump
#   ./release.sh 1.1.0
#   ./release.sh 1.1.0 --skip-cli        # skip cli npm publish
#
# Prereqs:
#   - jq, gh, npm, pnpm on PATH
#   - npm logged in (`npm whoami`) for cli publish
#   - working tree clean

set -e

# Separate an optional version argument from --skip flags so the version can be
# omitted (interactive menu) or given in any position.
NEW_VERSION=""
SKIP_CLI=0
for arg in "$@"; do
  case "$arg" in
    --skip-cli)      SKIP_CLI=1 ;;
    --*) echo "Unknown flag: $arg"; exit 1 ;;
    *)
      if [[ -n "$NEW_VERSION" ]]; then
        echo "Error: version given twice ($NEW_VERSION and $arg)"; exit 1
      fi
      NEW_VERSION="$arg"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

command -v jq   >/dev/null || { echo "Error: jq required"; exit 1; }
command -v gh   >/dev/null || { echo "Error: gh required"; exit 1; }
command -v pnpm >/dev/null || { echo "Error: pnpm required"; exit 1; }
command -v npm  >/dev/null || { echo "Error: npm required"; exit 1; }

CURRENT_CLI=$(jq -r '.version' cli/package.json)

# No version on the command line: offer a bump menu computed from the cli version.
if [[ -z "$NEW_VERSION" ]]; then
  BASE="${CURRENT_CLI%%-*}"   # drop any prerelease suffix before computing bumps
  IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE"
  PATCH_V="$MAJOR.$MINOR.$((PATCH + 1))"
  MINOR_V="$MAJOR.$((MINOR + 1)).0"
  MAJOR_V="$((MAJOR + 1)).0.0"
  echo "Current version: $CURRENT_CLI"
  echo "Select the new version:"
  echo "  1) patch  -> $PATCH_V"
  echo "  2) minor  -> $MINOR_V"
  echo "  3) major  -> $MAJOR_V"
  echo "  4) custom"
  read -p "Choice [1-4]: " -r CHOICE
  case "$CHOICE" in
    1) NEW_VERSION="$PATCH_V" ;;
    2) NEW_VERSION="$MINOR_V" ;;
    3) NEW_VERSION="$MAJOR_V" ;;
    4) read -p "Enter version: " -r NEW_VERSION ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  echo "Error: version must be semver (e.g. 1.0.0 or 1.0.0-rc.1), got: $NEW_VERSION"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

echo "Current versions:"
echo "  cli:              $CURRENT_CLI"
echo "Releasing as: $NEW_VERSION"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
[[ "$REPLY" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# Gate the release on the suite. Nothing else does: there is no CI, so
# without this a broken build reaches npm and the Foundry package listing,
# and the CLI's published bundle is what every deployed vault runs.
echo ""
echo "=== Typecheck + tests ==="
pnpm typecheck
pnpm test
echo "All green."

# Bump cli/package.json
jq --arg v "$NEW_VERSION" '.version = $v' cli/package.json > cli/package.json.tmp
mv cli/package.json.tmp cli/package.json


# Single commit + tag for the monorepo. If versions were already at the
# target (user pre-bumped, or re-running after a partial failure), skip
# the commit but still tag the current HEAD.
git add cli/package.json
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

# Push main + tag before publishing, so the npm tarball and the tag agree.
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

echo ""
echo "Released v$NEW_VERSION."
echo "  npm:     https://www.npmjs.com/package/@wizzlethorpe/vaults/v/$NEW_VERSION"
echo "  github:  https://github.com/wizzlethorpe/vaults/releases/tag/v$NEW_VERSION"
echo ""
echo "Landing deploy is separate (no version coupling): cd landing && vaults push"
