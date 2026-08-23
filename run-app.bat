@echo off
setlocal

cd /d "%~dp0"

echo.
echo === LinkedIn scraper — run ===
echo.

REM Usage:
REM   run-app.bat
REM   run-app.bat input\sample.csv
REM   run-app.bat input\sample.csv --concurrency=3
REM   run-app.bat input\sample.csv output\results.csv --concurrency=3

set "INPUT=%~1"
if "%INPUT%"=="" set "INPUT=input\sample.csv"

if not exist "%INPUT%" (
  echo ERROR: Input file not found: %INPUT%
  echo.
  echo Usage: run-app.bat [input.csv^|input.xlsx] [output-path] [--concurrency=N]
  echo Example: run-app.bat input\contacts.csv --concurrency=3
  echo.
  pause
  exit /b 1
)

REM Remaining args after the first (input path)
set "EXTRA=%~2 %~3 %~4 %~5"

if exist "app.exe" (
  if exist "browsers\" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"
  echo Running: app.exe %INPUT% %EXTRA%
  app.exe "%INPUT%" %EXTRA%
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Node.js not found. Install Node 20 LTS from https://nodejs.org
    echo Or use the packaged app.exe + browsers\ folder. See WINDOWS-SETUP.md
    pause
    exit /b 1
  )
  echo Running: node app.js %INPUT% %EXTRA%
  node app.js "%INPUT%" %EXTRA%
)

echo.
pause
endlocal
