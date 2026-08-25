@echo off
setlocal
title QuixPOS2JTL Server (CLI)

set "APP_DIR=%~dp0"
set "EXE=%APP_DIR%QuixPOS2JTL.exe"
set "SERVER_JS=%APP_DIR%resources\app.asar.unpacked\src\service\server.js"

if not exist "%SERVER_JS%" (
    set "SERVER_JS=%APP_DIR%resources\app.asar\src\service\server.js"
)

if not exist "%EXE%" (
    echo [ERROR] QuixPOS2JTL executable not found at: "%EXE%"
    pause
    exit /b 1
)

set ELECTRON_RUN_AS_NODE=1
"%EXE%" "%SERVER_JS%" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [QuixPOS2JTL] Server exited with code %ERRORLEVEL%.
    pause
)
endlocal
