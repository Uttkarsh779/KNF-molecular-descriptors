@echo off
setlocal

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\install-frontend.ps1"

if not exist "%SCRIPT%" (
  echo Missing script: %SCRIPT%
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -InstallNodeIfMissing
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo Frontend installation failed with exit code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
