"""Bridge between QEMU VMs and the simulated network.

The simulated devices are not packet based: their reachability is computed from the lab
state (see net.py). QEMU, on the other hand, exchanges raw Ethernet frames. For a cable
between a VM NIC and a simulated device NexLab owns the far end of the VM's UDP socket
netdev and answers the way the simulated network would:

* ARP requests for simulated endpoints in the VM's broadcast domain get a reply;
* ICMP echo requests from the VM are routed through the simulation engine and answered;
* pings from simulated devices to the VM are sent to the VM as real ICMP echo requests,
  so the VM's own addressing, routing and firewall decide the result.

Addresses the VM uses are learned from its ARP and IPv4 traffic and registered as
simulation endpoints, so routers, ACLs and the CLI see the VM like any other host.
Only untagged frames, ARP and ICMP echo are handled.
"""
import asyncio
import hashlib
import ipaddress
import os
import socket
import struct
import time

BROADCAST = b'\xff' * 6
ETH_ARP, ETH_IP, ETH_VLAN = 0x0806, 0x0800, 0x8100


def bridge_mac(lab_id, nid, ifn):
    """Stable, locally administered MAC for a simulated endpoint seen from a VM."""
    h = hashlib.md5(f'nexlab|{lab_id}|{nid}|{ifn}'.encode()).digest()
    return bytes([0x02, 0x4e]) + h[:4]


def mac_text(mac):
    return ':'.join(f'{b:02x}' for b in mac)


def _ip(raw):
    return socket.inet_ntoa(raw)


def _checksum(data):
    if len(data) % 2:
        data += b'\0'
    total = sum(struct.unpack(f'!{len(data) // 2}H', data))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    return ~total & 0xFFFF


def build_arp(op, sha, spa, tha, tpa):
    payload = struct.pack('!HHBBH6s4s6s4s', 1, ETH_IP, 6, 4, op, sha, socket.inet_aton(spa), tha, socket.inet_aton(tpa))
    dst = BROADCAST if op == 1 else tha
    return dst + sha + struct.pack('!H', ETH_ARP) + payload


def build_icmp_echo(src_mac, dst_mac, src_ip, dst_ip, icmp_type, ident, seq, payload, ttl=64):
    icmp = struct.pack('!BBHHH', icmp_type, 0, 0, ident, seq) + payload
    icmp = icmp[:2] + struct.pack('!H', _checksum(icmp)) + icmp[4:]
    header = struct.pack('!BBHHHBBH4s4s', 0x45, 0, 20 + len(icmp), ident & 0xFFFF, 0, max(1, ttl), 1, 0,
                         socket.inet_aton(src_ip), socket.inet_aton(dst_ip))
    header = header[:10] + struct.pack('!H', _checksum(header)) + header[12:]
    return dst_mac + src_mac + struct.pack('!H', ETH_IP) + header + icmp


def parse_frame(frame):
    """Return (dst, src, ethertype, payload) for untagged frames, None otherwise."""
    if len(frame) < 14:
        return None
    dst, src, etype = frame[:6], frame[6:12], struct.unpack('!H', frame[12:14])[0]
    if etype == ETH_VLAN:
        return None
    return dst, src, etype, frame[14:]


