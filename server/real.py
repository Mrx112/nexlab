"""Real-mode engine.

Linux (root): TAP + Linux bridge networking, network namespaces, bridge to physical NICs.
Windows / macOS (no admin needed): QEMU VMs linked with UDP sockets, Cloud = NAT to the host network.

* QEMU/KVM nodes with real vendor images (each NIC is a TAP device)
* Linux host nodes (network namespaces - almost zero RAM)
* Cloud nodes bridging to a physical NIC or an existing host bridge, so lab
  devices talk to REAL switches/routers/servers on your network
* every link between real endpoints is a Linux bridge (BPDU/LLDP/CDP forwarded)
* consoles: QEMU serial over telnet, namespace shell over a PTY,
  shared by every browser that opens it (with scrollback)
"""
import asyncio
import codecs
import hashlib
import os
import platform
import shutil
import socket
import struct
import subprocess
import sys

from . import sysinfo

try:  # POSIX-only (Linux Host consoles)
    import fcntl
    import termios
except ImportError:  # Windows
    fcntl = termios = None

OS = 'windows' if sys.platform.startswith('win') else 'macos' if sys.platform == 'darwin' else 'linux'

IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240


def sh(*args):
    try:
        r = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=20)
        return r.returncode, (r.stdout + r.stderr).strip()
    except Exception as e:
        return 1, str(e)


def hname(prefix, *parts):
    return prefix + hashlib.sha1('|'.join(map(str, parts)).encode()).hexdigest()[:11]


def is_root():
    return hasattr(os, 'geteuid') and os.geteuid() == 0


def _find(name, extra):
    p = shutil.which(name)
    if p:
        return p
    for d in extra:
        for cand in (os.path.join(d, name), os.path.join(d, name + '.exe')):
            if os.path.isfile(cand):
                return cand
    return None


