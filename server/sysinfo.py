"""Cross-platform system information (Linux, Windows, macOS) without extra dependencies."""
import ctypes
import os
import re
import socket
import subprocess
import sys

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
