@echo off
REM ═══════════════════════════════════════════════════════════════════════════
REM  client-windows.bat  —  Connect a Windows client to printershare
REM
REM  Usage: Double-click, or in an Admin command prompt:
REM           client-windows.bat <SERVER_IP>
REM ═══════════════════════════════════════════════════════════════════════════
setlocal EnableDelayedExpansion

if "%~1"=="" (
    set /p SERVER_IP="Enter server IP address: "
) else (
    set SERVER_IP=%~1
)

:MENU
cls
echo.
echo  printershare Client  ^|  Server: %SERVER_IP%
echo  ──────────────────────────────────────────────
echo   1. Map Samba share as drive Z:
echo   2. Add IPP network printer
echo   3. USB/IP instructions
echo   4. Open Scanner web UI in browser
echo   Q. Quit
echo.
set /p CHOICE="Choice: "

if /i "%CHOICE%"=="1" goto SMB
if /i "%CHOICE%"=="2" goto PRINTER
if /i "%CHOICE%"=="3" goto USBIP
if /i "%CHOICE%"=="4" goto BROWSER
if /i "%CHOICE%"=="Q" goto END
goto MENU

:SMB
echo.
set /p SMB_USER="Samba username [scanner]: "
if "!SMB_USER!"=="" set SMB_USER=scanner
set /p SMB_PASS="Samba password [scanner123]: "
if "!SMB_PASS!"=="" set SMB_PASS=scanner123
net use Z: /delete >nul 2>&1
net use Z: "\\%SERVER_IP%\Scans" "!SMB_PASS!" /user:"!SMB_USER!" /persistent:yes
if %ERRORLEVEL%==0 ( echo =^> Drive Z: mapped. & explorer Z: ) else ( echo ERROR: check IP/credentials. )
pause & goto MENU

:PRINTER
echo.
echo =^> Adding IPP printer via PowerShell...
powershell -NoProfile -Command ^
  "$name = Read-Host 'CUPS printer queue name (see http://%SERVER_IP%:631/printers/)'; " ^
  "Add-Printer -Name \"PS-$name\" -DriverName 'Microsoft IPP Class Driver' " ^
  "            -PortName \"PS-$name\" -ConnectionName \"http://%SERVER_IP%:631/printers/$name\" -ErrorAction Stop; " ^
  "Write-Host \"Printer 'PS-$name' added.\""
pause & goto MENU

:USBIP
echo.
echo  USB/IP — Two options:
echo  1. usbipkit (GUI)  https://usbipkit.com
echo     Enter server: %SERVER_IP%  then click Attach.
echo.
echo  2. usbip-win (CLI) https://github.com/cezanne/usbip-win/releases
echo     usbip.exe list -r %SERVER_IP%
echo     usbip.exe attach -r %SERVER_IP% -b ^<busid^>
echo.
pause & goto MENU

:BROWSER
start "" "http://%SERVER_IP%/"
goto MENU

:END
endlocal
exit /b 0
