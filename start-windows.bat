@echo off
chcp 65001 >nul
title NexLab Server
cd /d "%~dp0"
set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" (
  where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
)
set "OPEN=--open"
if /i "%~1"=="--no-browser" (set "OPEN=" & shift)
%PY% run.py %OPEN% %1 %2 %3 %4 %5 %6
if errorlevel 1 (
  echo.
  echo  NexLab berhenti dengan error. Sudah menjalankan install-windows.bat?
  pause
)
