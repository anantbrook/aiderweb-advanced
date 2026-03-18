@echo off
color 0e
title AiderWeb Advanced (Developer Mode)

echo ===================================================
echo   STARTING AIDERWEB ADVANCED (Developer Mode)
echo ===================================================
echo.

if not exist "backend\venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found!
    echo Please run INSTALL.bat first.
    pause
    goto :eof
)

:: Start Backend
echo [1/2] Starting Python Backend...
start cmd /k "title AiderWeb Backend && cd backend && "%CD%\venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

:: Start Frontend
echo [2/2] Starting React Frontend...
cd frontend
if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm install
)
start cmd /k "title AiderWeb Frontend && npm run dev"

echo.
echo Developer mode started!
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
pause
