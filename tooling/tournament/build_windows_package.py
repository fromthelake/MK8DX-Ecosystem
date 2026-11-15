"""Build the Windows Tournament package with its internal recognition assets.

The package is a few megabytes: product and shared wheels, a locked list of
third-party requirements, a double-clickable installer, a Python setup helper
and the user guide. The heavy runtime (PyTorch, EasyOCR, OpenCV, Qt) is NOT
bundled; the installer downloads it from PyPI/PyTorch into a package-local ``runtime\\``
folder on the user's machine, so the hosted download stays far below the 5 GB
hosting budget and nothing is installed system-wide.

Usage (PowerShell, from the repository root):

    .venv\\Scripts\\python.exe tooling\\tournament\\build_windows_package.py ^
        --output C:\\path\\to\\tournament-tools-package-v1 --version 1

The output folder must not exist yet. A sibling ``<output>.zip`` is written
unless ``--no-zip`` is given. Building needs network access once (pip fetches
the setuptools build backend for the wheels, and the pinned EasyOCR models are
fetched into the model cache, see docs/CLIENT_BUILDS.md); the build itself never
downloads the runtime closure.

The package includes reviewed live and recorded asset variants from the
repository's internal collection, including the EasyOCR recognition models
(``runtime-assets\\ocr-models``: detection plus every recognition model the
English, Latin-script, Cyrillic, Japanese, Korean and Chinese readers use), so
OCR never downloads a model and processing works offline after the install.
Publication requires a separate rights review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TOOLING_ROOT = Path(__file__).resolve().parent
LOCK_FILE = TOOLING_ROOT / "requirements.lock.txt"
USER_GUIDE = REPOSITORY_ROOT / "docs" / "product" / "USING_MK8DX_TOURNAMENT_TOOLS.md"
LIVE_LAPTOP_GUIDE = REPOSITORY_ROOT / "docs" / "product" / "README_TOURNAMENT_LIVE_LAPTOP.md"
PROCESSOR_FALLBACK_GUIDE = (
    REPOSITORY_ROOT / "docs" / "product" / "README_TOURNAMENT_PROCESSOR_FALLBACK_LAPTOP.md"
)
PROJECTS = (
    REPOSITORY_ROOT / "packages" / "tournament-connected" / "python",
    REPOSITORY_ROOT / "packages" / "tournament-extraction" / "python",
    REPOSITORY_ROOT / "apps" / "tournament-processor",
    REPOSITORY_ROOT / "apps" / "tournament-live",
    REPOSITORY_ROOT / "packages" / "icon-matcher" / "python",
)
TORCH_SELECTOR = PROJECTS[1] / "src" / "mk8dx_tournament_extraction" / "setup_torch.py"
COLLECTION_MATERIALIZER = REPOSITORY_ROOT / "tooling/assets/materialize_collection.mjs"
# Public upstream models kept out of Git: fetched at build time into a cache, verified against
# packages/assets/downloaded-models-v1.json and staged beside the collection's own models.
MODEL_DOWNLOADER = REPOSITORY_ROOT / "tooling/assets/downloaded_models.py"

# python.org embeddable runtime used when the machine has no 64-bit Python 3.12.
# The MD5 shown on https://www.python.org/downloads/release/python-31210/ for
# "Windows embeddable package (64-bit)" is fe8ef205f2e9c3ba44d0cf9954e1abd3; the
# SHA-256 below was computed from the archive that matched that MD5 on 2026-08-22.
PYTHON_EMBED_VERSION = "3.12.10"
PYTHON_EMBED_FILENAME = f"python-{PYTHON_EMBED_VERSION}-embed-amd64.zip"
PYTHON_EMBED_URL = f"https://www.python.org/ftp/python/{PYTHON_EMBED_VERSION}/{PYTHON_EMBED_FILENAME}"
PYTHON_EMBED_SHA256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
PYTHON_EMBED_MD5_ON_PYTHON_ORG = "fe8ef205f2e9c3ba44d0cf9954e1abd3"
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
# The embeddable runtime has no Tcl/Tk, but live_processor.qt_app imports helpers from the
# tkinter-based gui_app module, so the installer adds the official tcltk.msi of the same
# release (SHA-256 computed from the python.org download on 2026-08-22, extracted with
# `msiexec /a`, which needs no elevation).
TCLTK_URL = f"https://www.python.org/ftp/python/{PYTHON_EMBED_VERSION}/amd64/tcltk.msi"
TCLTK_SHA256 = "55c96ffad69b1c834aa52e11b9ce41637a178ba6ad6607e83956044834276e2a"

MANIFEST_KIND = "mk8dx.tournament-tools-windows-package.v1"
LAUNCHER_TEXT_FILES = ("launcher_text.py", "mk8dx-ui.ps1")


class BuildError(RuntimeError):
    """A bounded packaging failure."""


# --------------------------------------------------------------------------- #
# Files written into the package. Tokens of the form @@NAME@@ are substituted; #
# batch files never pass through str.format so their % signs stay untouched.   #
# --------------------------------------------------------------------------- #

INSTALLER_CMD = r"""@echo off
setlocal EnableExtensions
title MK8DX Tournament Tools - installer
rem ---------------------------------------------------------------------------
rem  MK8DX Tournament Tools - Windows portable installer (package version @@VERSION@@)
rem
rem  Double-click this file. It prepares a Python 3.12 runtime INSIDE this
rem  folder (runtime\), installs the Tournament Processor / Tournament Live
rem  tools plus their dependencies into it, and writes the launcher files
rem  TournamentProcessor.cmd, TournamentAnalysis.cmd, TournamentLive.cmd, TournamentLiveCli.cmd
rem  and TournamentConnect.cmd.
rem  Nothing is installed system-wide. Re-run it later to update.
rem
rem  Internet is required once: PyTorch, EasyOCR, OpenCV and Qt are downloaded
rem  from PyPI/PyTorch (CPU or NVIDIA CUDA, a few GB on disk). If this computer has
rem  no 64-bit Python 3.12, the official python.org embeddable runtime is
rem  downloaded and verified by SHA-256 before it is used.
rem ---------------------------------------------------------------------------
set "PKG_ROOT=%~dp0"
set "RUNTIME=%PKG_ROOT%runtime"
set "LOG=%PKG_ROOT%install.log"
set "TOOLS=%PKG_ROOT%tools"
set "PY_EMBED_URL=@@PYTHON_EMBED_URL@@"
set "PY_EMBED_SHA256=@@PYTHON_EMBED_SHA256@@"
set "PY_EMBED_ZIP=%RUNTIME%\@@PYTHON_EMBED_FILENAME@@"
set "GET_PIP_URL=@@GET_PIP_URL@@"
set "TCLTK_URL=@@TCLTK_URL@@"
set "TCLTK_SHA256=@@TCLTK_SHA256@@"
set "TCLTK_MSI=%RUNTIME%\tcltk.msi"
call :language
call :title "MK8DX Tournament Tools - installer"

echo ============================================================
call :say " MK8DX Tournament Tools - installer (package version {0})" "@@VERSION@@"
echo ============================================================
call :say " Package folder : {0}" "%PKG_ROOT%"
call :say " Log file       : {0}" "%LOG%"
echo.
echo [%date% %time%] installer started >> "%LOG%"

if not exist "%TOOLS%\mk8dx_tools_setup.py" goto :fail_package
if not exist "%TOOLS%\select_torch.py" goto :fail_package
if not exist "%PKG_ROOT%requirements.lock.txt" goto :fail_package
if not exist "%PKG_ROOT%wheels\" goto :fail_package

