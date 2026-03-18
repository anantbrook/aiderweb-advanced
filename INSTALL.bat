@echo off
color 0b
title AiderWeb Advanced Installer

echo ===================================================
echo   AIDERWEB ADVANCED - INSTALLER (With Codex Tools)
echo ===================================================
echo.

echo [1/4] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.10+ from python.org and check "Add to PATH".
    pause
    goto :eof
)

echo.
echo [2/4] Creating virtual environment...
if not exist "backend\venv" (
    py -m venv backend\venv
)

echo.
echo [3/4] Installing Python dependencies...
call backend\venv\Scripts\activate.bat
py -m pip install --upgrade pip
pip install -r backend\requirements.txt

echo.
echo [4/5] Installing Playwright Browsers (for AI Vision tools)...
python -m playwright install chromium

echo.
echo [5/5] Installing Frontend Dependencies...
cd frontend
call npm install
cd ..

echo.
echo ===================================================
echo   INSTALLATION COMPLETE!
echo ===================================================
echo You can now run START_AiderWeb.bat to launch the app.
pause
