@echo off
color 0a
title AiderWeb Advanced

echo ===================================================
echo   STARTING AIDERWEB ADVANCED (Production Mode)
echo ===================================================
echo.

if not exist "backend\venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found! 
    echo Please run INSTALL.bat first.
    pause
    goto :eof
)

:: Enable Docker sandbox execution if desired (set to true to run AI commands in Docker)
set USE_DOCKER_SANDBOX=false

echo Starting FastAPI Backend...
cd backend
"%CD%\venv\Scripts\python.exe" main.py

pause
