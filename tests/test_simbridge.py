import asyncio
import socket
import struct
import tempfile
import time
import unittest

from server.app import build_app
from server.demo import _link, _node
from server.simbridge import ETH_ARP, ETH_IP, build_arp, build_icmp_echo, parse_frame

VM_MAC = bytes.fromhex('500001040000')
VM_IP = '192.168.10.30'


class FakeVM(asyncio.DatagramProtocol):
    """Stands in for QEMU's UDP socket netdev: answers ARP and ICMP echo for VM_IP."""

    def __init__(self):
        self.frames = asyncio.Queue()
        self.answer = True
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        dst, src, etype, payload = parse_frame(data)
        if self.answer and etype == ETH_ARP:
            op, sha, spa, tpa = struct.unpack('!6xH6s4s6x4s', payload[:28])
            if op == 1 and socket.inet_ntoa(tpa) == VM_IP:
                self.transport.sendto(build_arp(2, VM_MAC, VM_IP, sha, socket.inet_ntoa(spa)), addr)
                return
        if self.answer and etype == ETH_IP and payload[9] == 1 and payload[20] == 8:
            ident, seq = struct.unpack('!HH', payload[24:28])
            self.transport.sendto(build_icmp_echo(VM_MAC, src, VM_IP, socket.inet_ntoa(payload[12:16]), 0,
                                                  ident, seq, payload[28:]), addr)
            return
        self.frames.put_nowait((dst, src, etype, payload))


class SimBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app = build_app(tempfile.mkdtemp(), 1)
        db, mgr, self.real = self.app['db'], self.app['mgr'], self.app['real']
        lid = db.x('INSERT INTO labs(owner,name,description,data,created,updated) VALUES(?,?,?,?,?,?)',
                   (1, 'b', '', '{"nodes":[],"links":[]}', time.time(), time.time()))
        self.rt = rt = mgr.get(lid)
        nodes = [_node(1, 'switch', 'SW', 0, 0, 'off'), _node(2, 'pc', 'PC1', 0, 0, 'off'), _node(4, 'qemu', 'VM', 0, 0, 'off')]
        links = [_link(1, 1, 'FastEthernet0/1', 2, 'FastEthernet0'), _link(3, 4, 'e0', 1, 'FastEthernet0/5')]
        rt.update_topology(nodes, links, [])
        for nid in (1, 2):
            await rt.start_node(nid, {'role': 'admin', 'id': 1})
            rt.boot[nid] = time.time() - 120
        rt.state(2).update(ip='192.168.10.21', mask='255.255.255.0', dhcp=False)
        self.real.nodes[(lid, 4)] = {'proc': None, 'taps': {}, 'mode': 'socket'}   # VM "running"
        link = next(l for l in rt.lab['links'] if l['id'] == 'L3')
        vm_port, self.bridge_port = self.real.link_ports(rt, link)   # VM is side a of L3
        loop = asyncio.get_running_loop()
        self.vm_transport, self.vm = await loop.create_datagram_endpoint(FakeVM, local_addr=('127.0.0.1', vm_port))
        await self.real.bridge.sync(rt)

    async def asyncTearDown(self):
        self.vm_transport.close()
        self.real.bridge.close_all()

    def send(self, frame):
        self.vm_transport.sendto(frame, ('127.0.0.1', self.bridge_port))

    async def test_link_is_bridged_not_documentation_only(self):
        status = self.rt.status()['links']['L3']
        self.assertTrue(status['bridged'])
        self.assertFalse(status['mixed'])

    async def test_vm_resolves_and_pings_simulated_pc(self):
        self.send(build_arp(1, VM_MAC, VM_IP, b'\0' * 6, '192.168.10.21'))
        dst, src, etype, payload = await asyncio.wait_for(self.vm.frames.get(), 2)
        self.assertEqual(etype, ETH_ARP)
        self.assertEqual(socket.inet_ntoa(payload[14:18]), '192.168.10.21')
        pc_mac = payload[8:14]
        self.send(build_icmp_echo(VM_MAC, pc_mac, VM_IP, '192.168.10.21', 8, 7, 1, b'hello'))
        dst, src, etype, payload = await asyncio.wait_for(self.vm.frames.get(), 2)
        self.assertEqual((etype, payload[20]), (ETH_IP, 0))              # ICMP echo reply
        self.assertEqual(socket.inet_ntoa(payload[12:16]), '192.168.10.21')
        self.assertEqual(payload[28:], b'hello')

    async def test_vm_gets_no_answer_for_unused_address(self):
        self.send(build_arp(1, VM_MAC, VM_IP, b'\0' * 6, '192.168.10.99'))
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.vm.frames.get(), 0.5)

    async def test_simulated_ping_to_vm_depends_on_the_real_vm(self):
        res = await self.rt.ping(2, VM_IP)
        self.assertTrue(res['ok'], res)                                  # discovered by ARP, confirmed by echo
        self.vm.answer = False                                           # e.g. VM firewall drops ICMP
        res = await self.rt.ping(2, VM_IP)
        self.assertFalse(res['ok'])

    async def test_bridge_closes_when_vm_stops(self):
        self.real.nodes.pop((self.rt.id, 4))
        await self.real.bridge.sync(self.rt)
        self.assertEqual(self.real.bridge.ports_for(self.rt), [])


