@echo off
chcp 65001 >nul
title dsh-poker firewall
net session >nul 2>&1
if errorlevel 1 (
  echo Please run this file as Administrator:
  echo right-click firewall-allow.bat and choose "Run as administrator".
  pause
  exit /b 1
)
echo Allowing inbound TCP 3000 for dsh-poker...
netsh advfirewall firewall delete rule name="DSH Poker 3000" >nul 2>&1
netsh advfirewall firewall add rule name="DSH Poker 3000" dir=in action=allow protocol=TCP localport=3000
if errorlevel 1 (
  echo Failed. Please allow node.exe in Windows Firewall manually.
) else (
  echo TCP 3000 allowed. If you changed the port, update localport=3000 in this file.
)
pause
