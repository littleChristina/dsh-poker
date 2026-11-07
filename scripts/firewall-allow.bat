@echo off
chcp 65001 >nul
title 德州扑克 · 放行防火墙端口
net session >nul 2>&1
if errorlevel 1 (
  echo 需要管理员权限：请右键本文件，选择“以管理员身份运行”。
  pause
  exit /b 1
)
echo 正在放行 TCP 3000 端口（局域网/虚拟局域网入站）...
netsh advfirewall firewall delete rule name="DSH Poker 3000" >nul 2>&1
netsh advfirewall firewall add rule name="DSH Poker 3000" dir=in action=allow protocol=TCP localport=3000
if errorlevel 1 (
  echo 放行失败，请手动在 Windows 防火墙中允许 node.exe。
) else (
  echo 已放行 TCP 3000。若改了端口，请把脚本里的 localport=3000 一起改掉。
)
pause
