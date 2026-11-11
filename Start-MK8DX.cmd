@echo off
title MK8DX - community server
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\start-mk8dx.ps1"
echo.
if errorlevel 1 echo The selected step stopped. Read the message above before retrying.
pause
