@echo off
title Afterglow Register Frontend Setup
cd /d "%~dp0"
echo ================================================
echo Afterglow Register Frontend
echo Runs on: http://localhost:5180
echo Backend must run on: http://localhost:5000
echo ================================================
echo.
echo Setting public npm registry...
npm config set registry https://registry.npmjs.org/
echo.
echo Installing packages...
npm install --registry=https://registry.npmjs.org/
if %errorlevel% neq 0 (
  echo.
  echo Installation failed. Check your internet connection and Node.js.
  pause
  exit /b %errorlevel%
)
echo.
echo Starting frontend...
npm run dev
pause
