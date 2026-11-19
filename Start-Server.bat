@echo off
title Local File Server
cd /d "%~dp0"
color 0b

echo =======================================================
echo                 Local File Server
echo =======================================================
echo.
echo [%DATE% %TIME%] Start-Server.bat started in %CD% > server-start.log
echo [LOG] Started at %DATE% %TIME% - folder: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 goto :NoNode

if not exist node_modules\express\ goto :NeedInstall
if not exist node_modules\qrcode\ goto :NeedInstall
if not exist node_modules\@tailwindcss\cli\ goto :NeedInstall
goto :CheckPort

:NeedInstall
echo [INFO] Installing dependencies...
echo [%DATE% %TIME%] Running npm install >> server-start.log
call npm install
echo.
goto :CheckPort

:NoNode
echo [ERROR] Node.js was not found on this PC.
echo [ERROR] Install Node.js from https://nodejs.org/ and run this file again.
echo [%DATE% %TIME%] ERROR: Node.js not found >> server-start.log
echo.
pause
exit /b 1

:CheckPort
netstat -ano | findstr /C:":3001 " | findstr "LISTENING" >nul
if errorlevel 1 goto :AskFolder
echo [WARNING] Port 3001 is already in use - another Speed server may still be running.
echo [WARNING] Close the old server window, or stop node.exe in Task Manager, then run this file again.
echo [%DATE% %TIME%] WARNING: port 3001 already in use >> server-start.log
echo.
pause
exit /b 1

:AskFolder
echo Leave the input blank and press ENTER to use the
echo previously saved folder or setup via the Web UI.
echo.
set /p FOLDERPATH="Enter the folder path to share (e.g., D:\Movies): "

echo.
if "%FOLDERPATH%"=="" echo Starting server with existing configuration...
if not "%FOLDERPATH%"=="" echo Starting server and sharing: "%FOLDERPATH%"
set NODE_ARGS=
if not "%FOLDERPATH%"=="" set NODE_ARGS="%FOLDERPATH%"
echo [%DATE% %TIME%] Starting node server/index.js %NODE_ARGS% >> server-start.log
node server/index.js %NODE_ARGS%
set NODE_EXIT=%ERRORLEVEL%
echo [%DATE% %TIME%] node exited with code %NODE_EXIT% >> server-start.log

echo.
echo [INFO] Server stopped. If it closed right after starting, read the
echo [INFO] error message above - the most common cause is port 3001
echo [INFO] already being used by an old server still running.
echo [INFO] Close the old window, or stop node.exe in Task Manager.
echo.
pause
exit /b 0
