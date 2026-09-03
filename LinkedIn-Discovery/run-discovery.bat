@echo off
setlocal
cd /d "%~dp0"

echo.
echo === LinkedIn-Discovery — run ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node 20 LTS from https://nodejs.org
  pause
  exit /b 1
)

if "%~1"=="" (
  echo Usage:
  echo   run-discovery.bat --query "Software Engineers in San Francisco" --count 50
  echo   run-discovery.bat --query "CTOs in California" --count 25 --existing input\existing.csv
  echo.
  pause
  exit /b 1
)

node discovery-app.js %*
echo.
pause
endlocal
