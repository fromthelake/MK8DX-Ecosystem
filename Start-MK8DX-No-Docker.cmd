@echo off
setlocal
cd /d "%~dp0"
set "MK8DX_A3_STATE=%LOCALAPPDATA%\MK8DX\NoDocker"
if not exist "%MK8DX_A3_STATE%\operator-profile.json" (
    python tooling\install.py wizard --state-dir "%MK8DX_A3_STATE%"
    if errorlevel 1 goto failed
)
python tooling\install.py status --state-dir "%MK8DX_A3_STATE%"
if errorlevel 1 goto failed
python tooling\install.py start --state-dir "%MK8DX_A3_STATE%"
if errorlevel 1 goto failed
exit /b 0
:failed
echo MK8DX stopped. Read the message above and keep the private installation folder.
pause
exit /b 1
