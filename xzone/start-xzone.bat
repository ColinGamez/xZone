@echo off
title Xzone Backend
color 0A
echo.
echo  ================================================
echo    XZONE BACKEND SERVER
echo    Xbox 360 Social Hub for Proto/FreeSTEALTH
echo  ================================================
echo.

cd /d "%~dp0"

:: Check if npm packages are installed (pure JS - no native build needed)
if not exist "node_modules\sql.js" (
    echo  [*] Installing dependencies...
    echo.
    if exist "node_modules" rmdir /s /q "node_modules"
    call npm install
    if errorlevel 1 (
        echo.
        echo  [!] npm install failed. Make sure Node.js is installed.
        pause
        exit /b 1
    )
    echo.
)

:: Get this machine's LAN IP and write it to a temp file
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127|^169' } | Select-Object -ExpandProperty IPAddress | Select-Object -First 1 | Out-File '%TEMP%\xzone_ip.txt' -Encoding ASCII -NoNewline"

:: Read the IP
set /p MYIP=<"%TEMP%\xzone_ip.txt"

echo  [*] Your LAN IP: %MYIP%
echo  [*] Starting Xzone server on %MYIP%:3000
echo.
echo  ------------------------------------------------
echo   Dashboard: http://%MYIP%:3000/dashboard
echo   Backend:   http://%MYIP%:3000
echo   Stats:     http://%MYIP%:3000/stats
echo  ------------------------------------------------
echo.
echo  Open the Dashboard URL in a browser and you're live.
echo  If you host the HTML elsewhere, enter %MYIP% in setup.
echo.
echo  Press Ctrl+C to stop the server.
echo.

node server.js

pause