class BridgePort(asyncio.DatagramProtocol):
    """One VM NIC cabled to a simulated device."""

    def __init__(self, manager, rt, link_id, vm_nid, vm_ifn, sim_nid, sim_ifn, vm_port):
        self.manager = manager
        self.rt = rt
        self.link_id = link_id
        self.vm_nid, self.vm_ifn = vm_nid, vm_ifn
        self.sim_nid, self.sim_ifn = sim_nid, sim_ifn
        self.vm_addr = ('127.0.0.1', vm_port)
        self.transport = None
        self.vm_mac = None
        self.ips = {}           # VM IPv4 address -> prefix length
        self.gw = None          # VM default gateway (learned from frames it routes)
        self.last_seen = 0.0
        self.arp_waiters = {}   # ip -> [futures]
        self.echo_waiters = {}  # (ident, seq) -> future

    # ------------------------------------------------------------ asyncio protocol
    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        try:
            self.handle(data)
        except Exception as error:     # a malformed frame must never stop the bridge
            print(f'[simbridge] frame ignored: {error!r}')

    def error_received(self, exc):
        pass

    def close(self):
        if self.transport:
            self.transport.close()
        for futures in self.arp_waiters.values():
            for f in futures:
                if not f.done():
                    f.set_result(False)
        for f in self.echo_waiters.values():
            if not f.done():
                f.set_result(False)

    def send(self, frame):
        if self.transport:
            self.transport.sendto(frame, self.vm_addr)

    # ------------------------------------------------------------ helpers
    def endpoint_info(self):
        mac = self.vm_mac.hex() if self.vm_mac else ''
        return {'nid': self.vm_nid, 'ifn': self.vm_ifn, 'sim_nid': self.sim_nid, 'sim_ifn': self.sim_ifn,
                'ips': dict(self.ips), 'gw': self.gw,
                'mac': f'{mac[0:4]}.{mac[4:8]}.{mac[8:12]}' if mac else ''}

    def _domain_endpoints(self, net):
        dom = net.dom(self.vm_nid, self.vm_ifn)
        if dom.startswith('down|'):
            return None, []
        return dom, [e for e in net.eps() if e['dom'] == dom and e['nid'] != self.vm_nid]

    def _endpoint_by_mac(self, net, mac):
        _, eps = self._domain_endpoints(net)
        return next((e for e in eps if bridge_mac(self.rt.id, e['nid'], e['ifn']) == mac), None)

    def _learn_ip(self, ip):
        try:
            address = ipaddress.IPv4Address(ip)
        except ipaddress.AddressValueError:
            return
        if address.is_unspecified or address.is_multicast or address.is_loopback or ip in self.ips:
            return
        net = self.rt.net()
        _, eps = self._domain_endpoints(net)
        ln = next((e['ln'] for e in eps if address in ipaddress.IPv4Network(f"{e['ip']}/{e['ln']}", strict=False)), 24)
        self.ips[ip] = ln

    # ------------------------------------------------------------ frames from the VM
    def handle(self, frame):
        parsed = parse_frame(frame)
        if not parsed:
            return
        dst, src, etype, payload = parsed
        if src[0] & 1:
            return
        self.vm_mac = src
        self.last_seen = time.time()
        if etype == ETH_ARP and len(payload) >= 28:
            self._handle_arp(payload)
        elif etype == ETH_IP and len(payload) >= 20:
            self._handle_ip(dst, payload)

    def _handle_arp(self, payload):
        _, _, _, _, op, sha, spa, _, tpa = struct.unpack('!HHBBH6s4s6s4s', payload[:28])
        spa, tpa = _ip(spa), _ip(tpa)
        if spa != '0.0.0.0':
            self._learn_ip(spa)
        if op == 2:
            for f in self.arp_waiters.pop(spa, []):
                if not f.done():
                    f.set_result(True)
            return
        if op != 1 or tpa == spa:
            return
        net = self.rt.net()
        _, eps = self._domain_endpoints(net)
        target = next((e for e in eps if e['ip'] == tpa), None)
        if target:
            self.send(build_arp(2, bridge_mac(self.rt.id, target['nid'], target['ifn']), tpa, sha, spa))

    def _handle_ip(self, dst_mac, payload):
        ihl = (payload[0] & 0x0F) * 4
        proto = payload[9]
        src_ip, dst_ip = _ip(payload[12:16]), _ip(payload[16:20])
        self._learn_ip(src_ip)
        if proto != 1 or len(payload) < ihl + 8:
            return
        icmp = payload[ihl:]
        icmp_type, _, _, ident, seq = struct.unpack('!BBHHH', icmp[:8])
        if icmp_type not in (0, 8) or dst_mac[0] & 1:
            return
        net = self.rt.net()
        via = self._endpoint_by_mac(net, dst_mac)
        if via and via['ip'] != dst_ip and self.gw != via['ip']:
            self.gw = via['ip']             # the VM routes this packet through `via`
            net = self.rt.net()
        if icmp_type == 0:
            f = self.echo_waiters.pop((ident, seq), None)
            if f and not f.done():
                f.set_result(True)
            return
        if not via:
            return
        res = net.ping(self.vm_nid, dst_ip, src_ip=src_ip)
        if not res['ok']:
            return
        hops = len(res.get('hops', []))
        node = self.rt.node(res['dst_node']) if res.get('dst_node') is not None else None
        ttl = (255 if node and node['type'] in ('router', 'firewall', 'switch', 'l3switch', 'olt') else 128) - max(0, hops - 1)
        self.send(build_icmp_echo(dst_mac, self.vm_mac, dst_ip, src_ip, 0, ident, seq, icmp[8:], ttl))

    # ------------------------------------------------------------ requests from the simulation
    async def arp_probe(self, ip, sender_ip, sender_mac, timeout):
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.arp_waiters.setdefault(ip, []).append(future)
        self.send(build_arp(1, sender_mac, sender_ip, b'\0' * 6, ip))
        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            return False

    async def echo(self, src_ip, src_mac, dst_ip, timeout=1.0):
        if not self.vm_mac:
            if not await self.arp_probe(dst_ip, src_ip, src_mac, timeout):
                return False
        loop = asyncio.get_running_loop()
        ident, seq = int.from_bytes(os.urandom(2), 'big'), int.from_bytes(os.urandom(2), 'big')
        future = loop.create_future()
        self.echo_waiters[(ident, seq)] = future
        self.send(build_icmp_echo(src_mac, self.vm_mac, src_ip, dst_ip, 8, ident, seq, b'NexLab-sim-bridge' * 2))
        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            self.echo_waiters.pop((ident, seq), None)
            return False


