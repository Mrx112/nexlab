"""Cross-platform system information (Linux, Windows, macOS) without extra dependencies."""
import ctypes
import ipaddress
import os
import re
import socket
import subprocess
import sys
import time

OS = 'windows' if sys.platform.startswith('win') else 'macos' if sys.platform == 'darwin' else 'linux'


def _run(args, timeout=3):
    try:
        kw = {}
        if OS == 'windows':
            kw['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, **kw)
        return r.stdout
    except Exception:
        return ''


def memory_mb():
    """(total, available) in MB."""
    try:
        if OS == 'linux':
            m = {}
            for line in open('/proc/meminfo'):
                k, v = line.split(':', 1)
                m[k] = int(v.split()[0])
            return m.get('MemTotal', 0) // 1024, m.get('MemAvailable', m.get('MemFree', 0)) // 1024
        if OS == 'windows':
            class MS(ctypes.Structure):
                _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong),
                            ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                            ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                            ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                            ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
            ms = MS()
            ms.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms))
            return ms.ullTotalPhys // 1048576, ms.ullAvailPhys // 1048576
        if OS == 'macos':
            total = int(_run(['sysctl', '-n', 'hw.memsize']).strip() or 0)
            vm = _run(['vm_stat'])
            page = int((re.search(r'page size of (\d+)', vm) or [0, 4096])[1])
            free = sum(int(m) for m in re.findall(r'Pages (?:free|inactive|speculative):\s+(\d+)', vm))
            return total // 1048576, free * page // 1048576
    except Exception:
        pass
    return 0, 0


def load_avg():
    try:
        return [f'{x:.2f}' for x in os.getloadavg()]
    except (AttributeError, OSError):
        return ['-', '-', '-']


def process_rss_mb():
    try:
        if OS == 'windows':
            class PMC(ctypes.Structure):
                _fields_ = [('cb', ctypes.c_ulong), ('PageFaultCount', ctypes.c_ulong),
                            ('PeakWorkingSetSize', ctypes.c_size_t), ('WorkingSetSize', ctypes.c_size_t),
                            ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                            ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                            ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t)]
            c = PMC()
            c.cb = ctypes.sizeof(PMC)
            h = ctypes.windll.kernel32.GetCurrentProcess()
            ctypes.windll.psapi.GetProcessMemoryInfo(h, ctypes.byref(c), c.cb)
            return c.WorkingSetSize // 1048576
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return r // 1048576 if OS == 'macos' else r // 1024   # macOS reports bytes, Linux KB
    except Exception:
        return 0


def _skip(ip):
    return ip.startswith(('127.', '169.254.')) or ip == '0.0.0.0'


