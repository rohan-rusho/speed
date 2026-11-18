@echo off
title Local File Server
cd /d "%~dp0"
color 0b

echo =======================================================
echo                 Local File Server
echo =======================================================
echo.

if not exist node_modules\ (
    echo [INFO] First run detected. Installing dependencies...
    call npm install
    echo.
) else if not exist node_modules\qrcode\ (
    echo [INFO] New dependency detected (qrcode). Installing missing dependencies...
    call npm install
    echo.
)

echo Leave the input blank and press ENTER to use the
echo previously saved folder or setup via the Web UI.
echo.
set /p FOLDERPATH="Enter the folder path to share (e.g., D:\Movies): "

echo.
if "%FOLDERPATH%"=="" (
    echo Starting server with existing configuration...
    node server/index.js
) else (
    echo Starting server and sharing: "%FOLDERPATH%"
    node server/index.js "%FOLDERPATH%"
)

echo.
echo [INFO] Server stopped. If it closed right after starting, read the
echo [INFO] error message above — the most common cause is port 3001
echo [INFO] already being used by an old server still running.
echo [INFO] Close the old window, or stop node.exe in Task Manager.
echo.
pause