QEMU_DIRS = {'windows': [r'C:\Program Files\qemu', r'C:\qemu', os.path.expandvars(r'%LOCALAPPDATA%\Programs\qemu')],
             'macos': ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'], 'linux': ['/usr/bin', '/usr/local/bin']}


def qemu_bin():
    return _find('qemu-system-x86_64', QEMU_DIRS[OS])


def qemu_img_bin():
    return _find('qemu-img', QEMU_DIRS[OS])


def net_mode():
    """'tap' = Linux bridges (root), 'socket' = portable UDP links (any OS, no admin)."""
    if os.environ.get('NEXLAB_NET') == 'socket':
        return 'socket'
    return 'tap' if OS == 'linux' and is_root() and shutil.which('ip') else 'socket'


def accel_args():
    want = os.environ.get('NEXLAB_ACCEL', '').lower()
    if want == 'tcg':
        return ['-accel', 'tcg,thread=multi'], 'tcg (emulasi)'
    if OS == 'linux' and os.path.exists('/dev/kvm') and os.access('/dev/kvm', os.R_OK | os.W_OK):
        return ['-enable-kvm', '-cpu', 'host'], 'KVM'
    if OS == 'macos' and platform.machine() == 'x86_64':
        return ['-accel', 'hvf', '-cpu', 'host'], 'HVF'
    if OS == 'windows' and want == 'whpx':
        return ['-accel', 'whpx,kernel-irqchip=off'], 'WHPX (Hyper-V)'
    return ['-accel', 'tcg,thread=multi'], 'tcg (emulasi, lebih lambat)'


def host_ifaces():
    if OS == 'windows':
        return sysinfo.windows_network_info()['interfaces']
    out = []
    try:
        for n in sorted(os.listdir('/sys/class/net')):
            if n == 'lo' or n.startswith(('nb', 'nt', 'nv', 'nc')):
                continue
            is_bridge = os.path.isdir(f'/sys/class/net/{n}/bridge')
            out.append({'name': n, 'bridge': is_bridge})
    except Exception:
        pass
    return out


def caps(images_dir, interfaces=None):
    qemu = qemu_bin()
    mode = net_mode()
    netns_ok = OS == 'linux' and is_root() and bool(shutil.which('ip'))
    return {
        'os': OS,
        'netmode': mode,
        'accel': accel_args()[1],
        'avail': {'qemu': bool(qemu and qemu_img_bin()), 'netns': netns_ok},
        'bridge': mode == 'tap',
        'root': is_root(),
        'linux': OS == 'linux',
        'qemu': bool(qemu),
        'qemu_img': bool(qemu_img_bin()),
        'kvm': os.path.exists('/dev/kvm') and os.access('/dev/kvm', os.R_OK | os.W_OK),
        'ip': bool(shutil.which('ip')),
        'asyncssh': _has_asyncssh(),
        'interfaces': interfaces if interfaces is not None else host_ifaces(),
        'images': list_images(images_dir),
    }


def _has_asyncssh():
    try:
        import asyncssh  # noqa
        return True
    except Exception:
        return False


def list_images(images_dir):
    out = []
    base = os.path.join(images_dir, 'qemu')
    if not os.path.isdir(base):
        return out
    for d in sorted(os.listdir(base)):
        p = os.path.join(base, d)
        if os.path.isdir(p):
            disks = sorted(f for f in os.listdir(p) if f.endswith(('.qcow2', '.img', '.vmdk', '.iso')))
            if disks:
                out.append({'name': d, 'disks': disks})
        elif d.endswith(('.qcow2', '.img', '.vmdk', '.iso')):
            name = d.rsplit('.', 1)[0]
            existing = next((x for x in out if x['name'] == name), None)
            if existing:
                existing['disks'].append(d)
            else:
                out.append({'name': name, 'disks': [d]})
    return out


class TelnetFilter:
    """Strips telnet negotiation and answers it, keeping text clean for xterm."""

    def __init__(self, writer=None):
        self.state = 0
        self.writer = writer
        self.dec = codecs.getincrementaldecoder('utf-8')('replace')
        self.cmd = 0
        self.seen = set()

    def feed(self, data):
        out = bytearray()
        for b in data:
            if self.state == 0:
                if b == IAC:
                    self.state = 1
                else:
                    out.append(b)
            elif self.state == 1:
                if b == IAC:
                    out.append(IAC)
                    self.state = 0
                elif b in (WILL, WONT, DO, DONT):
                    self.cmd = b
                    self.state = 2
                elif b == SB:
                    self.state = 3
                else:
                    self.state = 0
            elif self.state == 2:
                self.reply(self.cmd, b)
                self.state = 0
            elif self.state == 3:
                if b == IAC:
                    self.state = 4
            elif self.state == 4:
                self.state = 0 if b == SE else 3
        return self.dec.decode(bytes(out))

    def reply(self, cmd, opt):
        if not self.writer or (cmd, opt) in self.seen:
            return
        self.seen.add((cmd, opt))
        if cmd == WILL:
            resp = DO if opt in (1, 3) else DONT
        elif cmd == DO:
            resp = WILL if opt == 3 else WONT
        else:
            return
        try:
            self.writer.write(bytes([IAC, resp, opt]))
        except Exception:
            pass


class Hub:
    """A console backend shared by several browser clients."""

    def __init__(self, title):
        self.title = title
        self.clients = set()
        self.buffer = ''
        self.write = None
        self.resize = None
        self.alive = True

    async def emit(self, text):
        self.buffer = (self.buffer + text)[-65536:]
        for c in list(self.clients):
            try:
                await c(text)
            except Exception:
                self.clients.discard(c)


class RealManager:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.images_dir = os.path.join(data_dir, 'images')
        self.run_dir = os.path.join(data_dir, 'runtime')
        os.makedirs(os.path.join(self.images_dir, 'qemu'), exist_ok=True)
        os.makedirs(self.run_dir, exist_ok=True)
        self.nodes = {}       # (lab, nid) -> dict
        self.bridges = {}     # lab -> set(bridge names we created)
        self.next_port = 32769

    # ---------------------------------------------------------------- info
    def caps(self, interfaces=None):
        return caps(self.images_dir, interfaces)

    def is_running(self, lab, nid):
        r = self.nodes.get((lab, nid))
        if not r:
            return False
        p = r.get('proc')
        if p is not None and p.returncode is not None:
            return False
        return True

    def hub(self, lab, nid):
        r = self.nodes.get((lab, nid))
        return r and r.get('hub')

    def free_port(self):
        for _ in range(2000):
            port = self.next_port
            self.next_port = 32769 if self.next_port > 40000 else self.next_port + 1
            with socket.socket() as s:
                try:
                    s.bind(('127.0.0.1', port))
                    return port
                except OSError:
                    continue
        raise RuntimeError('no free port')

    # ---------------------------------------------------------------- start
    async def start(self, rt, node):
        if node['type'] == 'netns':
            if OS != 'linux':
                return False, 'Linux Host (network namespace) hanya tersedia jika server berjalan di Linux. Gunakan QEMU VM dengan image Linux kecil (mis. Alpine) sebagai gantinya.'
            if not is_root():
                return False, 'Linux Host butuh server dijalankan sebagai root (sudo).'
            if not shutil.which('ip'):
                return False, 'Perintah "ip" (iproute2) tidak ditemukan.'
        key = (rt.id, node['id'])
        if self.is_running(*key):
            return True, ''
        try:
            if node['type'] == 'qemu':
                return await self.start_qemu(rt, node)
            if node['type'] == 'netns':
                return await self.start_netns(rt, node)
        except Exception as e:
            return False, f'Gagal start: {e}'
        return False, 'Tipe node tidak didukung'

    def node_dir(self, rt, node):
        d = os.path.join(self.run_dir, f"lab{rt.id}", f"node{node['id']}")
        os.makedirs(d, exist_ok=True)
        return d

    async def start_qemu(self, rt, node):
        p = node['props']
        img = p.get('image')
        qbin, qimg = qemu_bin(), qemu_img_bin()
        if not qbin or not qimg:
            hint = {'windows': 'pasang dari https://qemu.weilnetz.de/w64/ (atau: winget install SoftwareFreedomConservancy.QEMU)',
                    'macos': 'brew install qemu', 'linux': 'sudo apt install qemu-system-x86 qemu-utils'}[OS]
            return False, 'QEMU belum terpasang: ' + hint
        base_dir = os.path.join(self.images_dir, 'qemu', img or '')
        imgs = list_images(self.images_dir)
        info = next((i for i in imgs if i['name'] == img), None)
        if not img or not info:
            return False, 'Pilih image QEMU (taruh .qcow2 di data/images/qemu/<nama>/<file> atau langsung di data/images/qemu/<file>)'
        d = self.node_dir(rt, node)
        drives = []
        src_base = base_dir if os.path.isdir(base_dir) else os.path.join(self.images_dir, 'qemu')
        for disk in info['disks']:
            src = os.path.join(src_base, disk)
            if disk.endswith('.iso'):
                drives += ['-cdrom', src]
                continue
            ov = os.path.join(d, disk.rsplit('.', 1)[0] + '.qcow2')
            if not os.path.exists(ov):
                fmt = 'vmdk' if disk.endswith('.vmdk') else ('raw' if disk.endswith('.img') else 'qcow2')
                rc, out = sh(qimg, 'create', '-f', 'qcow2', '-b', src, '-F', fmt, ov)
                if rc:
                    return False, out
            drives += ['-drive', f'file={ov},if=virtio' if p.get('disk_bus') == 'virtio' else f'file={ov}']
        port = self.free_port()
        args = [qbin, '-name', node['name'], '-m', str(int(p.get('ram') or 512)),
                '-smp', str(int(p.get('cpus') or 1)), '-display', 'none', '-monitor', 'none',
                '-serial', f'telnet:127.0.0.1:{port},server,nowait', '-boot', 'order=cd'] + drives
        args += accel_args()[0]
        taps = {}
        mode = net_mode()
        for i, ifn in enumerate(node['ifaces']):
            mac = '50:00:%02x:%02x:%02x:%02x' % (rt.id % 256, node['id'] % 256, (node['id'] >> 8) % 256, i)
            dev = ['-device', f"{p.get('nic_model') or 'e1000'},netdev=n{i},mac={mac}"]
            if mode == 'socket':
                args += ['-netdev', self.socket_netdev(rt, node, ifn, i)] + dev
                continue
            tap = hname('nt', rt.id, node['id'], ifn)
            sh('ip', 'link', 'del', tap)
            rc, out = sh('ip', 'tuntap', 'add', 'dev', tap, 'mode', 'tap')
            if rc:
                return False, out
            sh('ip', 'link', 'set', tap, 'up')
            taps[ifn] = tap
            args += ['-netdev', f'tap,id=n{i},ifname={tap},script=no,downscript=no'] + dev
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL,
                                                    stderr=asyncio.subprocess.PIPE, cwd=d)
        hub = Hub(node['name'])
        r = {'proc': proc, 'taps': taps, 'port': port, 'hub': hub, 'type': 'qemu', 'mode': mode,
             'linksig': self.link_sig(rt, node)}
        self.nodes[(rt.id, node['id'])] = r
        await asyncio.sleep(0.5)
        if proc.returncode is not None:
            err = (await proc.stderr.read()).decode(errors='replace')[-400:]
            self._cleanup_taps(r)
            self.nodes.pop((rt.id, node['id']), None)
            return False, 'QEMU berhenti: ' + err
        asyncio.ensure_future(self._telnet_backend(r))
        return True, ''

    # ---------------------------------------------------------------- portable (socket) links
    @staticmethod
    def link_ports(rt, link):
        h = int(hashlib.sha1(f"{rt.id}|{link['id']}".encode()).hexdigest()[:8], 16)
        base = 21000 + (h % 13900) * 2          # 21000..48799, below Windows/macOS ephemeral range
        return base, base + 1                   # side a listens on base, side b on base+1

    def socket_netdev(self, rt, node, ifn, i):
        for l in rt.lab['links']:
            for me, peer in (('a', 'b'), ('b', 'a')):
                if l[me]['node'] == node['id'] and l[me]['iface'] == ifn:
                    pn = rt.by_id.get(l[peer]['node'])
                    if not pn:
                        break
                    if pn['type'] == 'qemu':
                        pa, pb = self.link_ports(rt, l)
                        mine, theirs = (pa, pb) if me == 'a' else (pb, pa)
                        return f'socket,id=n{i},udp=127.0.0.1:{theirs},localaddr=127.0.0.1:{mine}'
                    if pn['type'] == 'cloud':
                        # NAT to the host's network/internet (DHCP 10.0.2.15/24, gw 10.0.2.2)
                        fwd = ''
                        hp = str(pn['props'].get('hostfwd') or '').strip()
                        if hp.isdigit():
                            fwd = f',hostfwd=tcp::{hp}-:22'
                        return f'user,id=n{i}{fwd}'
        return f'user,id=n{i},restrict=on'

    @staticmethod
    def link_sig(rt, node):
        sig = []
        for l in rt.lab['links']:
            if node['id'] in (l['a']['node'], l['b']['node']):
                sig.append((l['id'], l['a']['node'], l['a']['iface'], l['b']['node'], l['b']['iface']))
        return sorted(sig)

    def stale_links(self, rt):
        """Socket-mode VMs whose cabling changed since boot (need a restart)."""
        out = []
        for (lab, nid), r in self.nodes.items():
            if lab == rt.id and r.get('mode') == 'socket' and nid in rt.by_id:
                if r.get('linksig') != self.link_sig(rt, rt.by_id[nid]):
                    out.append(nid)
        return out

    async def _telnet_backend(self, r):
        hub = r['hub']
        for _ in range(60):
            try:
                reader, writer = await asyncio.open_connection('127.0.0.1', r['port'])
                break
            except OSError:
                await asyncio.sleep(0.5)
        else:
            await hub.emit('\r\n[console tidak tersedia]\r\n')
            return
        tf = TelnetFilter(writer)

        def write(text):
            writer.write(text.encode().replace(b'\xff', b'\xff\xff'))
        hub.write = write
        while True:
            try:
                data = await reader.read(4096)
            except (ConnectionResetError, ConnectionError, OSError):
                break
            if not data:
                break
            txt = tf.feed(data)
            if txt:
                await hub.emit(txt)
        hub.write = None
        await hub.emit('\r\n[VM dimatikan]\r\n')

    async def start_netns(self, rt, node):
        ns = hname('nl', rt.id, node['id'])
        vh = hname('nv', rt.id, node['id'])
        vn = hname('nw', rt.id, node['id'])
        sh('ip', 'netns', 'del', ns)
        sh('ip', 'link', 'del', vh)
        for cmd in (['ip', 'netns', 'add', ns],
                    ['ip', 'link', 'add', vh, 'type', 'veth', 'peer', 'name', vn],
                    ['ip', 'link', 'set', vn, 'netns', ns],
                    ['ip', 'netns', 'exec', ns, 'ip', 'link', 'set', vn, 'name', 'eth0'],
                    ['ip', 'netns', 'exec', ns, 'ip', 'link', 'set', 'lo', 'up'],
                    ['ip', 'netns', 'exec', ns, 'ip', 'link', 'set', 'eth0', 'up'],
                    ['ip', 'link', 'set', vh, 'up']):
            rc, out = sh(*cmd)
            if rc:
                return False, f"{' '.join(cmd)}: {out}"
        p = node['props']
        if p.get('ip'):
            sh('ip', 'netns', 'exec', ns, 'ip', 'addr', 'add', p['ip'], 'dev', 'eth0')
        if p.get('gw'):
            sh('ip', 'netns', 'exec', ns, 'ip', 'route', 'add', 'default', 'via', p['gw'])
        hub = Hub(node['name'])
        r = {'ns': ns, 'veth': vh, 'hub': hub, 'type': 'netns', 'taps': {'eth0': vh}, 'proc': None}
        self.nodes[(rt.id, node['id'])] = r
        await self._pty_backend(r, ['ip', 'netns', 'exec', ns, 'bash', '--noprofile', '--norc', '-i'],
                                {'PS1': f"{node['name']}:\\w# ", 'TERM': 'xterm-256color', 'HOME': '/root',
                                 'PATH': os.environ.get('PATH', '/usr/sbin:/usr/bin:/sbin:/bin')})
        if p.get('dhcp'):
            client = shutil.which('dhclient') or shutil.which('udhcpc')
            if client:
                r['hub'].write(('dhclient -v eth0' if 'dhclient' in client else 'udhcpc -i eth0') + '\n')
        return True, ''

    async def _pty_backend(self, r, argv, env):
        master, slave = os.openpty()
        proc = await asyncio.create_subprocess_exec(*argv, stdin=slave, stdout=slave, stderr=slave, env=env,
                                                    start_new_session=True, cwd='/root' if os.path.isdir('/root') else '/')
        os.close(slave)
        r['shell'] = proc
        r['master'] = master
        hub = r['hub']
        loop = asyncio.get_running_loop()
        dec = codecs.getincrementaldecoder('utf-8')('replace')
        fl = fcntl.fcntl(master, fcntl.F_GETFL)
        fcntl.fcntl(master, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        def on_read():
            try:
                data = os.read(master, 4096)
            except OSError:
                data = b''
            if not data:
                loop.remove_reader(master)
                return
            asyncio.ensure_future(hub.emit(dec.decode(data)))
        loop.add_reader(master, on_read)

        def write(text):
            try:
                os.write(master, text.encode())
            except OSError:
                pass

        def resize(cols, rows):
            try:
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
            except OSError:
                pass
        hub.write = write
        hub.resize = resize

    # ---------------------------------------------------------------- stop
    def _cleanup_taps(self, r):
        for tap in r.get('taps', {}).values():
            sh('ip', 'link', 'del', tap)

    async def stop(self, rt, node):
        r = self.nodes.pop((rt.id, node['id']), None)
        if not r:
            return
        proc = r.get('proc')
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except asyncio.TimeoutError:
                proc.kill()
        shell = r.get('shell')
        if shell and shell.returncode is None:
            try:
                os.killpg(shell.pid, 9)
            except Exception:
                shell.kill()
        if r.get('master') is not None:
            try:
                asyncio.get_running_loop().remove_reader(r['master'])
                os.close(r['master'])
            except Exception:
                pass
        if r.get('ns'):
            sh('ip', 'netns', 'del', r['ns'])
        self._cleanup_taps(r)
        if r.get('hub'):
            await r['hub'].emit('\r\n[node dihentikan]\r\n')

    def wipe(self, rt, node):
        d = os.path.join(self.run_dir, f"lab{rt.id}", f"node{node['id']}")
        shutil.rmtree(d, ignore_errors=True)

    async def stop_lab(self, rt):
        for (lab, nid) in list(self.nodes):
            if lab == rt.id and nid in rt.by_id:
                await self.stop(rt, rt.by_id[nid])
        await self.sync_links(rt)

    async def shutdown(self):
        for (lab, nid), r in list(self.nodes.items()):
            await self.stop(type('R', (), {'id': lab})(), {'id': nid})
        for lab, brs in self.bridges.items():
            for b in brs:
                sh('ip', 'link', 'del', b)

    # ---------------------------------------------------------------- links
    def _dev(self, rt, nid, ifn):
        r = self.nodes.get((rt.id, nid))
        if not r:
            return None
        return r['taps'].get(ifn)

    async def sync_links(self, rt):
        if net_mode() != 'tap':
            return
        want = {}  # bridge -> set(devs)
        external = {}  # bridge (not ours) -> devs
        for l in rt.lab['links']:
            a, b = l['a'], l['b']
            na, nb = rt.by_id.get(a['node']), rt.by_id.get(b['node'])
            if not na or not nb:
                continue
            ta, tb = na['type'], nb['type']
            real = ('qemu', 'netns')
            if ta == 'cloud' and tb in real or tb == 'cloud' and ta in real:
                cloud, other, oif = (na, nb, b['iface']) if ta == 'cloud' else (nb, na, a['iface'])
                dev = self._dev(rt, other['id'], oif)
                tgt = (cloud['props'].get('target') or '').strip()
                if not dev or not tgt or not os.path.exists(f'/sys/class/net/{tgt}'):
                    continue
                if os.path.isdir(f'/sys/class/net/{tgt}/bridge'):
                    external.setdefault(tgt, set()).add(dev)
                else:
                    br = hname('nc', rt.id, cloud['id'], tgt)
                    want.setdefault(br, set()).update({dev, tgt})
            elif ta in real and tb in real:
                da, db = self._dev(rt, a['node'], a['iface']), self._dev(rt, b['node'], b['iface'])
                if da and db:
                    want[hname('nb', rt.id, l['id'])] = {da, db}
        mine = self.bridges.setdefault(rt.id, set())
        for br in list(mine):
            if br not in want:
                sh('ip', 'link', 'del', br)
                mine.discard(br)
        for br, devs in want.items():
            if br not in mine:
                sh('ip', 'link', 'add', 'name', br, 'type', 'bridge')
                sh('ip', 'link', 'set', br, 'type', 'bridge', 'stp_state', '0', 'group_fwd_mask', '65535')
                sh('ip', 'link', 'set', br, 'up')
                mine.add(br)
            for d in devs:
                sh('ip', 'link', 'set', d, 'master', br)
                sh('ip', 'link', 'set', d, 'up')
        for br, devs in external.items():
            for d in devs:
                sh('ip', 'link', 'set', d, 'master', br)
                sh('ip', 'link', 'set', d, 'up')


async def remote_console(props, send, recv_queue):
    """Proxy a browser terminal to a real device via telnet or SSH."""
    host = props.get('host')
    port = int(props.get('port') or (22 if props.get('protocol') == 'ssh' else 23))
    if not host:
        await send('\r\n[Isi alamat IP perangkat di panel properti]\r\n')
        return
    if props.get('protocol') == 'ssh':
        try:
            import asyncssh
        except Exception:
            await send('\r\n[Modul asyncssh belum terpasang: pip install asyncssh]\r\n')
            return
        user = props.get('username') or 'admin'
        await send(f'Menghubungkan SSH ke {user}@{host}:{port} ...\r\n{user}@{host}\'s password: ')
        pw = ''
        while True:
            d = await recv_queue.get()
            if d is None:
                return
            if d.get('t') != 'data':
                continue
            for ch in d['d']:
                if ch in '\r\n':
                    break
                if ch == '\x7f':
                    pw = pw[:-1]
                else:
                    pw += ch
            else:
                continue
            break
        await send('\r\n')
        try:
            conn = await asyncio.wait_for(asyncssh.connect(
                host, port=port, username=user, password=pw, known_hosts=None,
                kex_algs=['curve25519-sha256', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256',
                          'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'],
                encryption_algs=['aes128-ctr', 'aes256-ctr', 'aes128-gcm@openssh.com', 'aes128-cbc', 'aes256-cbc', '3des-cbc'],
                server_host_key_algs=['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-256', 'ssh-rsa']), 15)
        except Exception as e:
            await send(f'\r\n[SSH gagal: {e}]\r\n')
            return
        async with conn:
            proc = await conn.create_process(term_type='xterm', term_size=(120, 32))

            async def pump():
                while True:
                    data = await proc.stdout.read(4096)
                    if not data:
                        break
                    await send(data)
            task = asyncio.ensure_future(pump())
            while not task.done():
                d = await recv_queue.get()
                if d is None:
                    break
                if d.get('t') == 'data':
                    proc.stdin.write(d['d'])
                elif d.get('t') == 'resize':
                    proc.change_terminal_size(int(d.get('cols', 80)), int(d.get('rows', 24)))
            task.cancel()
        await send('\r\n[koneksi SSH ditutup]\r\n')
        return
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), 8)
    except Exception as e:
        await send(f'\r\n[Telnet ke {host}:{port} gagal: {e}]\r\n')
        return
    await send(f'[Terhubung ke {host}:{port}]\r\n')
    tf = TelnetFilter(writer)

    async def pump():
        while True:
            try:
                data = await reader.read(4096)
            except OSError:
                break
            if not data:
                break
            txt = tf.feed(data)
            if txt:
                await send(txt)
    task = asyncio.ensure_future(pump())
    while not task.done():
        get = asyncio.ensure_future(recv_queue.get())
        done, _ = await asyncio.wait({get, task}, return_when=asyncio.FIRST_COMPLETED)
        if get not in done:
            get.cancel()
            break
        d = get.result()
        if d is None:
            break
        if d.get('t') == 'data':
            writer.write(d['d'].encode().replace(b'\xff', b'\xff\xff'))
    task.cancel()
    try:
        writer.close()
    except Exception:
        pass
    await send('\r\n[koneksi telnet ditutup]\r\n')
