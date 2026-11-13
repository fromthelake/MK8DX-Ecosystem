@echo off
setlocal EnableDelayedExpansion
title MK8DX - manage (no Docker)
cd /d "%~dp0"
set "empty=0"
set "MK8DX_A3_STATE=%LOCALAPPDATA%\MK8DX\NoDocker"
if not exist "%MK8DX_A3_STATE%\operator-profile.json" (
    echo MK8DX is not installed yet. Start Start-MK8DX-No-Docker.cmd first.
    pause
    exit /b 1
)
rem Options: -SkipCountdown (no countdown), -Plain (plain text).
for %%a in (%*) do (
    if /i "%%~a"=="-SkipCountdown" set "MK8DX_SKIP_COUNTDOWN=1"
    if /i "%%~a"=="-Plain" set "MK8DX_PLAIN=1"
)
rem Presentation only: tooling\mk8dx-ui.ps1 draws the header, menu and results; the menu logic is unchanged.
set "UI=<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tooling\mk8dx-ui.ps1""
if not exist "%~dp0tooling\mk8dx-ui.ps1" set "UI=rem"
%UI% -Show Header -ShowSubtitle "manage the installation without Docker"
%UI% -Show Info -ShowText "Keep the MK8DX window from Start-MK8DX-No-Docker.cmd open while you use this."
:menu
if !empty! geq 3 exit /b 0
%UI% -Show Menu -ShowText "What do you want to do?" -ShowItems "1=Check that everything works;2=Make me administrator - after you signed in once;3=Make a backup - it is checked right away;4=Show the addresses;0=Close"
set "choice="
set /p "choice=Type a number and press Enter: "
if not defined choice (set /a empty+=1 & goto menu)
set "empty=0"
if "%choice%"=="1" (
    python tooling\install.py check --state-dir "%MK8DX_A3_STATE%" <nul
    call :result
    goto menu
)
if "%choice%"=="2" (
    python tooling\install.py admin --state-dir "%MK8DX_A3_STATE%" <nul
    call :result
    goto menu
)
if "%choice%"=="3" (
    for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "stamp=%%t"
    set "out=%USERPROFILE%\Documents\MK8DX-backups\a3-!stamp!"
    python tooling\install.py backup --state-dir "%MK8DX_A3_STATE%" --backup-output "!out!" <nul
    if not errorlevel 1 echo Private backup - keep it safe, never share it: !out!
    call :result
    goto menu
)
if "%choice%"=="4" (
    %UI% -Show Info -ShowColour Cyan -ShowText "Website:                     http://127.0.0.1:18090|Sign-in mail - a test inbox: http://127.0.0.1:18227"
    goto menu
)
if "%choice%"=="0" exit /b 0
echo '%choice%' is not one of the numbers above.
goto menu
:result
if errorlevel 1 (
    %UI% -Show Fail -ShowText "That step did not finish. Is the MK8DX window still open? Read the message above."
) else (
    %UI% -Show Ok
)
exit /b 0
