@echo off
setlocal EnableDelayedExpansion
title Infygalaxy IDE — Windows Installer Builder
color 0B

echo.
echo  ============================================================
echo   ^^  Infygalaxy IDE v1.0 — Windows .exe Builder
echo  ============================================================
echo.

:: ── Step 1: Check Node.js ─────────────────────────────────────────
echo  [Checking] Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Node.js is not installed.
    echo.
    echo  Please download and install Node.js LTS from:
    echo  https://nodejs.org/en/download
    echo.
    echo  After installing, run BUILD.bat again.
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: ── Step 2: Install dependencies ─────────────────────────────────
echo.
echo  [Step 1/3] Installing dependencies...
echo  This downloads Electron (~80MB). Please wait.
echo.
call npm install --prefer-offline
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: npm install failed.
    echo  Make sure you have internet access and try again.
    echo  If behind a proxy, configure npm proxy settings.
    echo.
    pause & exit /b 1
)
echo.
echo  [OK] Dependencies installed successfully.

:: ── Step 3: Build ─────────────────────────────────────────────────
echo.
echo  [Step 2/3] Building Windows installer...
echo  Packaging Electron app — this takes 1-3 minutes.
echo.
call npm run build:win
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Build failed. Common solutions:
    echo    1. Run BUILD.bat as Administrator
    echo    2. Temporarily disable antivirus
    echo    3. Delete node_modules folder and try again
    echo.
    pause & exit /b 1
)

:: ── Step 4: Done ──────────────────────────────────────────────────
echo.
echo  [Step 3/3] Verifying output...
echo.

set FOUND=0
for %%f in (dist\*.exe) do (
    set FOUND=1
    set EXEFILE=%%f
    set EXESIZE=%%~zf
)

if !FOUND!==1 (
    echo  ============================================================
    echo   BUILD COMPLETE!
    echo  ============================================================
    echo.
    echo   Installer: !EXEFILE!
    echo.
    echo   Distribute this .exe file to install Infygalaxy IDE.
    echo   It installs to Program Files with:
    echo     * Desktop shortcut
    echo     * Start Menu shortcut
    echo     * Uninstaller in Control Panel
    echo.
    echo   Opening dist folder now...
    echo.
    start explorer dist
) else (
    echo  WARNING: Could not find .exe in dist\
    echo  Check output above for errors.
)

pause
