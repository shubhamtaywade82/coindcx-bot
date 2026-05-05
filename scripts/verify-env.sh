#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $name" >&2
    exit 1
  fi
}

echo "==> Verifying required tooling"
require_command node
require_command npm
require_command npx

echo "node: $(node -v)"
echo "npm:  $(npm -v)"
echo "npx:  $(npx --version)"

if command -v docker >/dev/null 2>&1; then
  echo "docker: $(docker --version)"
else
  echo "docker: not found (non-Docker checks will still pass)"
fi

echo ""
echo "==> Running npm ci"
npm ci

echo ""
echo "==> Running test suite"
npm run test

echo ""
echo "==> Running full quality gate"
npm run check

echo ""
echo "==> Verifying ts-node availability"
npx ts-node --version

echo ""
echo "Environment verification complete."
