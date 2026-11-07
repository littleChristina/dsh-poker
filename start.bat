@echo off
chcp 65001 >nul
title 德州扑克 · 局域网服务器
cd /d "%~dp0"
node server/index.js %*
if errorlevel 1 (
  echo.
  echo 服务器已退出，按任意键关闭窗口...
  pause >nul
)
