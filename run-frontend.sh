#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$REPO_ROOT/frontend/node_modules" ]; then
  echo "node_modules not found. Run ./install-frontend.sh first."
  exit 1
fi

echo "Starting frontend (Vite + Electron) on http://localhost:8080 ..."
cd "$REPO_ROOT/frontend"
npm run dev
