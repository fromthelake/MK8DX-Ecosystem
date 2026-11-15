@echo off
title MK8DX - community server
rem The window title in the launcher language (tooling\mk8dx-ui.ps1; UTF-8 through code page 65001).
set "MK8DX_CODEPAGE="
for /f "tokens=2 delims=:." %%c in ('chcp') do set "MK8DX_CODEPAGE=%%c"
>nul chcp 65001
if exist "%~dp0toolingmk8dx-ui.ps1" for /f "usebackq delims=" %%t in (`^<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\mk8dx-ui.ps1" -Show Title -ShowText "MK8DX - community server"`) do title %%t
if defined MK8DX_CODEPAGE >nul chcp %MK8DX_CODEPAGE%
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\start-mk8dx.ps1" %*
echo.
if errorlevel 1 <nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\mk8dx-ui.ps1" -Show Fail -ShowText "The selected step stopped. Read the message above before retrying."
pause
