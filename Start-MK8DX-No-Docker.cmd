@echo off
setlocal
title MK8DX - community server without Docker
cd /d "%~dp0"
set "MK8DX_A3_STATE=%LOCALAPPDATA%\MK8DX\NoDocker"
echo.
echo    ==================================================
echo      M K 8 D X    T I M E   T R I A L S
echo      community server without Docker - XAMPP and Node.js
echo    ==================================================
echo.
echo [1/4] Checking Python and Node.js
where python >nul 2>nul
if errorlevel 1 goto nopython
python -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3, 12) else 1)"
if errorlevel 1 goto nopython
where node >nul 2>nul
if errorlevel 1 goto nonode
echo [2/4] Your private installation: %MK8DX_A3_STATE%
if not exist "%MK8DX_A3_STATE%\operator-profile.json" (
    python tooling\install.py wizard --state-dir "%MK8DX_A3_STATE%"
    if errorlevel 1 goto failed
)
echo [3/4] Checking the installation
python tooling\install.py status --state-dir "%MK8DX_A3_STATE%" >nul
if errorlevel 1 goto failed
echo [4/4] Starting MK8DX. Leave this window open while you use the website.
echo.
echo       Next: open XAMPP Control Panel and click Start next to Apache.
echo       Website:                     http://127.0.0.1:18090
echo       Sign-in mail - a test inbox: http://127.0.0.1:18227
echo       To stop: press Ctrl+C here, then Stop next to Apache.
echo.
python tooling\install.py start --state-dir "%MK8DX_A3_STATE%"
if errorlevel 1 goto failed
exit /b 0
:nopython
echo.
echo !!  Python 3.12 or newer was not found. Install it from python.org with
echo     "Add python.exe to PATH" ticked, close this window and start this file again.
pause
exit /b 1
:nonode
echo.
echo !!  Node.js was not found. Install Node.js 24 from nodejs.org, close this window
echo     and start this file again.
pause
exit /b 1
:failed
echo.
echo !!  MK8DX stopped. Read the message above, fix it and start this file again.
echo     Your private installation folder is kept: %MK8DX_A3_STATE%
pause
exit /b 1
