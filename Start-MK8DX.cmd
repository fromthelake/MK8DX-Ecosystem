@echo off
title MK8DX - community server
rem The window title in the launcher language: tooling\mk8dx-ui.ps1 sets it when the launcher starts.
set "MK8DX_WINDOW_TITLE=MK8DX - community server"
cd /d "%~dp0"
rem Started from a PowerShell 7 window, Windows PowerShell 5.1 would inherit its module path and miss
rem Get-FileHash and Get-Date. An empty PSModulePath lets powershell.exe use its own modules.
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\start-mk8dx.ps1" %*
echo.
if errorlevel 1 <nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\mk8dx-ui.ps1" -Show Fail -ShowText "The selected step stopped. Read the message above before retrying."
pause
