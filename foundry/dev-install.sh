#!/bin/bash
# dev-install.sh — copy the current source tree into a Foundry VTT modules
# directory so you can test changes without cutting a release.
#
# Usage:
#   ./dev-install.sh                          # uses $FOUNDRY_MODULES_DIR
#   ./dev-install.sh /path/to/Data/modules    # explicit path
#   FOUNDRY_MODULES_DIR=/path ./dev-install.sh
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

DEFAULT_DIR="${FOUNDRY_MODULES_DIR:-/mnt/c/Users/jared/FoundryVTT-WindowsPortable-14.359/Data/modules}"
TARGET_BASE="${1:-$DEFAULT_DIR}"

command -v jq >/dev/null 2>&1 || { echo -e "${RED}Error: jq is required${NC}" >&2; exit 1; }

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
cp -r scripts styles lang vendor "$TARGET/"
[ -f LICENSE ]   && cp LICENSE   "$TARGET/" || true
[ -f README.md ] && cp README.md "$TARGET/" || true

echo -e "${GREEN}Done.${NC} Restart Foundry (or use 'Manage Modules → Reload') to pick up changes."
