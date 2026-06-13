param(
    [switch]$InstallNodeIfMissing
)

$ErrorActionPreference = "Stop"

function Get-NpmCommand {
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $paths = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
    )
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) { return $path }
    }
    return $null
}

$RepoRoot = Split-Path $PSScriptRoot -Parent
$FrontendRoot = Join-Path $RepoRoot "frontend"
$Npm = Get-NpmCommand

if (-not $Npm) {
    if ($InstallNodeIfMissing -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "Installing Node.js LTS via winget..."
        & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
        $Npm = Get-NpmCommand
    }
}

if (-not $Npm) {
    throw "npm was not found. Install Node.js LTS from https://nodejs.org or pass -InstallNodeIfMissing."
}

Push-Location $FrontendRoot
try {
    Write-Host "Installing frontend dependencies..."
    & $Npm install
    Write-Host ""
    Write-Host "Frontend dependencies installed."
    Write-Host "Run 'run-frontend.bat' or 'cd frontend && npm run dev' to start the app."
} finally {
    Pop-Location
}
