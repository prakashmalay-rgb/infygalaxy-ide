@echo off
echo.
echo  ==========================================
echo   Infygalaxy IDE — Setup
echo  ==========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  ERROR: Node.js not found.
  echo  Please install Node.js from https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  Node.js %NODE_VER% found.

:: Install dependencies
echo.
echo  Installing dependencies...
call npm install
if %errorlevel% neq 0 (
  echo  ERROR: npm install failed.
  pause
  exit /b 1
)

echo.
echo  ==========================================
echo   Setup complete!
echo  ==========================================
echo.
echo  To run in development:
echo    npm start
echo.
echo  To build Windows installer:
echo    npm run build:win
echo.
echo  IMPORTANT: Before running, add your GitHub
echo  OAuth credentials to src/main.js
echo  (see README.md for instructions)
echo.
pause
