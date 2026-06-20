$ErrorActionPreference = 'Stop'

$RepoRoot  = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$ToolsDir  = Join-Path $RepoRoot 'frontend\resources\backend\tools'

if (-not (Test-Path $ToolsDir)) {
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
}

Write-Host '=== Bundling Local External Tools ==='

# ── Copy local xtb ──────────────────────────────────────────────────────────
$LocalXtb = 'C:\ProgramData\xtb\xtb-6.7.1'
$DestXtb  = Join-Path $ToolsDir 'xtb'

if (Test-Path $LocalXtb) {
    Write-Host "Copying local xtb from: $LocalXtb -> $DestXtb"
    if (Test-Path $DestXtb) { Remove-Item -Recurse -Force $DestXtb }
    Copy-Item -Recurse -Force $LocalXtb $DestXtb
    Write-Host '  [OK] xtb copied successfully.'
} else {
    Write-Warning "Local xtb not found at: $LocalXtb"
}

# ── Copy local Open Babel ───────────────────────────────────────────────────
$LocalObabel = 'C:\Program Files\OpenBabel-3.1.1'
$DestObabel  = Join-Path $ToolsDir 'obabel'

if (Test-Path $LocalObabel) {
    Write-Host "Copying local Open Babel from: $LocalObabel -> $DestObabel"
    if (Test-Path $DestObabel) { Remove-Item -Recurse -Force $DestObabel }
    Copy-Item -Recurse -Force $LocalObabel $DestObabel
    Write-Host '  [OK] Open Babel copied successfully.'
} else {
    Write-Warning "Local Open Babel not found at: $LocalObabel"
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== Tool bundling complete ==='
Write-Host 'Expected layout:'
Write-Host "  $ToolsDir"
Write-Host '    xtb\bin\xtb.exe'
Write-Host '    obabel\obabel.exe'
Write-Host ''
Write-Host "Run 'npm run electron:dist' from frontend/ to build the installer."
