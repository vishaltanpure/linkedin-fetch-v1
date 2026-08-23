@echo off
setlocal

cd /d "%~dp0"

echo.
echo === LinkedIn scraper — login ===
echo A browser window will open. Sign in to LinkedIn, then wait until the feed loads.
echo Session will be saved to session\linkedin.json
echo.

if exist "app.exe" (
  if exist "browsers\" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"
  app.exe --login
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Node.js not found. Install Node 20 LTS from https://nodejs.org
    echo Or use the packaged app.exe + browsers\ folder. See WINDOWS-SETUP.md
    pause
    exit /b 1
  )
  node app.js --login
)

echo.
pause
endlocal