rem ---- Step 1: choose the Python 3.12 (64-bit) runtime ----------------------
set "PYTHON="
set "PYTHON_KIND="
if exist "%RUNTIME%\python.exe" (
    set "PYTHON=%RUNTIME%\python.exe"
    set "PYTHON_KIND=embedded"
    call :say "Existing package runtime found (embedded Python). It will be updated in place."
    goto :have_python
)
if exist "%RUNTIME%\Scripts\python.exe" (
    set "PYTHON=%RUNTIME%\Scripts\python.exe"
    set "PYTHON_KIND=venv"
    call :say "Existing package runtime found (virtual environment). It will be updated in place."
    goto :have_python
)

set "SYSTEM_PYTHON="
where py >nul 2>&1
if errorlevel 1 goto :probe_python_exe
for /f "delims=" %%P in ('py -3.12 "%TOOLS%\check_python.py" 2^>nul') do set "SYSTEM_PYTHON=%%P"
if defined SYSTEM_PYTHON goto :create_venv
:probe_python_exe
where python >nul 2>&1
if errorlevel 1 goto :download_embedded
for /f "delims=" %%P in ('python "%TOOLS%\check_python.py" 2^>nul') do set "SYSTEM_PYTHON=%%P"
if defined SYSTEM_PYTHON goto :create_venv
goto :download_embedded

:create_venv
call :say "Using the 64-bit Python 3.12 already on this computer:"
echo   %SYSTEM_PYTHON%
call :say "Creating a private runtime inside the package ..."
echo [%date% %time%] creating venv with %SYSTEM_PYTHON% >> "%LOG%"
"%SYSTEM_PYTHON%" -m venv "%RUNTIME%" >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_venv
set "PYTHON=%RUNTIME%\Scripts\python.exe"
set "PYTHON_KIND=venv"
"%PYTHON%" -m pip install --upgrade pip >> "%LOG%" 2>&1
goto :have_python

:download_embedded
call :say "No 64-bit Python 3.12 was found on this computer."
call :say "Downloading the official python.org runtime (about 11 MB) ..."
echo   %PY_EMBED_URL%
echo [%date% %time%] downloading %PY_EMBED_URL% >> "%LOG%"
if not exist "%RUNTIME%" mkdir "%RUNTIME%"
call :download "%PY_EMBED_URL%" "%PY_EMBED_ZIP%"
if errorlevel 1 goto :fail_download
if not exist "%PY_EMBED_ZIP%" goto :fail_download
call :say "Verifying the downloaded runtime ..."
set "ACTUAL_SHA256="
for /f "skip=1 delims=" %%H in ('certutil -hashfile "%PY_EMBED_ZIP%" SHA256') do if not defined ACTUAL_SHA256 set "ACTUAL_SHA256=%%H"
if defined ACTUAL_SHA256 set "ACTUAL_SHA256=%ACTUAL_SHA256: =%"
call :say "  expected {0}" "%PY_EMBED_SHA256%"
call :say "  actual   {0}" "%ACTUAL_SHA256%"
if /I not "%ACTUAL_SHA256%"=="%PY_EMBED_SHA256%" goto :fail_hash
call :say "SHA-256 verified. Extracting the runtime ..."
call :unzip "%PY_EMBED_ZIP%" "%RUNTIME%"
if errorlevel 1 goto :fail_extract
if not exist "%RUNTIME%\python.exe" goto :fail_extract
del /q "%PY_EMBED_ZIP%" >nul 2>&1
if not exist "%RUNTIME%\python312._pth" goto :fail_extract
call :write_pth
call :say "Preparing the Python package installer ..."
echo [%date% %time%] downloading %GET_PIP_URL% >> "%LOG%"
call :download "%GET_PIP_URL%" "%RUNTIME%\get-pip.py"
if errorlevel 1 goto :fail_download_pip
if not exist "%RUNTIME%\get-pip.py" goto :fail_download_pip
"%RUNTIME%\python.exe" "%RUNTIME%\get-pip.py" --no-warn-script-location >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_pip
del /q "%RUNTIME%\get-pip.py" >nul 2>&1
set "PYTHON=%RUNTIME%\python.exe"
set "PYTHON_KIND=embedded"
goto :have_python

:have_python
echo.
call :say "Python runtime: {0} [{1}]" "%PYTHON%" "%PYTHON_KIND%"
echo.
set "TCLTK_RESULT=0"
if /I "%PYTHON_KIND%"=="embedded" call :write_pth
if /I "%PYTHON_KIND%"=="embedded" if not exist "%RUNTIME%\_tkinter.pyd" call :add_tcltk
if not "%TCLTK_RESULT%"=="0" goto :fail_tcltk
call :say "---- Step 2: installing the Tournament tools and their dependencies ----"
call :say "This downloads PyTorch, EasyOCR, OpenCV and Qt (several GB with NVIDIA CUDA)."
call :say "This can take 5 to 30 minutes. Please wait ..."
echo.
echo [%date% %time%] running setup helper (%PYTHON_KIND%) >> "%LOG%"
"%PYTHON%" "%TOOLS%\mk8dx_tools_setup.py" install --package-root "%PKG_ROOT%." --python-kind %PYTHON_KIND% --log "%LOG%"
if errorlevel 1 goto :fail_setup

echo.
echo ============================================================
call :say " SUCCESS - MK8DX Tournament Tools are installed in this folder."
echo ============================================================
call :say " TournamentProcessor.cmd  - process a recorded video (drag it onto the file)"
call :say " TournamentAnalysis.cmd   - window to analyse recordings afterwards"
call :say " TournamentLive.cmd       - live capture-card tournament app"
call :say " TournamentLiveCli.cmd    - advanced command line"
call :say " TournamentConnect.cmd    - optional connection to the website"
call :say " TournamentTools.config.cmd - local settings and bundled assets"
echo.
call :say " Read README-FIRST.txt and USING_MK8DX_TOURNAMENT_TOOLS.md for the workflow."
echo [%date% %time%] installer finished: SUCCESS >> "%LOG%"
goto :end

:fail_package
call :say "FAILED: this folder is not a complete package."
call :say "Extract the whole zip again and run the installer from that folder."
goto :failed
:fail_venv
call :say "FAILED: the private runtime could not be created. See {0}." "%LOG%"
goto :failed
:fail_download
call :say "FAILED: the Python runtime could not be downloaded. Check your connection and retry."
goto :failed
:fail_hash
call :say "FAILED: the downloaded Python runtime failed its safety check. It was removed. Retry later."
del /q "%PY_EMBED_ZIP%" >nul 2>&1
goto :failed
:fail_extract
call :say "FAILED: the Python runtime could not be prepared. See {0}." "%LOG%"
goto :failed
:fail_download_pip
call :say "FAILED: the package installer could not be downloaded. Check your connection and retry."
goto :failed
:fail_pip
call :say "FAILED: the package installer could not be prepared. See {0}." "%LOG%"
goto :failed
:fail_tcltk
call :say "FAILED: Tournament Live interface support could not be added (step {0})." "%TCLTK_RESULT%"
call :say "Check your connection and run the installer again."
goto :failed
:fail_setup
echo.
echo ============================================================
call :say " FAILED - the tools were NOT installed completely. See {0}." "%LOG%"
call :say " Run this installer again; completed downloads are reused."
echo ============================================================
goto :failed

:failed
echo [%date% %time%] installer finished: FAILED >> "%LOG%"
if not defined MK8DX_INSTALL_NO_PAUSE pause
exit /b 1

:end
if not defined MK8DX_INSTALL_NO_PAUSE pause
exit /b 0

