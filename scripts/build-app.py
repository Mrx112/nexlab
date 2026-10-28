"""Build a self-contained NexLab directory with PyInstaller on the target OS."""
import argparse
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build(output_directory):
    output_directory.mkdir(parents=True, exist_ok=True)
    work_directory = ROOT / 'build' / 'pyinstaller'
    spec_directory = ROOT / 'build' / 'spec'
    args = [
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--name', 'NexLab', '--onedir', '--console',
        '--distpath', str(output_directory),
        '--workpath', str(work_directory),
        '--specpath', str(spec_directory),
        '--add-data', f'{ROOT / "static"}{os.pathsep}static',
        '--collect-submodules', 'server',
        '--collect-submodules', 'asyncssh',
        '--collect-all', 'aiohttp',
        '--collect-all', 'cryptography',
        'run.py',
    ]
    subprocess.check_call(args, cwd=ROOT)
    application_directory = output_directory / 'NexLab'
    if not application_directory.is_dir():
        raise RuntimeError(f'PyInstaller did not create {application_directory}')

    if sys.platform == 'darwin':
        create_macos_app(application_directory, output_directory / 'NexLab.app')

    print(f'\nNexLab application bundle created: {output_directory}')


def create_macos_app(application_directory, app_bundle):
    contents = app_bundle / 'Contents'
    executable_directory = contents / 'MacOS'
    runtime_directory = contents / 'Resources' / 'runtime'
    executable_directory.mkdir(parents=True, exist_ok=True)
    shutil.copytree(application_directory, runtime_directory)

    launcher = executable_directory / 'nexlab-launcher'
    launcher.write_text(
        '#!/bin/sh\n'
        'APP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\n'
        'RUNTIME="$APP_ROOT/Resources/runtime"\n'
        'DATA="$HOME/Library/Application Support/NexLab/data"\n'
        'mkdir -p "$DATA"\n'
        'cd "$RUNTIME" || exit 1\n'
        'exec "$RUNTIME/NexLab" --open --data "$DATA" "$@" >>"$DATA/nexlab.log" 2>&1\n',
        encoding='utf-8',
        newline='\n',
    )
    launcher.chmod(0o755)
    with (contents / 'Info.plist').open('wb') as plist:
        plistlib.dump({
            'CFBundleName': 'NexLab',
            'CFBundleDisplayName': 'NexLab',
            'CFBundleIdentifier': 'id.nexlab.desktop',
            'CFBundleVersion': '1.2.0',
            'CFBundleShortVersionString': '1.2.0',
            'CFBundlePackageType': 'APPL',
            'CFBundleExecutable': launcher.name,
            'NSHighResolutionCapable': True,
            'LSMinimumSystemVersion': '12.0',
        }, plist)

    shutil.rmtree(application_directory)


def main():
    parser = argparse.ArgumentParser(description='Build the NexLab standalone application for the current OS.')
    parser.add_argument('--dist-dir', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    build(args.dist_dir.resolve())


if __name__ == '__main__':
    main()
