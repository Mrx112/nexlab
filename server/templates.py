"""Device catalog (palette)."""

def _r(prefix, a, b):
    return [f'{prefix}{i}' for i in range(a, b + 1)]


TEMPLATES = {
    # ------------------------------------------------ simulated (no root, ~0 RAM)
    'router': dict(label='Router', model='ISR4331', category='Routers', kind='sim', cli='ios', prefix='R',
                   ifaces=_r('GigabitEthernet0/', 0, 3),
                   desc='Router IOS: static, OSPF, RIP, sub-interface 802.1Q, DHCP server/relay, ACL'),
    'firewall': dict(label='Firewall', model='ISR-FW 1100', category='Security', kind='sim', cli='ios', prefix='FW',
                     ifaces=_r('GigabitEthernet0/', 0, 5),
                     desc='Router keamanan berbasis IOS: ACL standard/extended (ip access-group in/out)'),
    'switch': dict(label='Switch L2', model='WS-C2960-24TT', category='Switches', kind='sim', cli='ios', prefix='SW',
                   ifaces=_r('FastEthernet0/', 1, 24) + _r('GigabitEthernet0/', 1, 2),
                   desc='Switch L2: VLAN, access/trunk, native VLAN, allowed VLAN, SVI manajemen'),
    'l3switch': dict(label='Switch L3', model='WS-C3650-24PS', category='Switches', kind='sim', cli='ios', prefix='MLS',
                     ifaces=_r('GigabitEthernet1/0/', 1, 24) + _r('GigabitEthernet1/1/', 1, 4),
                     desc='Multilayer switch: SVI inter-VLAN routing, ip routing, no switchport, OSPF/RIP'),
    'pc': dict(label='PC', model='PC-PT', category='End Devices', kind='sim', cli='pc', prefix='PC',
               ifaces=['FastEthernet0'], desc='PC dengan Command Prompt ala Packet Tracer (ipconfig, ping, tracert, telnet, ssh)'),
    'laptop': dict(label='Laptop', model='Laptop-PT', category='End Devices', kind='sim', cli='pc', prefix='Laptop',
                   ifaces=['FastEthernet0', 'Wireless0'], desc='Laptop: port kabel FastEthernet0 atau WiFi Wireless0'),
    'server': dict(label='Server', model='Server-PT', category='End Devices', kind='sim', cli='pc', prefix='Server',
                   ifaces=['FastEthernet0'], desc='Server dengan layanan DHCP & DNS'),
    'hub': dict(label='Hub', model='Hub-PT', category='Connections', kind='cloud', cli=None, prefix='Hub',
                ifaces=_r('Port', 0, 7), desc='Hub: semua port satu collision/broadcast domain'),
    'ap': dict(label='Access Point', model='AccessPoint-PT', category='Wireless', kind='cloud', cli=None, prefix='AP',
               ifaces=['GigabitEthernet0'] + _r('Wireless', 0, 15),
               desc='Access point WiFi: klien wireless harus memakai SSID & password yang sama (WPA2-PSK / Open)'),
    'olt': dict(label='OLT', model='OLT-GPON 8P', category='Fiber / FTTH', kind='sim', cli='ios', prefix='OLT',
                ifaces=_r('GigabitEthernet0/', 1, 2) + _r('GPON0/', 1, 8),
                desc='Optical Line Terminal: uplink Gigabit + 8 port GPON; CLI switch (VLAN layanan per port PON)'),
    'odp': dict(label='ODP / Splitter', model='ODP 1:8', category='Fiber / FTTH', kind='cloud', cli=None, prefix='ODP',
                ifaces=['IN'] + _r('OUT', 1, 16),
                desc='Optical Distribution Point berisi splitter pasif (1:4 / 1:8 / 1:16)'),
    'ont': dict(label='ONT / Modem', model='ONT-GPON', category='Fiber / FTTH', kind='cloud', cli=None, prefix='ONT',
                ifaces=['PON'] + _r('LAN', 1, 4),
                desc='Optical Network Terminal di rumah pelanggan (mode bridge): PON ke ODP, LAN ke router/PC'),
    'printer': dict(label='Printer', model='Printer-PT', category='End Devices', kind='sim', cli='pc', prefix='Printer',
                    ifaces=['FastEthernet0'], desc='Printer jaringan'),
    'ipphone': dict(label='IP Phone', model='IP Phone 7960', category='End Devices', kind='sim', cli='pc', prefix='Phone',
                    ifaces=['FastEthernet0'], desc='Telepon IP (VoIP), biasanya di VLAN voice'),
    'cctv': dict(label='Kamera CCTV', model='IP Camera', category='End Devices', kind='sim', cli='pc', prefix='CCTV',
                 ifaces=['FastEthernet0'], desc='Kamera IP / CCTV'),
    'smartphone': dict(label='Smartphone', model='Smartphone-PT', category='Wireless', kind='sim', cli='pc', prefix='HP',
                       ifaces=['Wireless0'], desc='Ponsel: sambung ke port Wireless pada Access Point'),
    'tablet': dict(label='Tablet', model='Tablet-PT', category='Wireless', kind='sim', cli='pc', prefix='Tab',
                   ifaces=['Wireless0'], desc='Tablet wireless'),
    'iot': dict(label='Perangkat IoT', model='IoT Sensor', category='Wireless', kind='sim', cli='pc', prefix='IoT',
                ifaces=['Wireless0'], desc='Sensor/IoT wireless'),
    'cloud': dict(label='Cloud / Hub', model='Cloud-PT', category='Connections', kind='cloud', cli=None, prefix='Cloud',
                  ifaces=_r('eth', 0, 7),
                  desc='Mode simulasi: hub/segmen bersama. Mode real: bridge ke NIC fisik/bridge host (perangkat sungguhan)'),
    # ------------------------------------------------ real (root required on the Linux server)
    'qemu': dict(label='QEMU VM', model='QEMU/KVM', category='Real / Virtual', kind='real', cli=None, prefix='VM',
                 ifaces=None, needs_root=True,
                 desc='Image asli (vIOS, CSR1000v, vEOS, MikroTik CHR, VyOS, FortiGate, Linux...) dari data/images/qemu'),
    'netns': dict(label='Linux Host', model='netns', category='Real / Virtual', kind='real', cli=None, prefix='Linux',
                  ifaces=['eth0'], needs_root=True,
                  desc='Host Linux super ringan (network namespace) dengan stack TCP/IP asli & shell bash — khusus server Linux (sudo)'),
    'remote': dict(label='Perangkat Fisik', model='Remote', category='Real / Virtual', kind='remote', cli=None,
                   prefix='HW', ifaces=None,
                   desc='Perangkat jaringan sungguhan di LAN: console via Telnet/SSH dari browser'),
}

