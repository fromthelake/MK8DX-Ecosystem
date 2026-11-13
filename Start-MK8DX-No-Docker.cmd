@echo off
setlocal
title MK8DX - community server without Docker
cd /d "%~dp0"
set "MK8DX_A3_STATE=%LOCALAPPDATA%\MK8DX\NoDocker"
rem Options: -SkipCountdown (no countdown), -Plain (plain text).
for %%a in (%*) do (
    if /i "%%~a"=="-SkipCountdown" set "MK8DX_SKIP_COUNTDOWN=1"
    if /i "%%~a"=="-Plain" set "MK8DX_PLAIN=1"
)
rem Presentation only: tooling\mk8dx-ui.ps1 draws the header, laps and finish; every check below is unchanged.
set "UI=<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\mk8dx-ui.ps1""
if not exist "%~dp0tooling\mk8dx-ui.ps1" set "UI=rem"
set "MK8DX_RACE_FILE=%TEMP%\mk8dx-race-%RANDOM%%RANDOM%.txt"
%UI% -Show Intro -ShowSubtitle "community server without Docker - XAMPP and Node.js"
%UI% -Show Lap -ShowNumber 1/4 -ShowText "Checking Python and Node.js"
where python >nul 2>nul
if errorlevel 1 goto nopython
python -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3, 12) else 1)"
if errorlevel 1 goto nopython
where node >nul 2>nul
if errorlevel 1 goto nonode
%UI% -Show Lap -ShowNumber 2/4 -ShowText "Your private installation"
%UI% -Show Info -ShowText "Private installation: %MK8DX_A3_STATE%"
if not exist "%MK8DX_A3_STATE%\operator-profile.json" (
    python tooling\install.py wizard --state-dir "%MK8DX_A3_STATE%"
    if errorlevel 1 goto failed
)
%UI% -Show Lap -ShowNumber 3/4 -ShowText "Checking the installation"
python tooling\install.py status --state-dir "%MK8DX_A3_STATE%" >nul
if errorlevel 1 goto failed
%UI% -Show Lap -ShowNumber 4/4 -ShowText "Starting MK8DX"
%UI% -Show Finish -ShowText "MK8DX starts now. Leave this window open while you use the website."
%UI% -Show Info -ShowText "Next: open XAMPP Control Panel and click Start next to Apache.|Website:                     http://127.0.0.1:18090|Sign-in mail - a test inbox: http://127.0.0.1:18227|To stop: press Ctrl+C here, then Stop next to Apache."
echo.
python tooling\install.py start --state-dir "%MK8DX_A3_STATE%"
if errorlevel 1 goto failed
exit /b 0
:nopython
echo.
%UI% -Show Fail -ShowText "Python 3.12 or newer was not found. Install it from python.org with 'Add python.exe to PATH' ticked, close this window and start this file again."
pause
exit /b 1
:nonode
echo.
%UI% -Show Fail -ShowText "Node.js was not found. Install Node.js 24 from nodejs.org, close this window and start this file again."
pause
exit /b 1
:failed
echo.
%UI% -Show Fail -ShowText "MK8DX stopped. Read the message above, fix it and start this file again."
%UI% -Show Info -ShowText "Your private installation folder is kept: %MK8DX_A3_STATE%"
if defined MK8DX_RACE_FILE del "%MK8DX_RACE_FILE%" >nul 2>nul
pause
exit /b 1
