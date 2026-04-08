#!/usr/bin/env bash
set -euo pipefail

REPO="denniszhao/termi"
INSTALL_DIR="${TERMI_INSTALL_DIR:-$HOME/.termi}"
BIN_DIR="${TERMI_BIN_DIR:-$HOME/.local/bin}"

echo ""
echo "  🍉 Installing Termi..."
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "  Error: Node.js is required (v20+)."
  echo "  Install from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  Error: Node.js v20+ is required. You have $(node --version)."
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "  Error: npm is required."
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "  Error: git is required."
  exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  echo "  Cloning termi..."
  git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo "  Installing dependencies..."
npm install --loglevel=error 2>&1

# Build
echo "  Building..."
npm run build --silent 2>&1
chmod +x dist/cli.mjs

# Create symlink
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/cli.mjs" "$BIN_DIR/termi"

echo ""
echo "  🍉 Termi installed!"
echo ""

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo "  Add this to your shell profile:"
  echo "    export PATH=\"$BIN_DIR:\$PATH\""
  echo ""
fi

echo "  Run 'termi' to start."
echo ""
