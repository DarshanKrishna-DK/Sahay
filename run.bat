@echo off
REM ===========================================================================
REM  Sahay - one-shot launcher
REM
REM  Takes a clean checkout to a running app: checks Node, installs deps,
REM  creates .env from the template, verifies all three connectors against the
REM  live APIs, then starts the server and opens the browser.
REM
REM  Usage:   run.bat            full setup + start
REM           run.bat doctor     only run the connector pre-flight
REM           run.bat reset      wipe the local database and start fresh
REM ===========================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   SAHAY  -  agentic web-watching for Indian SMEs
echo   =============================================
echo.

REM --------------------------------------------------------------- Node ---
where node >nul 2>nul
if errorlevel 1 (
    echo   [X] Node.js is not installed or not on PATH.
    echo       Install Node 22.5 or newer from https://nodejs.org  and run this again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
for /f "tokens=2 delims=." %%v in ('node -p "process.versions.node"') do set NODEMINOR=%%v
node -p "process.versions.node" > "%TEMP%\sahay_node_ver.txt"
set /p NODEVER=<"%TEMP%\sahay_node_ver.txt"
del "%TEMP%\sahay_node_ver.txt" >nul 2>nul

if %NODEMAJOR% LSS 22 (
    echo   [X] Node %NODEVER% is too old. Sahay needs Node 22.5+ for its built-in
    echo       SQLite database ^(node:sqlite^). Please upgrade Node and retry.
    echo.
    pause
    exit /b 1
)
echo   [1/5] Node %NODEVER% OK

REM ---------------------------------------------------------------- reset ---
if /i "%~1"=="reset" (
    if exist "data" (
        rmdir /s /q "data"
        echo         local database wiped
    )
)

REM ------------------------------------------------------------------ env ---
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo   [2/5] Created .env from .env.example
        echo.
        echo         ^>^> Open .env and paste your ANAKIN_API_KEY, GROQ_API_KEY and
        echo            SARVAM_API_KEY, then run this script again.
        echo.
        notepad ".env"
        pause
        exit /b 1
    ) else (
        echo   [X] Neither .env nor .env.example was found.
        pause
        exit /b 1
    )
) else (
    echo   [2/5] .env present
)

REM --------------------------------------------------------------- deps ---
if not exist "node_modules" (
    echo   [3/5] Installing dependencies ^(first run, this takes a minute^)...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [X] npm install failed. Check your internet connection and retry.
        pause
        exit /b 1
    )
) else (
    echo   [3/5] Dependencies present
)

REM ------------------------------------------------------------- doctor ---
echo   [4/5] Verifying Anakin, Groq and Sarvam against the live APIs...
call node scripts\doctor.js
if errorlevel 1 (
    echo.
    echo   [X] Pre-flight failed. Sahay deliberately has no sample-data fallback,
    echo       so fix the connector errors above before starting.
    echo.
    pause
    exit /b 1
)

if /i "%~1"=="doctor" (
    echo   Pre-flight only - not starting the server.
    pause
    exit /b 0
)

REM ---------------------------------------------------------------- run ---
echo   [5/5] Starting Sahay on http://localhost:3000
echo.
echo         Press Ctrl+C in this window to stop.
echo.

start "" http://localhost:3000
call node server.js

endlocal
