#!/bin/bash
# dev-install.sh; copy the current source tree into a Foundry VTT modules
# directory so you can test changes without cutting a release. Installs
# either into a local Foundry, or onto the hosted server over WebDAV.
#
# Usage:
#   ./dev-install.sh                          # uses $FOUNDRY_MODULES_DIR (also read from .env)
#   ./dev-install.sh /path/to/Data/modules    # explicit path
#   ./dev-install.sh --remote                 # hosted server, via `molten`
#   FOUNDRY_MODULES_DIR=/path ./dev-install.sh
#
# Set FOUNDRY_MODULES_DIR in .env (gitignored) so your local Foundry path
# doesn't get committed. See .env.example for the template.
#
# On WSL, the user's Windows-portable Foundry path
#   C:\Users\you\FoundryVTT-WindowsPortable-14.x\Data\modules
# maps to
#   /mnt/c/Users/you/FoundryVTT-WindowsPortable-14.x/Data/modules
#
# Remote uploads to /Data/modules/<id> on the Molten host using `molten`,
# which takes its credentials from moltenhosting/.env. Unlike the local path
# this never deletes: a file dropped from the module stays on the server
# until cleared by hand. This module ships no compendium packs, so there is
# no LevelDB to write under a running world; a browser reload is enough.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Pick up FOUNDRY_MODULES_DIR (and any other dev-only env) from .env if it
# exists. set -a auto-exports so the assignments propagate to the rest of
# this script without us re-exporting each one by name.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

REMOTE=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --remote|--server) REMOTE=1 ;;
    -*) echo -e "${RED}Error: unknown option '$arg' (try --remote)${NC}" >&2; exit 1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo -e "${RED}Error: jq is required${NC}" >&2; exit 1; }

MODULE_ID=$(jq -r '.id' module.json)

# The one definition of what actually ships, used by both modes.
stage_module() {
  local dest="$1"
  mkdir -p "$dest"
  cp module.json "$dest/"
  cp -r scripts lang "$dest/"
  [ -d styles ] && cp -r styles "$dest/" || true
  [ -f LICENSE ]   && cp LICENSE   "$dest/" || true
  [ -f README.md ] && cp README.md "$dest/" || true
}

if [ "$REMOTE" -eq 1 ]; then
  command -v molten >/dev/null 2>&1 || {
    echo -e "${RED}Error: molten not on PATH (cd moltenhosting && uv tool install .)${NC}" >&2; exit 1; }

  VERSION=$(jq -r '.version' module.json)
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  stage_module "$STAGE/$MODULE_ID"

  # Between releases the repo's module.json points at /latest/, which Foundry
  # can latch onto and then sit on a stale cached version. Pin the URLs to the
  # version being installed so the server reads as up to date and won't offer
  # an update that would quietly overwrite this build.
  jq --arg v "$VERSION" '
      .manifest = "https://github.com/wizzlethorpe/vaults/releases/download/v\($v)/module.json"
    | .download = "https://github.com/wizzlethorpe/vaults/releases/download/v\($v)/module.zip"
  ' module.json > "$STAGE/$MODULE_ID/module.json"

  echo -e "${GREEN}Installing $MODULE_ID v$VERSION onto the hosted server${NC}"
  echo "  target: /Data/modules/$MODULE_ID"
  echo -e "${YELLOW}Uploads never delete; files dropped from the module linger until removed by hand.${NC}"
  molten put -r -f "$STAGE/$MODULE_ID" "modules/$MODULE_ID"
  echo -e "${GREEN}Done.${NC} Reload the browser (F5) to pick up changes."
  exit 0
fi

TARGET_BASE="${POSITIONAL[0]:-$FOUNDRY_MODULES_DIR}"

if [ -z "$TARGET_BASE" ]; then
  echo -e "${RED}Error: no target directory configured.${NC}" >&2
  echo "" >&2
  echo "Set FOUNDRY_MODULES_DIR in .env (copy .env.example), export it," >&2
  echo "or pass the path as an argument." >&2
  exit 1
fi

if [ ! -d "$TARGET_BASE" ]; then
  echo -e "${RED}Error: target directory does not exist:${NC}" >&2
  echo "  $TARGET_BASE" >&2
  echo "" >&2
  echo "Set FOUNDRY_MODULES_DIR or pass the path as an argument." >&2
  exit 1
fi

TARGET="$TARGET_BASE/$MODULE_ID"

echo -e "${GREEN}Installing $MODULE_ID into Foundry${NC}"
echo "  target: $TARGET"

if [ -d "$TARGET" ]; then
  echo -e "${YELLOW}Removing existing $MODULE_ID/${NC}"
  rm -rf "$TARGET"
fi

stage_module "$TARGET"

echo -e "${GREEN}Done.${NC} Restart Foundry (or use 'Manage Modules → Reload') to pick up changes."
