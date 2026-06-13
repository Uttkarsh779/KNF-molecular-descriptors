@echo off
setlocal

set "ROOT=%~dp0"

if not exist "%ROOT%frontend\node_modules" (
  echo node_modules not found. Run install-frontend.bat first.
  exit /b 1
)

pushd "%ROOT%frontend"
echo Starting frontend (Vite + Electron) on http://localhost:8080 ...
npm run dev
set "EXITCODE=%ERRORLEVEL%"
popd

if not "%EXITCODE%"=="0" (
  echo.
  echo Frontend exited with code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