def lan_addresses():
    """IPv4 addresses other computers can use to reach this server."""
    out, seen = [], set()

    def add(iface, ip):
        if ip and not _skip(ip) and ip not in seen:
            seen.add(ip)
            out.append({'iface': iface, 'ip': ip})
    if OS == 'linux':
        for line in _run(['ip', '-4', '-o', 'addr', 'show']).splitlines():
            p = line.split()
            if len(p) > 3:
                add(p[1], p[3].split('/')[0])
    elif OS == 'macos':
        cur = ''
        for line in _run(['ifconfig']).splitlines():
            m = re.match(r'^(\w[\w\d]*):', line)
            if m:
                cur = m.group(1)
            m = re.search(r'\binet (\d+\.\d+\.\d+\.\d+)', line)
            if m and not cur.startswith(('utun', 'bridge', 'awdl', 'llw')):
                add(cur, m.group(1))
    else:
        cur = ''
        for line in _run(['ipconfig']).splitlines():
            if line and not line.startswith(' ') and line.rstrip().endswith(':'):
                cur = line.strip().rstrip(':').replace('Ethernet adapter ', '').replace('Wireless LAN adapter ', 'Wi-Fi ')
            m = re.search(r'IPv4[^:]*:\s*(\d+\.\d+\.\d+\.\d+)', line)
            if m and 'vEthernet' not in cur and 'VirtualBox' not in cur:
                add(cur, m.group(1))
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            add('host', ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        add('default', s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return out


def windows_network_info():
    """Return Windows adapter details and neighbors already present in its ARP cache."""
    if OS != 'windows':
        return {'interfaces': [], 'neighbors': [], 'error': ''}
    kw = {'creationflags': 0x08000000}
    try:
        config = subprocess.run(
            ['ipconfig', '/all'], capture_output=True, text=True,
            encoding='mbcs', errors='replace', timeout=4, **kw)
        arp = subprocess.run(
            ['arp', '-a'], capture_output=True, text=True,
            encoding='mbcs', errors='replace', timeout=4, **kw)
        if config.returncode or arp.returncode:
            return {'interfaces': [], 'neighbors': [], 'error': 'Windows gagal membaca konfigurasi jaringan.'}
    except (OSError, subprocess.TimeoutExpired):
        return {'interfaces': [], 'neighbors': [], 'error': 'Informasi jaringan Windows tidak dapat dibaca.'}

    interfaces, adapters_by_ip = [], {}
    current = None
    for line in config.stdout.splitlines():
        if line and not line[0].isspace() and line.rstrip().endswith(':'):
            name = line.strip().rstrip(':')
            name = name.replace('Ethernet adapter ', '').replace('Wireless LAN adapter ', 'Wi-Fi ')
            current = {'name': name, 'description': '', 'status': 'Unknown',
                       'mac': '', 'bridge': 'bridge' in name.lower(),
                       'addresses': [], 'gateway': ''}
            interfaces.append(current)
        if not current:
            continue
        ipv4 = re.search(r'\bIPv4[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})', line, re.IGNORECASE)
        if ipv4 and not _skip(ipv4.group(1)):
            address = ipv4.group(1)
            current['addresses'].append(address)
            current['status'] = 'Up'
            adapters_by_ip[address] = current['name']
        mac = re.search(r'(?<![0-9A-F])([0-9A-F]{2}(?:[:-][0-9A-F]{2}){5})(?![0-9A-F])', line, re.IGNORECASE)
        if mac and not current['mac']:
            current['mac'] = mac.group(1).replace('-', ':').upper()
        gateway = re.search(r'\b(?:Default Gateway|Gateway)[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})', line, re.IGNORECASE)
        if gateway and not current['gateway']:
            current['gateway'] = gateway.group(1)
        if re.search(r'\bmedia disconnected\b', line, re.IGNORECASE):
            current['status'] = 'Disconnected'

    neighbors = []
    current_interface = ''
    for line in arp.stdout.splitlines():
        header = re.match(r'^\s*[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})\s+---', line)
        if header:
            current_interface = adapters_by_ip.get(header.group(1), '')
            continue
        entry = re.match(
            r'^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9A-F]{2}(?:[:-][0-9A-F]{2}){5})\s+(\S+)',
            line, re.IGNORECASE)
        if entry:
            try:
                address = ipaddress.IPv4Address(entry.group(1))
            except ipaddress.AddressValueError:
                continue
            if _skip(entry.group(1)) or address.is_multicast or address.is_reserved:
                continue
            neighbors.append({
                'ip': entry.group(1),
                'mac': entry.group(2).replace('-', ':').upper(),
                'state': entry.group(3),
                'interface': current_interface,
            })
    return {'interfaces': interfaces, 'neighbors': neighbors, 'error': ''}


def ping_host(target):
    """Send one ICMP echo to a numeric IPv4 address using the host operating system."""
    try:
        address = str(ipaddress.IPv4Address(str(target).strip()))
    except ipaddress.AddressValueError:
        return {'ok': False, 'target': str(target), 'time_ms': None,
                'error': 'Masukkan alamat IPv4 yang valid.'}

    if OS == 'windows':
        args = ['ping', '-n', '1', '-w', '1500', '-4', address]
    elif OS == 'macos':
        args = ['ping', '-c', '1', '-W', '1500', '-t', '2', address]
    else:
        args = ['ping', '-c', '1', '-W', '2', address]
    started = time.monotonic()
    try:
        kw = {'creationflags': 0x08000000} if OS == 'windows' else {}
        result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=3, **kw)
    except (OSError, subprocess.TimeoutExpired):
        return {'ok': False, 'target': address, 'time_ms': None,
                'error': 'Perintah ping tidak tersedia atau waktu tunggu habis.'}
    output = result.stdout + result.stderr
    match = re.search(r'time[=<]\s*(\d+)\s*ms', output, re.IGNORECASE)
    elapsed = round((time.monotonic() - started) * 1000)
    ok = result.returncode == 0
    return {'ok': ok, 'target': address,
            'time_ms': int(match.group(1)) if match else (elapsed if ok else None),
            'error': '' if ok else 'Tidak ada balasan ICMP (tujuan tidak aktif atau ping diblokir).'}


def os_label():
    import platform
    if OS == 'macos':
        return 'macOS ' + (platform.mac_ver()[0] or '') + f' ({platform.machine()})'
    if OS == 'windows':
        return f'Windows {platform.release()} ({platform.machine()})'
    try:
        for line in open('/etc/os-release'):
            if line.startswith('PRETTY_NAME='):
                return line.split('=', 1)[1].strip().strip('"')
    except Exception:
        pass
    return 'Linux ' + platform.release()


def is_admin():
    if OS == 'windows':
        try:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            return False
    return hasattr(os, 'geteuid') and os.geteuid() == 0
