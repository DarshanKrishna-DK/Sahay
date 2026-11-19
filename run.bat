@echo off
REM ===========================================================================
REM  Sahay - start the demo on this laptop
REM
REM  Starts the server on http://127.0.0.1:3000 and shares it publicly through
REM  Tailscale Funnel (the public link stays the same between restarts).
REM  Set PUBLIC_URL in .env to that https link: Agora's voice agent calls Sahay's
REM  tools through it.
REM
REM  Usage:   run.bat          start (window stays open; Ctrl+C stops the server)
REM ===========================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo   [X] Node.js 22.5+ is not on PATH. & pause & exit /b 1)
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo   [!] Created .env from .env.example. Fill in the keys, then run this again.
  notepad ".env"
  exit /b 1
)
if not exist "node_modules" call npm install --no-audit --no-fund || (echo   [X] npm install failed. & pause & exit /b 1)

where tailscale >nul 2>nul && (
  tailscale funnel --bg 3000 >nul 2>nul && echo   Public link: & tailscale funnel status
) || echo   [!] Tailscale not found: only http://localhost:3000 will work.

REM Funnel's proxy (tailscaled) sets X-Forwarded-For to the caller's address: trust it from loopback
REM only, for rate limits and PIN lockouts (src/client-address.js). cloudflared instead: TRUST_CF_CONNECTING_IP=1.
set TRUST_PROXY=tailscale
echo   Starting Sahay on http://localhost:3000  (Ctrl+C to stop)
node server.js
endlocal
