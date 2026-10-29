param(
    [ValidateSet('installed', 'source')]
    [string]$Mode,
    [string]$AppDirectory,
    [string]$UpdateDirectory,
    [string]$ArchivePath,
    [string]$ArchiveHash,
    [int]$ProcessId,
    [string]$InstallScript,
    [string]$ChecksumPath
)

$ErrorActionPreference = 'Stop'
$logDirectory = Join-Path $env:LOCALAPPDATA 'NexLab\logs'
$logPath = Join-Path $logDirectory 'update.log'
$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('NexLab-Update-' + [guid]::NewGuid().ToString('N'))
$transcriptStarted = $false

try {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Start-Transcript -LiteralPath $logPath -Append | Out-Null
    $transcriptStarted = $true
    if ($ProcessId -gt 0) {
        Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
        throw 'Arsip update tidak ditemukan.'
    }
    $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $ArchiveHash.ToUpperInvariant()) {
        throw 'Verifikasi SHA-256 arsip update gagal.'
    }

    if ($Mode -eq 'installed') {
        if (-not (Test-Path -LiteralPath $InstallScript -PathType Leaf) -or
            -not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
            throw 'Berkas installer atau checksum tidak ditemukan.'
        }
        & $InstallScript -ArchivePath $ArchivePath -ChecksumPath $ChecksumPath -TargetDirectory $AppDirectory
        if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'NexLab.exe'))) {
            throw 'Installer tidak menghasilkan NexLab.exe.'
        }
    }
    else {
        New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $tempDirectory
        $sourceDirectory = Get-ChildItem -LiteralPath $tempDirectory -Directory | Select-Object -First 1
        if (-not $sourceDirectory -or
            -not (Test-Path -LiteralPath (Join-Path $sourceDirectory.FullName 'server\app.py')) -or
            -not (Test-Path -LiteralPath (Join-Path $sourceDirectory.FullName 'start-windows.bat'))) {
            throw 'Arsip source tidak berisi aplikasi NexLab yang valid.'
        }

        $excluded = @(
            (Join-Path $AppDirectory '.git'),
            (Join-Path $AppDirectory '.venv'),
            (Join-Path $AppDirectory 'data'),
            (Join-Path $AppDirectory 'Update'),
            (Join-Path $AppDirectory '__pycache__')
        )
        $copyArgs = @(
            $sourceDirectory.FullName, $AppDirectory, '/E', '/R:2', '/W:1',
            '/COPY:DAT', '/DCOPY:DAT', '/XD'
        ) + $excluded
        & robocopy.exe @copyArgs
        if ($LASTEXITCODE -gt 7) {
            throw "Pembaruan source gagal saat menyalin file (robocopy $LASTEXITCODE)."
        }

        $launcher = Join-Path $AppDirectory 'start-windows.bat'
        if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or
            -not (Test-Path -LiteralPath (Join-Path $AppDirectory 'server\app.py') -PathType Leaf)) {
            throw 'File aplikasi tidak ditemukan setelah pembaruan.'
        }
        Remove-Item -LiteralPath $ArchivePath -Force
        New-Item -ItemType Directory -Path $UpdateDirectory -Force | Out-Null
        Start-Process -FilePath $env:ComSpec `
            -ArgumentList ('/c ""{0}" --no-browser' -f $launcher) `
            -WorkingDirectory $AppDirectory
    }
}
catch {
    Write-Error ('Pembaruan NexLab gagal: ' + $_.Exception.Message)
    exit 1
}
finally {
    if (Test-Path -LiteralPath $tempDirectory) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
    if ($InstallScript -and (Test-Path -LiteralPath $InstallScript)) {
        Remove-Item -LiteralPath $InstallScript -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $PSCommandPath) {
        Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    }
}
