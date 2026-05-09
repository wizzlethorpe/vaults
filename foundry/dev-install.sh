#!/bin/bash
# dev-install.sh; copy the current source tree into a Foundry VTT modules
# directory so you can test changes without cutting a release.
#
# Usage:
#   ./dev-install.sh                          # uses $FOUNDRY_MODULES_DIR (also read from .env)
#   ./dev-install.sh /path/to/Data/modules    # explicit path
#   FOUNDRY_MODULES_DIR=/path ./dev-install.sh
#
# Set FOUNDRY_MODULES_DIR in .env (gitignored) so your local Foundry path
# doesn't get committed. See .env.example for the template.
#
# On WSL, the user's Windows-portable Foundry path
#   C:\Users\you\FoundryVTT-WindowsPortable-14.x\Data\modules
# maps to
#   /mnt/c/Users/you/FoundryVTT-WindowsPortable-14.x/Data/modules

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

TARGET_BASE="${1:-$FOUNDRY_MODULES_DIR}"

command -v jq >/dev/null 2>&1 || { echo -e "${RED}Error: jq is required${NC}" >&2; exit 1; }

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

MODULE_ID=$(jq -r '.id' module.json)
TARGET="$TARGET_BASE/$MODULE_ID"

echo -e "${GREEN}Installing $MODULE_ID into Foundry${NC}"
echo "  target: $TARGET"

if [ -d "$TARGET" ]; then
  echo -e "${YELLOW}Removing existing $MODULE_ID/${NC}"
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET"
cp module.json "$TARGET/"
cp -r scripts styles lang "$TARGET/"
[ -f LICENSE ]   && cp LICENSE   "$TARGET/" || true
[ -f README.md ] && cp README.md "$TARGET/" || true

echo -e "${GREEN}Done.${NC} Restart Foundry (or use 'Manage Modules → Reload') to pick up changes."