class SimBridge:
    """All bridge ports, keyed by (lab id, link id)."""

    def __init__(self, real):
        self.real = real
        self.ports = {}

    @staticmethod
    def sim_side(rt, link):
        """(vm_end, sim_end) when the link joins a QEMU NIC to a simulated device, else None."""
        from .runtime import kind_of
        a, b = link.get('a', {}), link.get('b', {})
        na, nb = rt.by_id.get(a.get('node')), rt.by_id.get(b.get('node'))
        if not na or not nb:
            return None
        if na['type'] == 'qemu' and kind_of(nb['type']) == 'sim':
            return ('a', 'b')
        if nb['type'] == 'qemu' and kind_of(na['type']) == 'sim':
            return ('b', 'a')
        return None

    def ports_for(self, rt):
        return [p for (lab, _), p in self.ports.items() if lab == rt.id]

    def is_bridged(self, lab_id, link_id):
        return (lab_id, link_id) in self.ports

    def is_vm(self, rt, nid):
        return any(p.vm_nid == nid for p in self.ports_for(rt))

    def endpoints(self, rt):
        return [p.endpoint_info() for p in self.ports_for(rt)]

    async def sync(self, rt):
        lab = getattr(rt, 'lab', None)
        want = {}
        if lab:
            for link in lab.get('links', []):
                sides = self.sim_side(rt, link)
                if not sides:
                    continue
                vm_end, sim_end = link[sides[0]], link[sides[1]]
                if not self.real.is_running(rt.id, vm_end['node']):
                    continue
                pa, pb = self.real.link_ports(rt, link)
                vm_port, bridge_port = (pa, pb) if sides[0] == 'a' else (pb, pa)
                want[(rt.id, link['id'])] = (vm_end, sim_end, vm_port, bridge_port)
        for key in [k for k in self.ports if k[0] == rt.id and k not in want]:
            self.ports.pop(key).close()
        loop = asyncio.get_running_loop()
        for key, (vm_end, sim_end, vm_port, bridge_port) in want.items():
            port = self.ports.get(key)
            if port and (port.vm_nid, port.vm_ifn, port.sim_nid, port.sim_ifn) == (
                    vm_end['node'], vm_end['iface'], sim_end['node'], sim_end['iface']) and port.vm_addr[1] == vm_port:
                port.rt = rt
                continue
            if port:
                self.ports.pop(key).close()
            port = BridgePort(self, rt, key[1], vm_end['node'], vm_end['iface'], sim_end['node'], sim_end['iface'], vm_port)
            try:
                await loop.create_datagram_endpoint(lambda p=port: p, local_addr=('127.0.0.1', bridge_port))
            except OSError as error:
                print(f'[simbridge] port {bridge_port} tidak dapat dibuka: {error}')
                continue
            self.ports[key] = port

    def close_all(self):
        for port in self.ports.values():
            port.close()
        self.ports.clear()

    # ------------------------------------------------------------ used by LabRuntime.ping
    async def resolve(self, rt, ip, timeout=0.6):
        """Ask every bridged VM of the lab whether it owns `ip` (ARP). True when one answers."""
        ports = [p for p in self.ports_for(rt) if ip not in p.ips]
        if not ports:
            return False
        net = rt.net()
        jobs = []
        for port in ports:
            _, eps = port._domain_endpoints(net)
            if not eps and net.dom(port.vm_nid, port.vm_ifn).startswith('down|'):
                continue
            sender = next((e for e in eps if ipaddress.IPv4Address(ip) in
                           ipaddress.IPv4Network(f"{e['ip']}/{e['ln']}", strict=False)), None)
            sender_ip = sender['ip'] if sender else '0.0.0.0'
            sender_mac = bridge_mac(rt.id, sender['nid'], sender['ifn']) if sender else bridge_mac(rt.id, 'probe', port.link_id)
            jobs.append(port.arp_probe(ip, sender_ip, sender_mac, timeout))
        return any(await asyncio.gather(*jobs)) if jobs else False

    async def verify_ping(self, rt, net, res, src, dst):
        """Send a real ICMP echo to the VM a simulated ping reached; True when the VM answers."""
        vm = res['dst_node']
        hops = res.get('hops') or []
        port = next((p for p in self.ports_for(rt) if p.vm_nid == vm and dst in p.ips), None)
        if not port:
            return False
        sender_nid = hops[-2]['nid'] if len(hops) >= 2 else src
        dom = net.dom(port.vm_nid, port.vm_ifn)
        sender = next((e for e in net.node_eps(sender_nid) if e['dom'] == dom), None)
        if not sender:
            return False
        return await port.echo(res['src_ip'], bridge_mac(rt.id, sender['nid'], sender['ifn']), dst)
