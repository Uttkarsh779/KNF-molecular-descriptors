/**
 * freeze-backend.mjs
 * Called by `npm run electron:dist` before electron-builder runs.
 * Shells out to the PowerShell freeze script and validates the output.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..', '..');
const freezePs1 = path.join(repoRoot, 'backend', 'NCIForge', 'scripts', 'freeze_backend.ps1');
const serverExe = path.join(__dirname, '..', 'resources', 'backend', 'server', 'server.exe');

// ── Validate freeze script exists ────────────────────────────────────────────
if (!fs.existsSync(freezePs1)) {
  console.error(`[freeze-backend] Script not found: ${freezePs1}`);
  process.exit(1);
}

console.log('[freeze-backend] Starting PyInstaller freeze...');
console.log(`[freeze-backend] Script: ${freezePs1}`);

// ── Run PowerShell freeze script ─────────────────────────────────────────────
const result = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', freezePs1],
  { stdio: 'inherit', cwd: repoRoot },
);

if (result.status !== 0) {
  console.error(`[freeze-backend] freeze_backend.ps1 failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

// ── Validate output ───────────────────────────────────────────────────────────
if (!fs.existsSync(serverExe)) {
  console.error(`[freeze-backend] Expected server.exe not found at:\n  ${serverExe}`);
  console.error('[freeze-backend] Check PyInstaller output above for errors.');
  process.exit(1);
}

const sizeBytes = fs.readdirSync(path.dirname(serverExe))
  .reduce((sum, f) => {
    try { return sum + fs.statSync(path.join(path.dirname(serverExe), f)).size; } catch { return sum; }
  }, 0);

console.log(`[freeze-backend] ✓ server.exe ready (${(sizeBytes / 1024 / 1024).toFixed(0)} MB approx)`);