class RoutedSimBridgeTests(SimBridgeTests.__base__):
    """VM in 192.168.10.0/24 behind router R1; PC2 in 192.168.20.0/24 on R1's other port."""

    async def asyncSetUp(self):
        self.app = build_app(tempfile.mkdtemp(), 1)
        db, mgr, self.real = self.app['db'], self.app['mgr'], self.app['real']
        lid = db.x('INSERT INTO labs(owner,name,description,data,created,updated) VALUES(?,?,?,?,?,?)',
                   (1, 'r', '', '{"nodes":[],"links":[]}', time.time(), time.time()))
        self.rt = rt = mgr.get(lid)
        nodes = [_node(1, 'switch', 'SW', 0, 0, 'off'), _node(2, 'router', 'R1', 0, 0, 'off'),
                 _node(3, 'pc', 'PC2', 0, 0, 'off'), _node(4, 'qemu', 'VM', 0, 0, 'off')]
        links = [_link(1, 1, 'FastEthernet0/1', 2, 'GigabitEthernet0/0'), _link(2, 2, 'GigabitEthernet0/1', 3, 'FastEthernet0'),
                 _link(3, 4, 'e0', 1, 'FastEthernet0/5')]
        rt.update_topology(nodes, links, [])
        ifaces = rt.state(2)['ifaces']
        ifaces['GigabitEthernet0/0'] = {'shutdown': False, 'ip': '192.168.10.1', 'mask': '255.255.255.0'}
        ifaces['GigabitEthernet0/1'] = {'shutdown': False, 'ip': '192.168.20.1', 'mask': '255.255.255.0'}
        rt.state(3).update(ip='192.168.20.5', mask='255.255.255.0', gw='192.168.20.1', dhcp=False)
        for nid in (1, 2, 3):
            await rt.start_node(nid, {'role': 'admin', 'id': 1})
            rt.boot[nid] = time.time() - 120
        self.real.nodes[(lid, 4)] = {'proc': None, 'taps': {}, 'mode': 'socket'}
        link = next(l for l in rt.lab['links'] if l['id'] == 'L3')
        vm_port, self.bridge_port = self.real.link_ports(rt, link)
        self.vm_transport, self.vm = await asyncio.get_running_loop().create_datagram_endpoint(
            FakeVM, local_addr=('127.0.0.1', vm_port))
        await self.real.bridge.sync(rt)

    async def asyncTearDown(self):
        self.vm_transport.close()
        self.real.bridge.close_all()

    async def test_pc_behind_router_pings_vm_and_vm_pings_back(self):
        res = await self.rt.ping(3, VM_IP)                 # VM gateway learned from its real reply
        self.assertTrue(res['ok'], res)
        self.vm_transport.sendto(build_arp(1, VM_MAC, VM_IP, b'\0' * 6, '192.168.10.1'), ('127.0.0.1', self.bridge_port))
        _, _, _, payload = await asyncio.wait_for(self.vm.frames.get(), 2)
        router_mac = payload[8:14]
        self.vm_transport.sendto(build_icmp_echo(VM_MAC, router_mac, VM_IP, '192.168.20.5', 8, 9, 1, b'x'),
                                 ('127.0.0.1', self.bridge_port))
        _, _, etype, payload = await asyncio.wait_for(self.vm.frames.get(), 2)
        self.assertEqual((etype, payload[20], socket.inet_ntoa(payload[12:16])), (ETH_IP, 0, '192.168.20.5'))


if __name__ == '__main__':
    unittest.main()
