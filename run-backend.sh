#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$REPO_ROOT/frontend/node_modules" ]; then
  echo "node_modules not found. Run ./install-frontend.sh first."
  exit 1
fi

echo "Starting backend server on http://127.0.0.1:8765 ..."
cd "$REPO_ROOT/frontend"
npm run dev:backend
