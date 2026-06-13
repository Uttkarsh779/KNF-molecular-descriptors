param(
    [switch]$InstallNodeIfMissing
)

$ErrorActionPreference = "Stop"

function Get-NpmCommand {
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $paths = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
    )

    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    return $null
}

function Install-NodeIfNeeded {
    if (-not $InstallNodeIfMissing) {
        return
    }

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Installing Node.js LTS via winget..."
        & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    }
}

$RepoRoot = Split-Path $PSScriptRoot -Parent
$Npm = Get-NpmCommand

if (-not $Npm) {
    Install-NodeIfNeeded
    $Npm = Get-NpmCommand
}

if (-not $Npm) {
    throw "npm was not found. Install Node.js LTS or pass -InstallNodeIfMissing on a machine with winget."
}

Push-Location (Join-Path $RepoRoot "frontend")
try {
    & $Npm install
} finally {
    Pop-Location
}
& (Join-Path $RepoRoot "backend\NCIForge\scripts\install_nciforge.ps1")
