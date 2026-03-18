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

python -c "import sys; print(sys.version_info.major, sys.version_info.minor)" > temp_py_ver.txt
set /p PY_VER=<temp_py_ver.txt
del temp_py_ver.txt

echo Detected Python Version: %PY_VER%
echo %PY_VER% | findstr /R /C:"3 13" /C:"3 14" >nul
if %errorlevel% equ 0 (
    echo [WARNING] Python 3.13 or 3.14 detected. Some packages like chromadb/tree-sitter might fail to compile natively.
    echo If installation fails, please install Python 3.12.
    echo Setting PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 to force Rust compilations.
    set PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1
)

echo.
echo [2/4] Creating virtual environment...
if not exist "backend\venv" (
    py -m venv backend\venv
)

echo.
echo [3/4] Installing Python dependencies...
"%CD%\backend\venv\Scripts\python.exe" -m pip install --upgrade pip
"%CD%\backend\venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    color 0c
    echo.
    echo ===================================================
    echo  [CRITICAL ERROR] Python dependencies failed to install!
    echo ===================================================
    echo This usually means your version of Python ^(%PY_VER%^) is too new and lacks pre-compiled wheels for certain packages.
    echo Please uninstall Python %PY_VER%, download Python 3.12 from python.org, delete the 'backendenv' folder, and run INSTALL.bat again.
    pause
    goto :eof
)

echo.
echo [4/5] Installing Playwright Browsers (for AI Vision tools)...
"%CD%\backend\venv\Scripts\python.exe" -m playwright install chromium
if %errorlevel% neq 0 (
    echo [WARNING] Playwright failed to install. The AI will still work, but <<<SCREENSHOT>>> tools might fail.
)

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