:language
rem The text language: MK8DX_TOURNAMENT_LANGUAGE (TournamentTools.config.cmd) unless auto, else MK8DX_LANGUAGE,
rem else the Windows display language, matched to one of the 15 game languages by tools\mk8dx-ui.ps1 (the
rem launchers' mechanism; catalogs in tools\launcher_i18n). MK8DX_LANGUAGE itself stays as it was for the apps.
setlocal
if defined MK8DX_TOURNAMENT_LANGUAGE if /I not "%MK8DX_TOURNAMENT_LANGUAGE%"=="auto" set "MK8DX_LANGUAGE=%MK8DX_TOURNAMENT_LANGUAGE%"
set "FOUND=en"
if exist "%PKG_ROOT%tools\mk8dx-ui.ps1" for /f "delims=" %%L in ('^<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PKG_ROOT%tools\mk8dx-ui.ps1" -Show Language 2^>nul') do set "FOUND=%%L"
endlocal & set "MK8DX_LAUNCHER_LANGUAGE=%FOUND%"
exit /b 0

:say
rem %1 = the English text; {0} {1} {2} are filled with %2 %3 %4. Other languages: tools\mk8dx-ui.ps1.
if not defined MK8DX_LAUNCHER_LANGUAGE goto :say_en
if /I "%MK8DX_LAUNCHER_LANGUAGE:~0,2%"=="en" goto :say_en
if not exist "%PKG_ROOT%tools\mk8dx-ui.ps1" goto :say_en
setlocal
set "MK8DX_LANGUAGE=%MK8DX_LAUNCHER_LANGUAGE%"
<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PKG_ROOT%tools\mk8dx-ui.ps1" -Show Text -ShowText "%~1" -ShowValues "%~2|%~3|%~4|"
if not errorlevel 1 exit /b 0
endlocal
:say_en
set "MK8DX_SAY=%~1"
call set "MK8DX_SAY=%%MK8DX_SAY:{0}=%~2%%"
call set "MK8DX_SAY=%%MK8DX_SAY:{1}=%~3%%"
call set "MK8DX_SAY=%%MK8DX_SAY:{2}=%~4%%"
echo(%MK8DX_SAY%
set "MK8DX_SAY="
exit /b 0

:title
rem %1 = the English window title, shown in the text language (UTF-8 read through code page 65001).
title %~1
if not defined MK8DX_LAUNCHER_LANGUAGE exit /b 0
if /I "%MK8DX_LAUNCHER_LANGUAGE:~0,2%"=="en" exit /b 0
if not exist "%PKG_ROOT%tools\mk8dx-ui.ps1" exit /b 0
setlocal
set "MK8DX_LANGUAGE=%MK8DX_LAUNCHER_LANGUAGE%"
set "CODEPAGE="
for /f "tokens=2 delims=:." %%c in ('chcp') do set "CODEPAGE=%%c"
>nul chcp 65001
for /f "usebackq delims=" %%t in (`^<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PKG_ROOT%tools\mk8dx-ui.ps1" -Show Title -ShowText "%~1"`) do title %%t
if defined CODEPAGE >nul chcp %CODEPAGE%
endlocal
exit /b 0

rem ---- helpers: Windows 10/11 ship curl.exe and tar.exe; PowerShell is the fallback ----
:download
rem %1 = URL, %2 = destination file
where curl.exe >nul 2>&1
if errorlevel 1 goto :download_powershell
curl.exe -L --fail --silent --show-error --retry 3 -o "%~2" "%~1" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
:download_powershell
set "PSModulePath="
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%~1' -OutFile '%~2' -UseBasicParsing" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%

:unzip
rem %1 = zip file, %2 = destination folder
where tar.exe >nul 2>&1
if errorlevel 1 goto :unzip_powershell
tar.exe -xf "%~1" -C "%~2" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
:unzip_powershell
set "PSModulePath="
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~1' -DestinationPath '%~2' -Force" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%

:write_pth
rem The embeddable runtime ignores site-packages until 'import site' is enabled in its ._pth file;
rem Lib\ holds the tkinter package added by :add_tcltk.
> "%RUNTIME%\python312._pth" echo python312.zip
>> "%RUNTIME%\python312._pth" echo .
>> "%RUNTIME%\python312._pth" echo Lib
>> "%RUNTIME%\python312._pth" echo import site
exit /b 0

:add_tcltk
rem The python.org embeddable runtime has no Tcl/Tk. The Tournament Live GUI imports tkinter,
rem so the official tcltk.msi of the same Python release is downloaded, SHA-256 verified and
rem unpacked (administrative install, no elevation) into the runtime folder.
call :say "Adding Tournament Live interface support (about 3.5 MB) ..."
echo [%date% %time%] downloading %TCLTK_URL% >> "%LOG%"
call :download "%TCLTK_URL%" "%TCLTK_MSI%"
if errorlevel 1 (set "TCLTK_RESULT=1" & exit /b 1)
if not exist "%TCLTK_MSI%" (set "TCLTK_RESULT=1" & exit /b 1)
set "TCLTK_ACTUAL="
for /f "skip=1 delims=" %%H in ('certutil -hashfile "%TCLTK_MSI%" SHA256') do if not defined TCLTK_ACTUAL set "TCLTK_ACTUAL=%%H"
if defined TCLTK_ACTUAL set "TCLTK_ACTUAL=%TCLTK_ACTUAL: =%"
call :say "  expected {0}" "%TCLTK_SHA256%"
call :say "  actual   {0}" "%TCLTK_ACTUAL%"
if /I not "%TCLTK_ACTUAL%"=="%TCLTK_SHA256%" (del /q "%TCLTK_MSI%" & set "TCLTK_RESULT=2" & exit /b 1)
if exist "%RUNTIME%\tcltk-extract" rmdir /s /q "%RUNTIME%\tcltk-extract"
start /wait "" msiexec /a "%TCLTK_MSI%" /qn TARGETDIR="%RUNTIME%\tcltk-extract"
if not exist "%RUNTIME%\tcltk-extract\DLLs\_tkinter.pyd" (set "TCLTK_RESULT=3" & exit /b 1)
copy /y "%RUNTIME%\tcltk-extract\DLLs\*" "%RUNTIME%\" >> "%LOG%" 2>&1
xcopy /E /I /Q /Y "%RUNTIME%\tcltk-extract\tcl" "%RUNTIME%\tcl" >> "%LOG%" 2>&1
xcopy /E /I /Q /Y "%RUNTIME%\tcltk-extract\Lib\tkinter" "%RUNTIME%\Lib\tkinter" >> "%LOG%" 2>&1
rmdir /s /q "%RUNTIME%\tcltk-extract"
del /q "%TCLTK_MSI%" >nul 2>&1
if not exist "%RUNTIME%\_tkinter.pyd" (set "TCLTK_RESULT=3" & exit /b 1)
call :say "Tournament Live interface support added."
exit /b 0
"""

CHECK_PYTHON_PY = r'''"""Print this interpreter's path when it is a 64-bit CPython 3.12; otherwise exit 1."""
import sys

if sys.version_info[:2] == (3, 12) and sys.maxsize > 2**32 and sys.implementation.name == "cpython":
    sys.stdout.write(sys.executable)
    sys.exit(0)
sys.exit(1)
'''

SETUP_HELPER_PY = r'''"""MK8DX Tournament Tools - package-local setup and launcher helper.

Runs under the package runtime (stdlib only). Invoked by
Install-MK8DX-TournamentTools.cmd (``install``) and by the launcher files
(``process-video``, ``usage``). Everything it writes stays inside the package
folder.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

PACKAGE_VERSION = "@@VERSION@@"
DISTRIBUTIONS = (
    "mk8dx-tournament-connected==@@CONNECTED_VERSION@@",
    "mk8dx-tournament-extraction[vision]==@@EXTRACTION_VERSION@@",
    "mk8dx-tournament-processor[gui]==@@PROCESSOR_VERSION@@",
    "mk8dx-tournament-live[gui]==@@LIVE_VERSION@@",
    "mk8dx-icon-matcher==@@ICON_MATCHER_VERSION@@",
)
LOCAL_DISTRIBUTIONS = (
    "mk8dx-tournament-connected==@@CONNECTED_VERSION@@",
    "mk8dx-tournament-extraction==@@EXTRACTION_VERSION@@",
    "mk8dx-tournament-processor==@@PROCESSOR_VERSION@@",
    "mk8dx-tournament-live==@@LIVE_VERSION@@",
    "mk8dx-icon-matcher==@@ICON_MATCHER_VERSION@@",
)

CONFIG_CMD = """@echo off
rem MK8DX Tournament Tools - settings. The launchers call this file first.
rem %~dp0 is the package folder. Paths below use only bundled assets.
rem
rem Live recognition assets; recorded-video launcher selects its own variant.
set "MK8DX_TOURNAMENT_ASSETS_ROOT=%~dp0runtime-assets\\live\\assets"
set "MK8DX_TOURNAMENT_REFERENCE_ROOT=%~dp0runtime-assets\\live"
set "MK8DX_TOURNAMENT_ENGINE_DATA_ROOT=%~dp0runtime-assets\\live"
rem Canonical Clean Assets display images, using the same IDs/paths as Web.
set "MK8_CLEAN_ASSETS_ROOT=%~dp0runtime-assets\\clean-assets"
set "EASYOCR_MODULE_PATH=%~dp0runtime-assets\\ocr-models"
rem Tournament Live keeps its sessions here (Live_Output\\exports, diagnostics, ...).
set "MK8DX_TOURNAMENT_LIVE_ROOT=%~dp0TournamentLive"
rem Interface language: auto follows Windows. Set to one of en, nl, en-US, fr, fr-CA, de, es, es-419, it, pt,
rem ru, ja, ko, zh-CN or zh-TW to override (the launcher windows follow it too).
set "MK8DX_TOURNAMENT_LANGUAGE=auto"
rem Optional: another image for the Tournament Analysis window banner instead of the packaged one.
rem set "MK8DX_ANALYSIS_BACKGROUND=C:\\path\\to\\banner.jpg"
rem Player names in non-Latin scripts (Cyrillic, Japanese, Korean, Chinese): on or off. Off saves the memory
rem of five extra OCR readers; Latin names read the same. Tournament Live's checkbox, once used, takes precedence.
set "MK8DX_NAME_SCRIPTS=on"
rem Optional: set to "cpu" to force CPU OCR even when a CUDA build of torch is present.
rem set "MK8_EASYOCR_GPU_MODE=cpu"
"""

LAUNCHER_HEADER = """@echo off
setlocal EnableExtensions
set "PKG_ROOT=%~dp0"
set "PYTHON="
if exist "%PKG_ROOT%runtime\\python.exe" set "PYTHON=%PKG_ROOT%runtime\\python.exe"
if not defined PYTHON if exist "%PKG_ROOT%runtime\\Scripts\\python.exe" set "PYTHON=%PKG_ROOT%runtime\\Scripts\\python.exe"
if not defined PYTHON goto :no_runtime
if exist "%PKG_ROOT%TournamentTools.config.cmd" call "%PKG_ROOT%TournamentTools.config.cmd"
call :language
"""

LAUNCHER_FOOTER = """goto :eof
:no_runtime
call :language
call :say "The package runtime is missing. Run {0} first." "Install-MK8DX-TournamentTools.cmd"
pause
exit /b 1

:language
rem The text language: MK8DX_TOURNAMENT_LANGUAGE (TournamentTools.config.cmd) unless auto, else MK8DX_LANGUAGE,
rem else the Windows display language, matched to one of the 15 game languages by tools\\mk8dx-ui.ps1 (the
rem launchers' mechanism; catalogs in tools\\launcher_i18n). MK8DX_LANGUAGE itself stays as it was for the apps.
setlocal
if defined MK8DX_TOURNAMENT_LANGUAGE if /I not "%MK8DX_TOURNAMENT_LANGUAGE%"=="auto" set "MK8DX_LANGUAGE=%MK8DX_TOURNAMENT_LANGUAGE%"
set "FOUND=en"
if exist "%PKG_ROOT%tools\\mk8dx-ui.ps1" for /f "delims=" %%L in ('^<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PKG_ROOT%tools\\mk8dx-ui.ps1" -Show Language 2^>nul') do set "FOUND=%%L"
endlocal & set "MK8DX_LAUNCHER_LANGUAGE=%FOUND%"
exit /b 0

:say
rem %1 = the English text; {0} {1} {2} are filled with %2 %3 %4. Other languages: tools\\mk8dx-ui.ps1.
if not defined MK8DX_LAUNCHER_LANGUAGE goto :say_en
if /I "%MK8DX_LAUNCHER_LANGUAGE:~0,2%"=="en" goto :say_en
if not exist "%PKG_ROOT%tools\\mk8dx-ui.ps1" goto :say_en
setlocal
set "MK8DX_LANGUAGE=%MK8DX_LAUNCHER_LANGUAGE%"
<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PKG_ROOT%tools\\mk8dx-ui.ps1" -Show Text -ShowText "%~1" -ShowValues "%~2|%~3|%~4|"
if not errorlevel 1 exit /b 0
endlocal
:say_en
set "MK8DX_SAY=%~1"
call set "MK8DX_SAY=%%MK8DX_SAY:{0}=%~2%%"
call set "MK8DX_SAY=%%MK8DX_SAY:{1}=%~3%%"
call set "MK8DX_SAY=%%MK8DX_SAY:{2}=%~4%%"
echo(%MK8DX_SAY%
set "MK8DX_SAY="
exit /b 0

:title
rem %1 = the English window title, shown in the text language (UTF-8 read through code page 65001).
title %~1
if not defined MK8DX_LAUNCHER_LANGUAGE exit /b 0
if /I "%MK8DX_LAUNCHER_LANGUAGE:~0,2%"=="en" exit /b 0
if not exist "%PKG_ROOT%tools\\mk8dx-ui.ps1" exit /b 0
setlocal
set "MK8DX_LANGUAGE=%MK8DX_LAUNCHER_LANGUAGE%"
set "CODEPAGE="
for /f "tokens=2 delims=:." %%c in ('chcp') do set "CODEPAGE=%%c"
>nul chcp 65001
for /f "usebackq delims=" %%t in (`^<nul powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PKG_ROOT%tools\\mk8dx-ui.ps1" -Show Title -ShowText "%~1"`) do title %%t
if defined CODEPAGE >nul chcp %CODEPAGE%
endlocal
exit /b 0
"""

PROCESSOR_CMD = LAUNCHER_HEADER + """call :title "MK8DX Tournament Processor"
if "%~1"=="" goto :usage
"%PYTHON%" "%PKG_ROOT%tools\\mk8dx_tools_setup.py" process-video --package-root "%PKG_ROOT%." "%~1"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
:usage
"%PYTHON%" "%PKG_ROOT%tools\\mk8dx_tools_setup.py" usage --package-root "%PKG_ROOT%."
echo.
pause
exit /b 0
""" + LAUNCHER_FOOTER

# The analysis window runs the same recorded-video processing as TournamentProcessor.cmd, so it selects the
# same recorded recognition variant (process_video below sets these for the drag-and-drop launcher).
ANALYSIS_CMD = LAUNCHER_HEADER + """call :title "MK8DX Tournament Analysis"
set "MK8DX_TOURNAMENT_ASSETS_ROOT=%PKG_ROOT%runtime-assets\\recorded\\assets"
set "MK8DX_TOURNAMENT_REFERENCE_ROOT=%PKG_ROOT%runtime-assets\\recorded"
set "MK8DX_TOURNAMENT_ENGINE_DATA_ROOT=%PKG_ROOT%runtime-assets\\recorded"
set "MK8_CLEAN_ASSETS_ROOT=%PKG_ROOT%runtime-assets\\clean-assets"
set "EASYOCR_MODULE_PATH=%PKG_ROOT%runtime-assets\\ocr-models"
call :say "Starting the Tournament Analysis window ... (this window shows startup errors)"
"%PYTHON%" -m tournament_processor.gui %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo.
    call :say "Tournament Analysis exited with code {0}." "%RESULT%"
    pause
)
exit /b %RESULT%
""" + LAUNCHER_FOOTER

LIVE_CMD = LAUNCHER_HEADER + """call :title "MK8DX Tournament Live"
if not exist "%MK8DX_TOURNAMENT_LIVE_ROOT%" mkdir "%MK8DX_TOURNAMENT_LIVE_ROOT%"
cd /d "%MK8DX_TOURNAMENT_LIVE_ROOT%"
call :say "Starting the Tournament Live GUI ... (this window shows startup progress and errors)"
"%PYTHON%" -m live_processor.run_gui %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo.
    call :say "Tournament Live exited with code {0}." "%RESULT%"
    pause
)
exit /b %RESULT%
""" + LAUNCHER_FOOTER

LIVE_CLI_CMD = LAUNCHER_HEADER + """call :title "MK8DX Tournament Live - command line"
if not exist "%MK8DX_TOURNAMENT_LIVE_ROOT%" mkdir "%MK8DX_TOURNAMENT_LIVE_ROOT%"
cd /d "%MK8DX_TOURNAMENT_LIVE_ROOT%"
if "%~1"=="" goto :usage
"%PYTHON%" -m live_processor.cli %*
exit /b %ERRORLEVEL%
:usage
call :say "MK8DX Tournament Live - command line. Sub-commands:"
"%PYTHON%" -m live_processor.cli --help
echo.
call :say "Examples (type them in this window):"
echo   "%PYTHON%" -m live_processor.cli dry-run
echo   "%PYTHON%" -m live_processor.cli capture-devices
echo   "%PYTHON%" -m live_processor.cli discover-fixtures
echo   "%PYTHON%" -m live_processor.cli replay --streams one
echo   "%PYTHON%" -m tournament_live.cli Current_Tournament_Results.csv --output Current_TournamentRaceResultsV1.json --session-id live-session-001
echo.
call :say "Running dry-run now to show where Tournament Live stores its files:"
"%PYTHON%" -m live_processor.cli dry-run
echo.
cmd /k
""" + LAUNCHER_FOOTER

CONNECT_CMD = LAUNCHER_HEADER + """call :title "MK8DX Tournament Connect - optional"
call :say "Optional browser sign-in uploads an existing JSON result as PENDING evidence."
call :say "Local processing and file exports never require sign-in or internet."
echo.
if "%~1"=="" goto :usage
"%PYTHON%" -m mk8dx_tournament_connected.cli %*
pause
exit /b %ERRORLEVEL%
:usage
call :say "First use: {0}" "TournamentConnect.cmd sign-in"
call :say "Send a result: {0}" "TournamentConnect.cmd send path\\to\\TournamentRaceResultsV1.json"
call :say "Sign out: {0}" "TournamentConnect.cmd sign-out"
echo.
cmd /k
""" + LAUNCHER_FOOTER

RUNTIME_ASSETS_README = """The live and recorded recognition variants and the
schema-9 display collection are bundled here. The launchers select their
respective variant. These files come from the release's checked collection.
Do not edit them in place; update the source collection and rebuild the package.
"""


def _log(log_path: Path | None, message: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}"
    print(line, flush=True)
    if log_path is not None:
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def _run(command: list[str], log_path: Path | None, env: dict | None = None, cwd: Path | None = None) -> int:
    _log(log_path, "run: " + " ".join(command))
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=str(cwd) if cwd else None,
    )
    assert process.stdout is not None
    with (log_path.open("a", encoding="utf-8") if log_path else open(os.devnull, "w")) as log_handle:
        for line in process.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            log_handle.write(line)
    return process.wait()


def _capture(command: list[str], env: dict | None = None, cwd: Path | None = None) -> tuple[int, str]:
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=str(cwd) if cwd else None,
    )
    return completed.returncode, completed.stdout


def _python() -> str:
    return sys.executable


def _launcher_text():
    """tools\\launcher_text.py and its catalogs tools\\launcher_i18n (the launcher windows' texts), or None."""
    tools = str(Path(__file__).resolve().parent)
    if tools not in sys.path:
        sys.path.insert(0, tools)
    try:
        import launcher_text
    except ImportError:
        return None
    return launcher_text


def _language() -> str:
    """The cmd launcher's choice (MK8DX_LAUNCHER_LANGUAGE), else MK8DX_TOURNAMENT_LANGUAGE unless auto, else the
    launcher rules (MK8DX_LANGUAGE, then the Windows display language)."""
    module = _launcher_text()
    if module is None:
        return "en"
    for name in ("MK8DX_LAUNCHER_LANGUAGE", "MK8DX_TOURNAMENT_LANGUAGE"):
        found = module.match(os.environ.get(name, ""))
        if found:
            return found
    return module.choose()


def _text(english: str, *values) -> str:
    """English is the key, as in the launcher windows; {0}, {1} are filled after the lookup."""
    module = _launcher_text()
    if module is not None:
        return module.t(english, *values, language=_language())
    for index, value in enumerate(values):
        english = english.replace("{%d}" % index, str(value))
    return english


def _relative_python(package_root: Path) -> str:
    try:
        return Path(sys.executable).resolve().relative_to(package_root.resolve()).as_posix()
    except ValueError:
        return sys.executable


def _write_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        return False
    path.write_text(content, encoding="utf-8", newline="\r\n")
    return True


def _load_torch_selector(package_root: Path):
    # This is copied from the shared package at build time: no dependencies are
    # needed yet, and installer/developer installs use one selection policy.
    # Embedded Python omits the script directory from sys.path. Load this file
    # explicitly instead of depending on the normal venv import path.
    import importlib.util
    spec = importlib.util.spec_from_file_location("_mk8dx_setup_torch", package_root / "tools" / "select_torch.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _torch_decision(package_root: Path, mode: str | None):
    if mode is None:
        mode = os.environ.get("MK8DX_TORCH_MODE")
    if not mode:
        state_path = package_root / "INSTALL_STATE.json"
        if state_path.is_file():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            mode = state.get("torchSelection", {}).get("requested_mode")
    return _load_torch_selector(package_root).select_torch_package(mode or "auto")


LAUNCHERS = {
    "TournamentProcessor.cmd": PROCESSOR_CMD,
    "TournamentAnalysis.cmd": ANALYSIS_CMD,
    "TournamentLive.cmd": LIVE_CMD,
    "TournamentLiveCli.cmd": LIVE_CLI_CMD,
    "TournamentConnect.cmd": CONNECT_CMD,
}


def write_launchers(package_root: Path) -> bool:
    """Write the launchers and, once, the settings file; True when the settings file was created.

    cmd.exe is only fully reliable with CRLF batch files.
    """
    for name, content in LAUNCHERS.items():
        (package_root / name).write_text(content, encoding="utf-8", newline="\r\n")
    return _write_if_missing(package_root / "TournamentTools.config.cmd", CONFIG_CMD)


def install(package_root: Path, python_kind: str, log_path: Path, torch_mode: str | None = None) -> int:
    wheels = package_root / "wheels"
    lock = package_root / "requirements.lock.txt"
    python = _python()
    _log(log_path, f"setup helper: package={package_root} python={python} kind={python_kind} version={PACKAGE_VERSION}")

    decision = _torch_decision(package_root, torch_mode)
    selection = json.loads(decision.to_json())
    (package_root / "INSTALL_STATE.json").write_text(
        json.dumps({"packageVersion": PACKAGE_VERSION, "torchSelection": selection, "ok": False}, indent=2) + "\n",
        encoding="utf-8",
    )
    _log(log_path, _text("PyTorch backend: {0}", decision.selected_mode))
    _log(log_path, decision.reason)
    for warning in decision.warnings:
        _log(log_path, warning)
    if decision.requires_manual_setup:
        return 2
    # Select exact local-version wheels first. The common closure's base-version
    # pins accept them, and install their locked dependencies in the next step.
    code = _run([python, "-m", "pip", "install", "--no-warn-script-location",
                 "--only-binary=:all:", "--no-deps", *decision.pip_args], log_path)
    if code != 0:
        _log(log_path, f"hardware-selected PyTorch install failed with exit code {code}")
        return code

    base = [python, "-m", "pip", "install", "--no-warn-script-location", "--only-binary=:all:",
            "--find-links", str(wheels), "-r", str(lock), "-c", str(lock)]
    code = _run(base + list(DISTRIBUTIONS), log_path)
    if code != 0:
        _log(log_path, f"pip install of the locked closure failed with exit code {code}")
        return code
    # Make sure the package's own wheels are what is installed, also on re-runs
    # that keep the same 0.1.0 version number.
    code = _run(
        [python, "-m", "pip", "install", "--no-warn-script-location", "--no-deps", "--no-index",
         "--force-reinstall", "--find-links", str(wheels)] + list(LOCAL_DISTRIBUTIONS),
        log_path,
    )
    if code != 0:
        _log(log_path, f"pip install of the package wheels failed with exit code {code}")
        return code

    created_config = write_launchers(package_root)
    if not (package_root / "runtime-assets/live/assets/templates").is_dir() or not (
        package_root / "runtime-assets/recorded/assets/templates").is_dir():
        _log(log_path, "bundled recognition assets are missing")
        return 3
    (package_root / "TournamentLive").mkdir(exist_ok=True)
    _log(log_path, "launchers written" + (" (settings file created)" if created_config else " (settings file kept)"))

    # Smoke checks: prove the installed entry points import and run.
    env = dict(os.environ)
    env["MK8DX_TOURNAMENT_LIVE_ROOT"] = str(package_root / "TournamentLive")
    checks = {}
    versions_code, versions_out = _capture([
        python, "-c",
        "import cv2, numpy, torch, torchvision, easyocr, PySide6, openpyxl, pandas, psutil; "
        "backend = 'cuda' if torch.cuda.is_available() else 'cpu'; "
        "assert torch.ones(1, device=backend).sum().item() == 1; "
        "import json; print(json.dumps({'cv2': cv2.__version__, 'numpy': numpy.__version__, "
        "'torch': torch.__version__, 'torchvision': torchvision.__version__, 'effectiveBackend': backend, "
        "'cuda': bool(torch.cuda.is_available()), 'easyocr': easyocr.__version__, 'psutil': psutil.__version__, "
        "'PySide6': PySide6.__version__, 'pandas': pandas.__version__}))",
    ])
    checks["imports"] = {"exitCode": versions_code, "output": versions_out.strip()[-2000:]}
    for name, command in (
        ("dependencyClosure", [python, "-m", "pip", "check"]),
        ("processorVideoHelp", [python, "-m", "tournament_processor.vision_cli", "--help"]),
        ("processorCsvHelp", [python, "-m", "tournament_processor.cli", "--help"]),
        ("processorAnalysisHelp", [python, "-m", "tournament_processor.gui", "--help"]),
        ("processorAnalysisQt", [python, "-c", "import tournament_processor.qt.main_window; print('qt ok')"]),
        ("liveCliDryRun", [python, "-m", "live_processor.cli", "dry-run"]),
        ("liveResultsHelp", [python, "-m", "tournament_live.cli", "--help"]),
        ("connectedHelp", [python, "-m", "mk8dx_tournament_connected.cli", "--help"]),
        # The Live GUI needs both Qt and tkinter (qt_app imports helpers from the tkinter module).
        ("liveGuiToolkit", [python, "-c", "import tkinter, PySide6.QtWidgets; print('tk', tkinter.TkVersion)"]),
        # Confirmation must stay self-contained in the installed wheel. This
        # catches accidental imports from repository-only validation scripts.
        (
            "liveConsensusRuntime",
            [
                python,
                "-c",
                "from live_processor.consensus_from_selected import "
                "build_track_metadata, load_selected_frames, pair_selected_frames, "
                "to_expected_tournament_rows, write_live_frame_bundles_from_selected; "
                "print('live consensus runtime ok')",
            ],
        ),
    ):
        code, output = _capture(command, env=env, cwd=package_root / "TournamentLive")
        checks[name] = {"exitCode": code, "output": output.strip()[-2000:]}
    failed = [name for name, item in checks.items() if item["exitCode"] != 0]
    for name, item in checks.items():
        _log(log_path, f"smoke {name}: exit {item['exitCode']}")
        if item["exitCode"] != 0:
            _log(log_path, item["output"])

    versions = {}
    if versions_code == 0:
        try:
            versions = json.loads(versions_out.strip().splitlines()[-1])
        except (ValueError, IndexError):
            versions = {}
    state = {
        "stateKind": "mk8dx.tournament-tools-install-state.v1",
        "packageVersion": PACKAGE_VERSION,
        "installedAtMs": int(time.time() * 1000),
        "pythonKind": python_kind,
        "pythonVersion": sys.version.split()[0],
        "pythonExecutable": _relative_python(package_root),
        "runtimeVersions": versions,
        "torchSelection": selection,
        "smokeChecks": {name: item["exitCode"] for name, item in checks.items()},
        "ok": not failed,
    }
    (package_root / "INSTALL_STATE.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    if failed:
        _log(log_path, "setup helper: smoke checks FAILED: " + ", ".join(failed))
        return 1
    _log(log_path, "setup helper: install complete; runtime " + json.dumps(versions))
    return 0


def _session_id(stem: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", stem).strip("-.") or "video"
    return f"{cleaned[:80]}-{time.strftime('%Y%m%d-%H%M%S')}"


def _stage_video(video: Path) -> tuple[Path, str]:
    """Return (runtime_root, video_name) with the video reachable under Input_Videos."""
    video = video.resolve()
    if video.parent.name.lower() == "input_videos":
        return video.parent.parent, video.name
    session_root = video.parent / f"{video.stem}_TournamentSession"
    input_dir = session_root / "Input_Videos"
    input_dir.mkdir(parents=True, exist_ok=True)
    staged = input_dir / video.name
    if staged.exists():
        return session_root, video.name
    try:
        os.link(video, staged)  # hard link: instant, no extra disk, same volume only
        print(_text("Linked the video into {0}", input_dir))
    except OSError:
        print(_text("Copying the video into {0} (different drive; this can take a while) ...",
                    input_dir))
        shutil.copy2(video, staged)
    return session_root, video.name


def process_video(package_root: Path, target: Path) -> int:
    if not target.exists():
        print(_text("Not found: {0}", target))
        return 2
    if target.is_dir():
        runtime_root = target.parent if target.name.lower() == "input_videos" else target
        if not (runtime_root / "Input_Videos").is_dir():
            print(_text("{0} has no Input_Videos folder. Drop a video file or a session folder that contains "
                        "Input_Videos.", runtime_root))
            return 2
        video_name = None
        session_stem = runtime_root.name
    else:
        runtime_root, video_name = _stage_video(target)
        session_stem = target.stem
    # The recorded product uses its distinct, reviewed template variant.
    os.environ["MK8DX_TOURNAMENT_ASSETS_ROOT"] = str(package_root / "runtime-assets/recorded/assets")
    os.environ["MK8DX_TOURNAMENT_REFERENCE_ROOT"] = str(package_root / "runtime-assets/recorded")
    os.environ["MK8DX_TOURNAMENT_ENGINE_DATA_ROOT"] = str(package_root / "runtime-assets/recorded")
    os.environ["MK8_CLEAN_ASSETS_ROOT"] = str(package_root / "runtime-assets/clean-assets")
    os.environ["EASYOCR_MODULE_PATH"] = str(package_root / "runtime-assets/ocr-models")
    missing = []
    for label, key in (
        (_text("recognition images"), "MK8DX_TOURNAMENT_ASSETS_ROOT"),
        (_text("game data"), "MK8DX_TOURNAMENT_REFERENCE_ROOT"),
    ):
        value = os.environ.get(key)
        if not value or not Path(value).is_dir():
            absent = _text("not set")
            missing.append(f"  {label}: {key}={value or f'({absent})'}")
    if missing:
        print(_text("The bundled recognition assets are missing:"))
        print("\n".join(missing))
        print(_text("Re-extract the complete package and verify PACKAGE_MANIFEST.json."))
        print(_text("Then drop the video again."))
        return 3
    session_id = _session_id(session_stem)
    arguments = ["all", "--runtime-root", str(runtime_root), "--session-id", session_id]
    if video_name:
        arguments += ["--video", video_name]
    print(_text("Session folder : {0}", runtime_root))
    print(_text("Session id     : {0}", session_id))
    print(_text("Output folder  : {0}", runtime_root / 'Output_Results'))
    print(_text("Processing the recording ..."))
    print(_text("(all EasyOCR models are included; no download needed, this works offline)"))
    from tournament_processor.vision_cli import run

    code = run(arguments)
    if code == 0:
        print()
        print(_text("Results: {0}", runtime_root / 'Output_Results'))
        print(_text("  Excel, CSV and *_TournamentRaceResultsV1.json for website import"))
    return int(code or 0)


def usage(package_root: Path) -> int:
    print(_text("MK8DX Tournament Processor - recorded tournament video"))
    print()
    print(_text("Easiest use: drag a recorded tournament video (.mp4/.mkv) onto TournamentProcessor.cmd."))
    print(_text("A <video name>_TournamentSession folder is created next to the video."))
    print(_text("Results are written to Output_Results as Excel, CSV and a website import file."))
    print(_text("You can also drop a session folder that already has an Input_Videos sub-folder."))
    print()
    state_path = package_root / "INSTALL_STATE.json"
    if state_path.is_file():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            print(_text("Installed version: {0}", state.get('packageVersion')))
        except ValueError:
            pass
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="mk8dx_tools_setup")
    sub = parser.add_subparsers(dest="command", required=True)
    p_install = sub.add_parser("install")
    p_install.add_argument("--package-root", required=True)
    p_install.add_argument("--python-kind", required=True, choices=("embedded", "venv"))
    p_install.add_argument("--log", required=True)
    p_install.add_argument("--torch-mode", choices=("auto", "cuda", "cpu", "rocm-experimental", "mps-experimental"),
                           help="Override hardware selection; otherwise keep MK8DX_TORCH_MODE or the previous choice")
    p_video = sub.add_parser("process-video")
    p_video.add_argument("--package-root", required=True)
    p_video.add_argument("target")
    p_usage = sub.add_parser("usage")
    p_usage.add_argument("--package-root", required=True)
    args = parser.parse_args()
    package_root = Path(args.package_root).resolve()
    if args.command == "install":
        return install(package_root, args.python_kind, Path(args.log), args.torch_mode)
    if args.command == "process-video":
        return process_video(package_root, Path(args.target))
    return usage(package_root)


if __name__ == "__main__":
    raise SystemExit(main())
'''

README_FIRST = """MK8DX Tournament Tools - Windows package, version @@VERSION@@
==================================================================

What is in this folder
----------------------
  Install-MK8DX-TournamentTools.cmd   <- double-click this first
  README-FIRST.txt                    this file
  USING_MK8DX_TOURNAMENT_TOOLS.md     the full user guide (open with any text editor)
  wheels\\                             the MK8DX Tournament Processor / Live programs
  requirements.lock.txt               the exact third-party versions that get installed
  tools\\                              installer helper scripts
  PACKAGE_MANIFEST.json               file list with SHA-256 checksums

Install (once; internet needed)
-------------------------------
1. Extract the zip to a folder you own, for example C:\\MK8DX-TournamentTools\\
   (not inside Program Files, not on a network drive).
2. Double-click Install-MK8DX-TournamentTools.cmd and wait.
   - It uses the 64-bit Python 3.12 on your PC if there is one, otherwise it
     downloads the official python.org runtime (11 MB) plus its Tcl/Tk add-on
     (3.5 MB, needed by the Live GUI) and verifies both by SHA-256.
   - It selects NVIDIA CUDA or CPU PyTorch for this computer, then downloads
     the recognition stack from PyTorch/PyPI into runtime\\ (several GB for CUDA).
     Download and installation time depend on the connection and computer.
   - Nothing is installed outside this folder. No administrator rights needed.
3. When it prints SUCCESS, the launchers appear in this folder:
     TournamentProcessor.cmd   recorded-video extraction (drag a video onto it)
     TournamentAnalysis.cmd    window to analyse recordings afterwards (videos or folders)
     TournamentLive.cmd        live capture-card tournament GUI
     TournamentLiveCli.cmd     live tools command line
     TournamentConnect.cmd     optional connection to the website (sign in, send results)
4. The package already contains the live and recorded recognition assets.
   Keep runtime-assets\\ with the launchers.

Use
---
  Recorded video : drag the .mp4/.mkv onto TournamentProcessor.cmd. Results are
                   written next to the video in <name>_TournamentSession\\Output_Results\\
                   (Excel + CSV + *_TournamentRaceResultsV1.json).
  Afterwards     : no Tournament Live on the night? Double-click TournamentAnalysis.cmd,
                   add the videos or a folder per tournament, then Start analysis.
  Live tournament: connect the capture card, double-click TournamentLive.cmd.
  Website import : Administration -> Tournaments -> Import canonical race results,
                   or inside a tournament group "Import races from a Processor / Live file",
                   and pick the *_TournamentRaceResultsV1.json file.

Update
------
  Extract the newer zip over this folder (or into a new folder) and run the
  installer again. Finished downloads are reused; your settings file
  TournamentTools.config.cmd and operator session folders are kept.

Known limitations
-----------------
  - Internet is needed for the install only. All OCR models are included
    (runtime-assets\\ocr-models\\), so after the install processing works
    offline.
  - Tournament Live needs a capture card / video device visible to Windows.
  - If a tool stops with "DLL load failed" install the Microsoft Visual C++
    Redistributable 2015-2022 (x64) from Microsoft and retry.
  - install.log in this folder records everything the installer did.
"""


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", required=True, help="Package folder to create (must not exist)")
    parser.add_argument("--version", default="1", help="Package version recorded in the manifest")
    parser.add_argument("--python", default=sys.executable, help="Python used to build the wheels")
    parser.add_argument("--no-zip", action="store_true", help="Do not write <output>.zip")
    return parser.parse_args()


def _project_version(project: Path) -> str:
    for line in (project / "pyproject.toml").read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("version"):
            return stripped.split("=", 1)[1].strip().strip('"')
    raise BuildError(f"no version in {project / 'pyproject.toml'}")


def _build_wheels(python: str, wheels_dir: Path) -> list[Path]:
    wheels_dir.mkdir(parents=True)
    for project in PROJECTS:
        if not (project / "pyproject.toml").is_file():
            raise BuildError(f"missing project: {project}")
        # setuptools reuses an existing build/lib, so a module deleted from src/ would still ship
        # (2.2.35-local carried tournament_live/final_export.py, removed in c4d4a63b). The folder
        # is generated and ignored by Git; start every package from the source alone.
        stale = project / "build"
        if stale.is_dir():
            shutil.rmtree(stale)
        command = [python, "-m", "pip", "wheel", "--no-deps", "--no-cache-dir", "-q",
                   "--wheel-dir", str(wheels_dir), str(project)]
        result = subprocess.run(command, check=False)
        if result.returncode != 0:
            raise BuildError(f"pip wheel failed for {project}")
    wheels = sorted(wheels_dir.glob("*.whl"))
    if len(wheels) != len(PROJECTS):
        raise BuildError(f"expected {len(PROJECTS)} wheels, found {[w.name for w in wheels]}")
    return wheels


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest(root: Path, version: str, wheels: list[Path], versions: dict[str, str]) -> dict:
    files = []
    total = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "PACKAGE_MANIFEST.json":
            continue
        size = path.stat().st_size
        total += size
        files.append({"path": path.relative_to(root).as_posix(), "bytes": size, "sha256": _sha256(path)})
    return {
        "manifestKind": MANIFEST_KIND,
        "version": version,
        "builtAtMs": int(time.time() * 1000),
        "productVersions": versions,
        "wheels": [wheel.name for wheel in wheels],
        "pythonRuntime": {
            "kind": "python.org embeddable (downloaded by the installer when no 64-bit Python 3.12 exists)",
            "version": PYTHON_EMBED_VERSION,
            "url": PYTHON_EMBED_URL,
            "sha256": PYTHON_EMBED_SHA256,
            "md5OnPythonOrgReleasePage": PYTHON_EMBED_MD5_ON_PYTHON_ORG,
        },
        "tclTk": {
            "kind": "python.org tcltk.msi added to the embedded runtime for the Tournament Live GUI (tkinter)",
            "url": TCLTK_URL,
            "sha256": TCLTK_SHA256,
        },
        "pipBootstrap": GET_PIP_URL,
        "thirdPartyRequirements": "requirements.lock.txt plus tools/select_torch.py (PyPI and official PyTorch index; not bundled)",
        "fileCount": len(files),
        "totalBytes": total,
        "files": files,
    }


def _zip(root: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, (Path(root.name) / path.relative_to(root)).as_posix())


def main() -> int:
    arguments = _arguments()
    output = Path(arguments.output).resolve()
    if output.exists():
        raise BuildError(f"{output} already exists; packages are never overwritten")
    if not LOCK_FILE.is_file():
        raise BuildError(f"missing lock file: {LOCK_FILE}")
    for guide in (USER_GUIDE, LIVE_LAPTOP_GUIDE, PROCESSOR_FALLBACK_GUIDE):
        if not guide.is_file():
            raise BuildError(f"missing user guide: {guide}")
    versions = {
        "mk8dx-tournament-connected": _project_version(PROJECTS[0]),
        "mk8dx-tournament-extraction": _project_version(PROJECTS[1]),
        "mk8dx-tournament-processor": _project_version(PROJECTS[2]),
        "mk8dx-tournament-live": _project_version(PROJECTS[3]),
        "mk8dx-icon-matcher": _project_version(PROJECTS[4]),
    }
    tokens = {
        "@@VERSION@@": arguments.version,
        "@@PYTHON_EMBED_URL@@": PYTHON_EMBED_URL,
        "@@PYTHON_EMBED_SHA256@@": PYTHON_EMBED_SHA256,
        "@@PYTHON_EMBED_FILENAME@@": PYTHON_EMBED_FILENAME,
        "@@GET_PIP_URL@@": GET_PIP_URL,
        "@@TCLTK_URL@@": TCLTK_URL,
        "@@TCLTK_SHA256@@": TCLTK_SHA256,
        "@@CONNECTED_VERSION@@": versions["mk8dx-tournament-connected"],
        "@@EXTRACTION_VERSION@@": versions["mk8dx-tournament-extraction"],
        "@@PROCESSOR_VERSION@@": versions["mk8dx-tournament-processor"],
        "@@LIVE_VERSION@@": versions["mk8dx-tournament-live"],
        "@@ICON_MATCHER_VERSION@@": versions["mk8dx-icon-matcher"],
    }

    def render(template: str) -> str:
        for token, value in tokens.items():
            template = template.replace(token, value)
        if "@@" in template:
            raise BuildError("unsubstituted token in package template")
        return template

    output.mkdir(parents=True)
    try:
        wheels = _build_wheels(arguments.python, output / "wheels")
        shutil.copy2(LOCK_FILE, output / "requirements.lock.txt")
        shutil.copy2(USER_GUIDE, output / USER_GUIDE.name)
        shutil.copy2(LIVE_LAPTOP_GUIDE, output / LIVE_LAPTOP_GUIDE.name)
        shutil.copy2(PROCESSOR_FALLBACK_GUIDE, output / PROCESSOR_FALLBACK_GUIDE.name)
        for name in ("LICENSE", "LICENSE_SCOPE.md", "SOURCE_FOR_BINARIES.txt"):
            shutil.copy2(REPOSITORY_ROOT / name, output / name)
        notice = output / "docs" / "THIRD_PARTY_MATERIALS.md"
        notice.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPOSITORY_ROOT / "docs/THIRD_PARTY_MATERIALS.md", notice)
        assets = output / "runtime-assets"
        for group, relative in (("legacy-live", "live"), ("tournament", "recorded"),
                                ("schema9", "clean-assets"), ("ocr-models", "ocr-models"),
                                ("tournament-text", "live"), ("tournament-text", "recorded")):
            subprocess.run(["node", str(COLLECTION_MATERIALIZER), group,
                            str(assets / relative)], cwd=REPOSITORY_ROOT, check=True)
        subprocess.run([sys.executable, str(MODEL_DOWNLOADER), "stage", "--group", "ocr-models",
                        "--output", str(assets / "ocr-models")], cwd=REPOSITORY_ROOT, check=True)
        # The Live replay/recognition code reads this catalog at the reference
        # root, while the reviewed collection keeps it in its original
        # baseline_extractor layout. Ship that same reviewed file at both
        # locations so a fresh package needs no private staging folder.
        live_catalog = assets / "live/live_processor/baseline_extractor/reference_data/game_catalog.json"
        if not live_catalog.is_file():
            raise BuildError("reviewed Live game catalog is missing")
        live_catalog_target = assets / "live/reference_data/game_catalog.json"
        live_catalog_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(live_catalog, live_catalog_target)
        tools = output / "tools"
        tools.mkdir()
        (tools / "check_python.py").write_text(CHECK_PYTHON_PY, encoding="utf-8")
        shutil.copy2(TORCH_SELECTOR, tools / "select_torch.py")
        (tools / "mk8dx_tools_setup.py").write_text(render(SETUP_HELPER_PY), encoding="utf-8")
        # The texts of the installer, the launchers and the setup helper in the 15 game languages: the launcher
        # windows' mechanism (tooling/launcher_text.py, tooling/mk8dx-ui.ps1, tooling/launcher_i18n).
        for name in LAUNCHER_TEXT_FILES:
            shutil.copy2(REPOSITORY_ROOT / "tooling" / name, tools / name)
        (tools / "launcher_i18n").mkdir()
        for catalog in sorted((REPOSITORY_ROOT / "tooling" / "launcher_i18n").glob("*.json")):
            shutil.copy2(catalog, tools / "launcher_i18n" / catalog.name)
        # Batch files must be CRLF and plain ASCII-safe for cmd.exe.
        installer = render(INSTALLER_CMD).replace("\r\n", "\n").replace("\n", "\r\n")
        (output / "Install-MK8DX-TournamentTools.cmd").write_bytes(installer.encode("ascii"))
        (output / "README-FIRST.txt").write_text(render(README_FIRST).replace("\n", "\r\n"), encoding="utf-8")
        manifest = _manifest(output, arguments.version, wheels, versions)
        # The shared field reader's catalog is the bundled collection's schema-9 group (Clean Assets).
        manifest["sharedIconCatalogSha256"] = _sha256(assets / "clean-assets" / "database.json")
        (output / "PACKAGE_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise

    report = {
        "package": str(output),
        "version": arguments.version,
        "fileCount": manifest["fileCount"] + 1,
        "totalBytes": manifest["totalBytes"] + (output / "PACKAGE_MANIFEST.json").stat().st_size,
        "wheels": manifest["wheels"],
    }
    if not arguments.no_zip:
        zip_path = output.parent / f"{output.name}.zip"
        if zip_path.exists():
            raise BuildError(f"{zip_path} already exists; packages are never overwritten")
        _zip(output, zip_path)
        report["zip"] = {"path": str(zip_path), "bytes": zip_path.stat().st_size, "sha256": _sha256(zip_path)}
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as error:
        print(f"Tournament tools package build failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
