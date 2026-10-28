@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title NexLab - Instalasi Windows
cd /d "%~dp0..\.."
echo.
echo  ===== NexLab : instalasi untuk Windows =====
echo.

rem ---- cari Python 3.9+
set "PY="
where py >nul 2>nul && (py -3 -c "import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul && set "PY=py -3")
if not defined PY (
  where python >nul 2>nul && (python -c "import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul && set "PY=python")
)
if not defined PY (
  echo  Python 3.9+ belum terpasang.
  where winget >nul 2>nul
  if !errorlevel! equ 0 (
    choice /m " Pasang Python 3.12 sekarang lewat winget"
    if !errorlevel! equ 1 (
      winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
      echo.
      echo  Python terpasang. TUTUP jendela ini lalu jalankan install-windows.bat sekali lagi.
      pause
      exit /b 0
    )
  )
  echo  Unduh Python dari https://www.python.org/downloads/ dan centang "Add python.exe to PATH".
  pause
  exit /b 1
)
echo  [1/4] Python ditemukan: %PY%

echo  [2/4] Membuat virtualenv .venv ...
%PY% -m venv .venv || (echo  Gagal membuat venv & pause & exit /b 1)
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
echo  [3/4] Memasang dependensi (aiohttp, asyncssh) ...
".venv\Scripts\python.exe" -m pip install -r requirements.txt || (echo  Gagal pip install & pause & exit /b 1)
if not exist "data\images\qemu" mkdir "data\images\qemu"

echo  [4/4] Opsi tambahan
where qemu-system-x86_64 >nul 2>nul
if !errorlevel! neq 0 if not exist "C:\Program Files\qemu\qemu-system-x86_64.exe" (
  where winget >nul 2>nul
  if !errorlevel! equ 0 (
    choice /m " Pasang QEMU (untuk node VM image asli: vIOS, MikroTik CHR, VyOS, dll)"
    if !errorlevel! equ 1 winget install -e --id SoftwareFreedomConservancy.QEMU --accept-package-agreements --accept-source-agreements
  )
)
choice /m " Jalankan NexLab otomatis saat login Windows"
if !errorlevel! equ 1 (
  schtasks /create /f /tn "NexLab" /sc onlogon /rl limited /tr "\"%~dp0..\..\start-windows.bat\" --no-browser" >nul && echo  Tugas terjadwal "NexLab" dibuat.
)
echo.
echo  Agar bisa dibuka dari komputer lain, izinkan port di Windows Firewall:
echo    klik kanan scripts\firewall-windows.bat ^> Run as administrator
echo.
echo  Selesai. Jalankan NexLab dengan klik ganda: start-windows.bat
echo.
pause
