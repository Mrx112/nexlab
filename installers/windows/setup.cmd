@echo off
setlocal
title NexLab Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $base='https://github.com/Mrx112/nexlab/releases/latest/download'; $name='NexLab-Install-Windows.ps1'; $bootstrap=Join-Path $env:TEMP ('NexLab-Setup-'+[guid]::NewGuid().ToString('N')+'.ps1'); $checks=Join-Path $env:TEMP ('NexLab-Checksums-'+[guid]::NewGuid().ToString('N')+'.txt'); try { Invoke-WebRequest -UseBasicParsing -Uri ($base+'/'+$name) -OutFile $bootstrap; Invoke-WebRequest -UseBasicParsing -Uri ($base+'/NexLab-SHA256SUMS.txt') -OutFile $checks; $line=Get-Content -LiteralPath $checks | Where-Object { $_ -match ('^\s*([0-9a-fA-F]{64})\s+\*?'+[regex]::Escape($name)+'\s*$') } | Select-Object -First 1; if (-not $line -or $line -notmatch '^\s*([0-9a-fA-F]{64})\s+') { throw 'Installer SHA-256 is missing.' }; if ((Get-FileHash -LiteralPath $bootstrap -Algorithm SHA256).Hash -ne $Matches[1].ToUpperInvariant()) { throw 'Installer SHA-256 verification failed.' }; & $bootstrap -BootstrapPath $bootstrap; if (-not (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\NexLab\NexLab.exe'))) { exit 1 } } catch { Write-Host ('NexLab installation failed: '+$_.Exception.Message) -ForegroundColor Red; if (Test-Path $bootstrap) { Write-Host ('Installer diagnostics retained at: '+$bootstrap) }; exit 1 } finally { Remove-Item -LiteralPath $checks -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 (
  echo.
  echo Installation failed. See the error above. The downloaded installer was retained for troubleshooting.
  pause
  exit /b 1
)
echo.
echo NexLab is installed. A desktop shortcut has been created.
timeout /t 2 >nul
