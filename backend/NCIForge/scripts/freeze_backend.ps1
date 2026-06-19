<#
.SYNOPSIS
    Freeze the KNF Studio Python backend into a self-contained executable
    using PyInstaller and place the output where electron-builder expects it.

.DESCRIPTION
    1. Activates the .venv-nciforge virtual environment
    2. Installs/upgrades pyinstaller inside the venv
    3. Runs pyinstaller with knf_studio.spec
    4. Copies the frozen bundle to frontend/resources/backend/server/

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\freeze_backend.ps1
#>

$ErrorActionPreference = "Stop"

$BackendDir  = Split-Path $PSScriptRoot -Parent          # .../backend/NCIForge
$RepoRoot    = Split-Path (Split-Path $BackendDir -Parent) -Parent
$VenvPython  = Join-Path $BackendDir ".venv-nciforge\Scripts\python.exe"
$OutSrc      = Join-Path $BackendDir "dist\server"
$OutDest     = Join-Path $RepoRoot   "frontend\resources\backend\server"

# ── Validate venv ────────────────────────────────────────────────────────────

if (-not (Test-Path $VenvPython)) {
    Write-Error @"
Virtual environment not found at:
  $VenvPython

Run the backend installer first:
  install-backend.bat
"@
    exit 1
}

Write-Host ""
Write-Host "=== KNF Studio — Freeze Backend ==="
Write-Host "  Python : $VenvPython"
Write-Host "  Spec   : $BackendDir\knf_studio.spec"
Write-Host "  Output : $OutDest"
Write-Host ""

# ── Install / upgrade PyInstaller ─────────────────────────────────────────────

Write-Host "[1/3] Installing PyInstaller..."
& $VenvPython -m pip install --quiet --upgrade pyinstaller
if ($LASTEXITCODE -ne 0) { Write-Error "pip install pyinstaller failed"; exit 1 }

# ── Run PyInstaller ──────────────────────────────────────────────────────────

Write-Host "[2/3] Running PyInstaller..."
Push-Location $BackendDir
try {
    & $VenvPython -m PyInstaller knf_studio.spec --clean --noconfirm
    if ($LASTEXITCODE -ne 0) { Write-Error "PyInstaller failed"; exit 1 }
} finally {
    Pop-Location
}

# ── Copy to frontend/resources ───────────────────────────────────────────────

Write-Host "[3/3] Copying frozen bundle to resources..."

if (-not (Test-Path $OutSrc)) {
    Write-Error "PyInstaller output not found: $OutSrc"
    exit 1
}

if (Test-Path $OutDest) {
    Remove-Item -Recurse -Force $OutDest
}
New-Item -ItemType Directory -Force -Path (Split-Path $OutDest -Parent) | Out-Null
Copy-Item -Recurse -Force $OutSrc $OutDest

# ── Smoke-test the frozen exe ─────────────────────────────────────────────────

$ServerExe = Join-Path $OutDest "server.exe"
if (-not (Test-Path $ServerExe)) {
    Write-Error "server.exe not found in output: $OutDest"
    exit 1
}

Write-Host ""
Write-Host "[OK] Backend frozen successfully"
Write-Host "  server.exe : $ServerExe"
Write-Host "  Size       : $([math]::Round((Get-ChildItem $OutDest -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 1)) MB"
Write-Host ""
