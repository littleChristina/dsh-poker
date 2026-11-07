@echo off
chcp 65001 >nul
title dsh-poker server
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js not found. Please install Node.js 18 or newer:
  echo   https://nodejs.org/
  echo After installing, close this window and run start.bat again.
  echo.
  pause
  exit /b 1
)

node server/index.js %*
if errorlevel 1 (
  echo.
  echo The server exited. Press any key to close this window...
  pause >nul
)
