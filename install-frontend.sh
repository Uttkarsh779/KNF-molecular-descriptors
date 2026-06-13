#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v npm &>/dev/null; then
  echo "npm not found. Install Node.js LTS from https://nodejs.org and re-run."
  exit 1
fi

echo "Installing frontend dependencies..."
npm --prefix "$REPO_ROOT/frontend" install

echo ""
echo "Frontend dependencies installed."
echo "Run './run-frontend.sh' or 'cd frontend && npm run dev' to start the app."
