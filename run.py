#!/usr/bin/env python3
"""NexLab - lightweight personal network lab (PNETLab / Packet Tracer style).

Berjalan di Linux, Windows dan macOS.

    python run.py                    # semua IP jaringan, port 8080
    python run.py --open             # sekaligus buka browser
    sudo python3 run.py              # (Linux) aktifkan bridge NIC fisik & Linux Host
    python run.py --cert cert.pem --key key.pem   # HTTPS
"""
import argparse
import os
import ssl
import sys

FROZEN = getattr(sys, 'frozen', False)
HERE = os.path.dirname(sys.executable if FROZEN else os.path.abspath(__file__))
if not FROZEN:
    sys.path.insert(0, HERE)


def default_data_dir():
    if not FROZEN:
        return os.path.join(HERE, 'data')
    if sys.platform == 'win32':
        return os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~\\AppData\\Local'),
                            'NexLab', 'data')
    if sys.platform == 'darwin':
        return os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'NexLab', 'data')
    return os.path.join(os.environ.get('XDG_DATA_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'share'),
                        'nexlab')


for stream in (sys.stdout, sys.stderr):        # Windows console (cp1252) cannot print box characters
    try:
        stream.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    except Exception:
        pass

try:
    from aiohttp import web
except ImportError:
    print('Modul aiohttp belum terpasang. Jalankan installer (install-windows.bat / install-macos.command / install.sh)\n'
          'atau:  pip install aiohttp')
    sys.exit(1)

from server.app import build_app, lan_addresses, VERSION  # noqa: E402
from server import sysinfo  # noqa: E402
from server.real import caps as real_caps  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='NexLab network lab server')
    ap.add_argument('--host', default='0.0.0.0', help='alamat bind (default 0.0.0.0 = semua IP jaringan)')
    ap.add_argument('--port', type=int, default=int(os.environ.get('NEXLAB_PORT', 8080)))
    ap.add_argument('--data', default=os.environ.get('NEXLAB_DATA', default_data_dir()),
                    help='folder data (database, images, runtime)')
    ap.add_argument('--cert', help='file sertifikat TLS (PEM) untuk HTTPS')
    ap.add_argument('--key', help='file private key TLS (PEM)')
    ap.add_argument('--open', action='store_true', help='buka browser setelah server siap')
    a = ap.parse_args()

    ctx = None
    if a.cert and a.key:
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(a.cert, a.key)
    scheme = 'https' if ctx else 'http'
    os.makedirs(a.data, exist_ok=True)

    print('\n  ███╗   ██╗███████╗██╗  ██╗██╗      █████╗ ██████╗ ')
    print('  ████╗  ██║██╔════╝╚██╗██╔╝██║     ██╔══██╗██╔══██╗')
    print('  ██╔██╗ ██║█████╗   ╚███╔╝ ██║     ███████║██████╔╝')
    print('  ██║╚██╗██║██╔══╝   ██╔██╗ ██║     ██╔══██║██╔══██╗')
    print('  ██║ ╚████║███████╗██╔╝ ██╗███████╗██║  ██║██████╔╝')
    print(f'  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝   v{VERSION}\n')
    print(f'  Sistem: {sysinfo.os_label()}    Data: {a.data}\n')
    print('  Buka dari komputer lain (Windows/Mac/HP) di jaringan yang sama:')
    for addr in lan_addresses():
        print(f"     {scheme}://{addr['ip']}:{a.port}/    ({addr['iface']})")
    print(f'     {scheme}://localhost:{a.port}/\n')
    c = real_caps(os.path.join(a.data, 'images'))
    vm = f"QEMU siap ({c['accel']}, jaringan {'bridge' if c['netmode'] == 'tap' else 'socket'})" if c['avail']['qemu'] else 'QEMU belum terpasang (opsional)'
    print(f'  Node VM: {vm}')
    if sysinfo.OS == 'linux' and not c['root']:
        print('  Tip: jalankan dengan sudo untuk bridge ke NIC fisik & Linux Host.')
    if sysinfo.OS == 'windows':
        print('  Tip: jika Windows Firewall bertanya, pilih "Allow access" agar bisa dibuka dari komputer lain.')
    print('  User pertama yang mendaftar otomatis menjadi ADMIN.   Ctrl+C untuk berhenti.\n')

    app = build_app(a.data, a.port)
    if a.open:
        import asyncio
        import webbrowser

        async def _later():
            await asyncio.sleep(1.0)
            webbrowser.open(f'{scheme}://localhost:{a.port}/')

        async def _open(_app):
            _app['open_task'] = asyncio.ensure_future(_later())
        app.on_startup.append(_open)
    try:
        web.run_app(app, host=a.host, port=a.port, ssl_context=ctx, print=None, access_log=None)
    except OSError as e:
        print(f'\n  Gagal membuka port {a.port}: {e}\n  Coba port lain, mis:  --port 8090\n')
        if sysinfo.OS == 'windows' and FROZEN:
            input('  Tekan Enter untuk menutup...')
        sys.exit(1)


if __name__ == '__main__':
    main()
