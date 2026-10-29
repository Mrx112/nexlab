param(
    [string]$BootstrapPath,
    [string]$ArchivePath,
    [string]$ChecksumPath,
    [string]$TargetDirectory
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$releaseBase = 'https://github.com/Mrx112/nexlab/releases/latest/download'
$archiveName = 'NexLab-Windows-x64.zip'
$checksumName = 'NexLab-SHA256SUMS.txt'
$installDirectory = if ($TargetDirectory) { $TargetDirectory } else { Join-Path $env:LOCALAPPDATA 'Programs\NexLab' }
$dataDirectory = Join-Path $env:LOCALAPPDATA 'NexLab\data'
$running = Get-Process -Name NexLab -ErrorAction SilentlyContinue
if ($running) {
    throw 'Tutup NexLab terlebih dahulu sebelum menginstal atau memperbarui aplikasi.'
}

$workDirectory = Join-Path ([IO.Path]::GetTempPath()) ('NexLab-Install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDirectory | Out-Null
$installed = $false

try {
    if (-not $ArchivePath) {
        $ArchivePath = Join-Path $workDirectory $archiveName
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$archiveName" -OutFile $ArchivePath
    }
    if (-not $ChecksumPath) {
        $ChecksumPath = Join-Path $workDirectory $checksumName
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$checksumName" -OutFile $ChecksumPath
    }

    $checksumLine = Get-Content -LiteralPath $ChecksumPath |
        Where-Object { $_ -match ('^\s*([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($archiveName) + '\s*$') } |
        Select-Object -First 1
    if (-not $checksumLine -or $checksumLine -notmatch '^\s*([0-9a-fA-F]{64})\s+') {
        throw "SHA-256 tidak ditemukan untuk $archiveName. File tidak akan dipasang."
    }

    $expectedHash = $Matches[1].ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
        throw 'Verifikasi SHA-256 gagal. Arsip tidak aman untuk dipasang.'
    }

    $stagingDirectory = Join-Path $workDirectory 'staging'
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $stagingDirectory
    $sourceExecutable = Join-Path $stagingDirectory 'NexLab.exe'
    if (-not (Test-Path -LiteralPath $sourceExecutable)) {
        throw 'Arsip rilis terverifikasi tidak berisi NexLab.exe.'
    }

    $backupDirectory = Join-Path $workDirectory 'previous-install'
    if (Test-Path -LiteralPath $installDirectory) {
        Move-Item -LiteralPath $installDirectory -Destination $backupDirectory
    }

    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $installDirectory) -Force | Out-Null
        Move-Item -LiteralPath $stagingDirectory -Destination $installDirectory
    }
    catch {
        if (Test-Path -LiteralPath $backupDirectory) {
            Move-Item -LiteralPath $backupDirectory -Destination $installDirectory
        }
        throw
    }

    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $installDirectory 'Update') -Force | Out-Null
    $executablePath = Join-Path $installDirectory 'NexLab.exe'
    $arguments = '--open --data "' + $dataDirectory + '"'
    $shell = New-Object -ComObject WScript.Shell
    foreach ($shortcutPath in @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'NexLab.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\NexLab.lnk')
    )) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $shortcutPath) -Force | Out-Null
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $executablePath
        $shortcut.Arguments = $arguments
        $shortcut.WorkingDirectory = $installDirectory
        $shortcut.Description = 'NexLab Network Emulator Lab'
        $shortcut.Save()
    }

    $installed = $true
    Write-Host 'NexLab berhasil dipasang. Database dan lab pengguna berada di folder data NexLab dan tetap aman saat pembaruan.'
    Start-Process -FilePath $executablePath -ArgumentList $arguments -WorkingDirectory $installDirectory
}
finally {
    if ($installed) {
        Remove-Item -LiteralPath $workDirectory -Recurse -Force
        if ($BootstrapPath -and (Test-Path -LiteralPath $BootstrapPath)) {
            Remove-Item -LiteralPath $BootstrapPath -Force -ErrorAction SilentlyContinue
        }
    }
    else {
        Write-Warning "File instalasi sementara disimpan untuk diagnosis: $workDirectory"
        if ($BootstrapPath) {
            Write-Warning "Bootstrap installer: $BootstrapPath"
        }
    }
}
