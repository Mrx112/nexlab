@echo off
rem Izinkan akses NexLab dari komputer lain (jalankan sebagai Administrator)
net session >nul 2>&1 || (echo Klik kanan file ini lalu pilih "Run as administrator". & pause & exit /b 1)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8080"
netsh advfirewall firewall delete rule name="NexLab %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="NexLab %PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
echo Port TCP %PORT% diizinkan untuk jaringan Private/Domain.
echo Jika komputer terhubung ke jaringan "Public", ubah ke Private di Settings ^> Network.
pause
