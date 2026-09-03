@echo off
setlocal
cd /d "%~dp0"

echo.
echo === LinkedIn-Discovery — login ===
echo Uses the parent app session (../session/linkedin.json)
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node 20 LTS from https://nodejs.org
  pause
  exit /b 1
)

node discovery-app.js --login
echo.
pause
endlocal
