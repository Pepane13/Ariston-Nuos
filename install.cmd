@echo off
rem ------------------------------------------------------------------------------------------
rem  Ariston Nuos - installs the app on your Homey Pro from a Windows PC.
rem
rem  Double-click this file (or run "install.cmd" from a command prompt). It runs in cmd, not
rem  PowerShell, so the PowerShell script execution policy ("running scripts is disabled on
rem  this system") cannot block the Homey CLI.
rem
rem  By default the app is installed straight from GitHub: the latest version of the main branch
rem  of https://github.com/Pepane13/Ariston-Nuos is downloaded (curl and tar, built into
rem  Windows 10 and 11, no git needed), unpacked in a temporary folder and installed on the
rem  Homey. install.cmd can therefore be run from any folder.
rem
rem  Options:  install.cmd          install the latest version from GitHub
rem            install.cmd local    install the local files next to install.cmd instead
rem
rem  Steps: Node.js check (24+), Homey CLI install or update, source download, then
rem  "homey app install" (with sign-in and Homey selection if needed).
rem  The app is meant for a local install only: it is not published to the Homey App Store.
rem ------------------------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"
title Ariston Nuos - install
set "MODE=%~1"
set "REPO=Pepane13/Ariston-Nuos"
set "BRANCH=main"
set "SRCDIR=%TEMP%\ariston-nuos-install"

rem ---------- 1. Node.js ----------
echo.
echo [1/4] Node.js
where node >nul 2>&1
if errorlevel 1 goto :nonode
set "NODEMAJ=0"
for /f "tokens=1 delims=v." %%m in ('node --version') do set "NODEMAJ=%%m"
for /f "delims=" %%v in ('node --version') do echo       Node.js %%v found
rem The current Homey CLI needs Node.js 24 or later
if %NODEMAJ% GEQ 24 goto :nodeok
echo       Node.js %NODEMAJ% is too old for the current Homey CLI ^(Node.js 24 or later needed^).
where winget >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Install the current Node.js LTS from https://nodejs.org then run install.cmd again.
  goto :fail
)
echo       Updating Node.js LTS with winget ...
winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo.
echo       Node.js updated: close this window and run install.cmd again.
goto :fail
:nodeok

rem ---------- 2. Homey CLI (installed or updated to the latest version) ----------
echo.
echo [2/4] Homey CLI
set "NPMG="
for /f "delims=" %%p in ('npm prefix -g 2^>nul') do set "NPMG=%%p"
if not defined NPMG set "NPMG=%APPDATA%\npm"
set "HOMEY=%NPMG%\homey.cmd"
echo       npm install -g homey@latest ...
call npm install -g homey@latest
if errorlevel 1 (
  if exist "%HOMEY%" (
    echo [WARNING] Update failed: the installed Homey CLI is used.
  ) else (
    echo [ERROR] npm could not install the Homey CLI.
    goto :fail
  )
)
if not exist "%HOMEY%" (
  echo [ERROR] Homey CLI installed but not found at "%HOMEY%".
  goto :fail
)
for /f "delims=" %%v in ('call "%HOMEY%" --version 2^>nul') do echo       Homey CLI %%v

rem ---------- 3. Source code ----------
echo.
echo [3/4] Source code
if /i "%MODE%"=="local" goto :localsrc
echo       Downloading the latest version from https://github.com/%REPO% ^(%BRANCH%^) ...
if exist "%SRCDIR%" rd /s /q "%SRCDIR%"
mkdir "%SRCDIR%" 2>nul
curl -fsSL --retry 2 -o "%SRCDIR%\source.zip" "https://github.com/%REPO%/archive/refs/heads/%BRANCH%.zip"
if errorlevel 1 (
  echo [WARNING] Download failed ^(no Internet access, or GitHub unreachable^).
  goto :localsrc
)
tar -xf "%SRCDIR%\source.zip" -C "%SRCDIR%"
if errorlevel 1 (
  echo [WARNING] Could not unpack the download.
  goto :localsrc
)
set "APPDIR="
for /d %%d in ("%SRCDIR%\*") do if exist "%%d\com.pepane13.ariston\app.json" set "APPDIR=%%d\com.pepane13.ariston"
if not defined APPDIR (
  echo [WARNING] The download does not contain the app.
  goto :localsrc
)
echo       Downloaded to %APPDIR%
goto :install

:localsrc
rem install.cmd can sit at the root of the repository or inside the app folder itself
set "APPDIR=%~dp0com.pepane13.ariston"
if exist "%~dp0app.json" set "APPDIR=%~dp0."
if not exist "%APPDIR%\app.json" (
  echo [ERROR] No app to install: the download failed and there is no local copy
  echo         ^(com.pepane13.ariston folder next to install.cmd^).
  goto :fail
)
echo       Local files are installed: %APPDIR%

rem ---------- 4. Install on the Homey ----------
:install
for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" "%APPDIR%\app.json"') do (
  set "APPVER=%%~v"
  goto :gotver
)
:gotver
echo.
echo [4/4] Installing Ariston Nuos %APPVER% on the Homey
pushd "%APPDIR%"
rem Files of version 1.0.x (automatic strategy) that 2.0.0 no longer uses
for %%f in (api.js lib\controller.js lib\home.js settings\index.html ..\test\controller.test.js) do if exist "%%f" (
  del /q "%%f"
  echo       Removed obsolete file %%f
)
rem An empty settings folder makes the Homey CLI require settings\index.html: remove it
if exist "settings" (
  rd /s /q "settings"
  if exist "settings" (
    echo [ERROR] Could not remove the folder "%CD%\settings" ^(OneDrive lock?^).
    echo         Delete it in Explorer, then run install.cmd again.
    goto :failpop
  )
  echo       Removed obsolete folder settings
)
if exist ".homeybuild" rd /s /q ".homeybuild"
echo       npm install ^(app dependencies^) ...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto :failpop
call "%HOMEY%" app install
if not errorlevel 1 goto :done

echo.
echo       Install failed. If the error above is about sign-in or the choice of Homey, sign in again;
echo       otherwise ^(validation error^) answer N and send the error message.
choice /C YN /N /M "      Sign in to your Athom account and retry? [Y/N] "
if errorlevel 2 goto :failpop
call "%HOMEY%" login
if errorlevel 1 goto :failpop
call "%HOMEY%" select
if errorlevel 1 goto :failpop
call "%HOMEY%" app install
if errorlevel 1 goto :failpop

:done
echo.
echo       Installed. New device: Homey app, Devices, +, Ariston Nuos.

:end
popd
echo.
echo ==========================================================================================
echo  Done.
echo ==========================================================================================
echo.
pause
exit /b 0

:nonode
echo       Node.js is not installed.
where winget >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Install Node.js LTS from https://nodejs.org then run install.cmd again.
  goto :fail
)
echo       Installing Node.js LTS with winget ...
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo.
echo       Node.js installed: close this window and run install.cmd again
echo       ^(a new window is needed for Windows to find node and npm^).
goto :fail

:failpop
popd
:fail
echo.
echo Not completed.
pause
exit /b 1
