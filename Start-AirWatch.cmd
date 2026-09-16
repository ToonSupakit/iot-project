@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer first.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Please upgrade to Node.js 22 or newer.
  goto failed
)
if not exist node_modules call npm ci
if errorlevel 1 goto failed
if not exist .env call npm run configure
if errorlevel 1 goto failed
call npm start
:failed
pause
