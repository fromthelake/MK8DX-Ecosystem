@echo off
rem The texts cmd files show themselves (window titles, the Tournament Tools package's lines) in the 15 game
rem languages, without starting PowerShell (that costs about half a second per call). ASCII source on purpose.
rem   call mk8dx-text.cmd language                       sets MK8DX_LAUNCHER_LANGUAGE and MK8DX_TEXTS
rem   call mk8dx-text.cmd title "<English>"              the window title in that language
rem   call mk8dx-text.cmd say "<English>" [v0] [v1] [v2]  one line; {0} {1} {2} are filled after the lookup
rem Language: MK8DX_LAUNCHER_LANGUAGE, else MK8DX_LANGUAGE, else the Windows display language (registry), matched
rem like tooling/launcher_text.py and mk8dx-ui.ps1: exactly, then by region (es-MX -> es-419, zh-Hant/TW/HK/MO ->
rem zh-TW, other zh -> zh-CN), then by base language; English otherwise. The texts are launcher_i18n\cmd-<language>.txt
rem beside this file: "English|translation" lines in UTF-8 (tooling/i18n/build_web_catalogs.mjs). For another language
rem than English the window switches to code page 65001 once (as the PowerShell launcher does for its own output), so
rem cmd reads them as UTF-8; reading the old code page back and restoring it would cost two more processes.
if /i "%~1"=="language" goto :language
if /i "%~1"=="title" goto :title
if /i "%~1"=="say" goto :say
exit /b 1

:language
call :choose
set "MK8DX_TEXTS="
if exist "%~dp0launcher_i18n\cmd-%MK8DX_LAUNCHER_LANGUAGE%.txt" set "MK8DX_TEXTS=%~dp0launcher_i18n\cmd-%MK8DX_LAUNCHER_LANGUAGE%.txt"
if not defined MK8DX_TEXTS exit /b 0
>nul chcp 65001
exit /b 0

:choose
setlocal
set "WANT=%MK8DX_LAUNCHER_LANGUAGE%"
if not defined WANT set "WANT=%MK8DX_LANGUAGE%"
if not defined WANT for /f "tokens=3" %%a in ('reg query "HKCU\Control Panel\Desktop" /v PreferredUILanguages 2^>nul') do if not "%%a"=="" set "WANT=%%a"
if not defined WANT for /f "tokens=3" %%a in ('reg query "HKCU\Control Panel\Desktop\MuiCached" /v MachinePreferredUILanguages 2^>nul') do if not "%%a"=="" set "WANT=%%a"
set "CODE=en"
if not defined WANT goto :chosen
rem The first of a REG_MULTI_SZ list (nl-NL\0en-US); de_DE.UTF-8 style tags lose their encoding.
set "WANT=%WANT:\0= %"
set "WANT=%WANT:_=-%"
for /f "tokens=1 delims=.@ " %%a in ("%WANT%") do set "WANT=%%a"
set "CODE="
for %%c in (en nl en-US fr fr-CA de es es-419 it pt ru ja ko zh-CN zh-TW) do if /i "%WANT%"=="%%c" set "CODE=%%c"
if defined CODE goto :chosen
if /i "%WANT:~0,2%"=="zh" set "CODE=zh-CN"
if /i "%WANT:~0,2%"=="zh" if /i not "%WANT:-hant=%"=="%WANT%" set "CODE=zh-TW"
if /i "%WANT:~0,2%"=="zh" if /i not "%WANT:-tw=%"=="%WANT%" set "CODE=zh-TW"
if /i "%WANT:~0,2%"=="zh" if /i not "%WANT:-hk=%"=="%WANT%" set "CODE=zh-TW"
if /i "%WANT:~0,2%"=="zh" if /i not "%WANT:-mo=%"=="%WANT%" set "CODE=zh-TW"
if defined CODE goto :chosen
if /i "%WANT:~0,3%"=="es-" if /i not "%WANT:~0,5%"=="es-es" set "CODE=es-419"
if defined CODE goto :chosen
for %%c in (en nl fr de es it pt ru ja ko) do if /i "%WANT:~0,3%"=="%%c-" set "CODE=%%c"
if not defined CODE set "CODE=en"
:chosen
endlocal & set "MK8DX_LAUNCHER_LANGUAGE=%CODE%"
exit /b 0

:lookup
rem %1 = the English; MK8DX_FOUND = its translation (the English when there is none).
set "MK8DX_FOUND=%~1"
if not defined MK8DX_TEXTS exit /b 0
for /f "usebackq eol=| tokens=1,* delims=|" %%a in ("%MK8DX_TEXTS%") do if "%%a"=="%~1" set "MK8DX_FOUND=%%b"
exit /b 0

:title
title %~2
if not defined MK8DX_TEXTS call :language
if not defined MK8DX_TEXTS exit /b 0
setlocal
call :lookup "%~2"
setlocal EnableDelayedExpansion
title !MK8DX_FOUND!
endlocal
endlocal
exit /b 0

:say
setlocal
if not defined MK8DX_LAUNCHER_LANGUAGE call :language
call :lookup "%~2"
call set "MK8DX_FOUND=%%MK8DX_FOUND:{0}=%~3%%"
call set "MK8DX_FOUND=%%MK8DX_FOUND:{1}=%~4%%"
call set "MK8DX_FOUND=%%MK8DX_FOUND:{2}=%~5%%"
setlocal EnableDelayedExpansion
echo(!MK8DX_FOUND!
endlocal
endlocal
exit /b 0