PROP_DEFAULTS = {
    'qemu': {'image': '', 'ram': 512, 'cpus': 1, 'nics': 4, 'nic_model': 'e1000', 'console': 'telnet'},
    'netns': {'ip': '', 'gw': '', 'dhcp': False},
    'cloud': {'target': '', 'hostfwd': ''},
    'ap': {'ssid': 'NexLab-WiFi', 'security': 'WPA2-PSK', 'key': 'nexlab123', 'channel': 6, 'band': '2.4 GHz'},
    'odp': {'ratio': '1:8'},
    'ont': {'sn': ''},
    'remote': {'host': '', 'port': 23, 'protocol': 'telnet', 'username': '', 'ports': 'Gi0/0,Gi0/1,Gi0/2,Gi0/3'},
}


def node_ifaces(t, props):
    tpl = TEMPLATES[t]
    if tpl['ifaces'] is not None:
        return list(tpl['ifaces'])
    if t == 'qemu':
        n = max(1, min(16, int(props.get('nics') or 4)))
        return [f'e{i}' for i in range(n)]
    if t == 'remote':
        ports = [p.strip() for p in str(props.get('ports') or '').split(',') if p.strip()]
        return ports or ['port1']
    return []


def catalog():
    out = []
    for k, v in TEMPLATES.items():
        d = {x: y for x, y in v.items() if x != 'ifaces'}
        d['type'] = k
        d['props'] = PROP_DEFAULTS.get(k, {})
        out.append(d)
    return out
