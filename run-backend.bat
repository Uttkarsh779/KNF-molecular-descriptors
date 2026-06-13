@echo off
setlocal

set "ROOT=%~dp0"

if not exist "%ROOT%frontend\node_modules" (
  echo node_modules not found. Run install-frontend.bat first.
  exit /b 1
)

pushd "%ROOT%frontend"
echo Starting backend server on http://127.0.0.1:8765 ...
npm run dev:backend
set "EXITCODE=%ERRORLEVEL%"
popd

if not "%EXITCODE%"=="0" (
  echo.
  echo Backend exited with code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
