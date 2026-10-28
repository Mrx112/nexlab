"""Built-in lab templates (shown in the 'New Lab' dialog)."""
from .templates import TEMPLATES, node_ifaces
from .state import new_state, hash_secret


def _node(nid, t, name, x, y, power='on'):
    ifs = node_ifaces(t, {})
    return {'id': nid, 'type': t, 'name': name, 'x': x, 'y': y, 'props': {}, 'ifaces': ifs,
            'state': new_state(t, name, ifs), 'startup': None, 'power': power}


def _link(i, a, ai, b, bi):
    return {'id': f'L{i}', 'a': {'node': a, 'iface': ai}, 'b': {'node': b, 'iface': bi}, 'style': 'copper'}


def basic_lan():
    n = [_node(1, 'router', 'R1', 420, 120, 'off'), _node(2, 'switch', 'SW1', 420, 300, 'off'),
         _node(3, 'pc', 'PC1', 260, 460, 'off'), _node(4, 'pc', 'PC2', 580, 460, 'off')]
    l = [_link(1, 1, 'GigabitEthernet0/0', 2, 'GigabitEthernet0/1'),
         _link(2, 2, 'FastEthernet0/1', 3, 'FastEthernet0'),
         _link(3, 2, 'FastEthernet0/2', 4, 'FastEthernet0')]
    return {'nodes': n, 'links': l, 'notes': [{'id': 1, 'x': 40, 'y': -40, 'text':
            'LATIHAN: beri IP R1 Gi0/0 192.168.1.1/24, no shutdown.\nPC1 & PC2: ipconfig 192.168.1.x 255.255.255.0 192.168.1.1\nLalu ping antar perangkat.'}]}


def demo_configured():
    """Router-on-a-stick + OSPF + DHCP + ACL, fully configured and powered on."""
    R1 = _node(1, 'router', 'R1', 420, 140)
    R2 = _node(2, 'router', 'R2', 760, 140)
    SW = _node(3, 'switch', 'SW1', 420, 330)
    PC1 = _node(4, 'pc', 'PC-Staff', 250, 500)
    PC2 = _node(5, 'laptop', 'PC-Guest', 590, 500)
    SRV = _node(6, 'server', 'Server', 980, 140)

    r1 = R1['state']
    r1['ifaces']['GigabitEthernet0/0'] = {'shutdown': False, 'desc': 'TRUNK ke SW1'}
    r1['ifaces']['GigabitEthernet0/0.10'] = {'shutdown': False, 'dot1q': 10, 'ip': '192.168.10.1', 'mask': '255.255.255.0'}
    r1['ifaces']['GigabitEthernet0/0.20'] = {'shutdown': False, 'dot1q': 20, 'ip': '192.168.20.1', 'mask': '255.255.255.0'}
    r1['ifaces']['GigabitEthernet0/1'] = {'shutdown': False, 'ip': '10.0.12.1', 'mask': '255.255.255.252', 'desc': 'WAN ke R2'}
    r1['ifaces']['Loopback0'] = {'shutdown': False, 'ip': '1.1.1.1', 'mask': '255.255.255.255'}
    r1['ospf'] = {'pid': 1, 'rid': '1.1.1.1', 'passive': [], 'networks': [
        {'net': '192.168.10.0', 'wild': '0.0.0.255', 'area': '0'},
        {'net': '192.168.20.0', 'wild': '0.0.0.255', 'area': '0'},
        {'net': '10.0.12.0', 'wild': '0.0.0.3', 'area': '0'},
        {'net': '1.1.1.1', 'wild': '0.0.0.0', 'area': '0'}]}
    r1['dhcp_pools'] = {'GUEST': {'network': '192.168.20.0', 'mask': '255.255.255.0', 'gw': '192.168.20.1', 'dns': '172.16.0.10'}}
    r1['dhcp_excluded'] = [['192.168.20.1', '192.168.20.9']]
    r1['enable_secret'] = hash_secret('cisco')
    r1['domain'] = 'lab.local'
    r1['rsa'] = True
    r1['users'] = {'admin': {'secret': hash_secret('admin123'), 'priv': 15}}
    r1['lines']['vty'] = {'password': None, 'login': 'local', 'transport': 'all'}
    r1['banner'] = 'Authorized access only - NexLab demo'
    # Guest VLAN may not reach the server's SSH/telnet, everything else allowed
    r1['acls'] = {'110': [
        {'action': 'deny', 'std': False, 'proto': 'tcp', 'src': ['192.168.20.0', '0.0.0.255'], 'dst': ['172.16.0.0', '0.0.0.255'],
         'port': ['eq', 22], 'text': 'deny tcp 192.168.20.0 0.0.0.255 172.16.0.0 0.0.0.255 eq 22'},
        {'action': 'permit', 'std': False, 'proto': 'ip', 'src': None, 'dst': None, 'port': None, 'text': 'permit ip any any'}]}
    r1['ifaces']['GigabitEthernet0/0.20']['acl_in'] = '110'

    r2 = R2['state']
    r2['ifaces']['GigabitEthernet0/0'] = {'shutdown': False, 'ip': '10.0.12.2', 'mask': '255.255.255.252'}
    r2['ifaces']['GigabitEthernet0/1'] = {'shutdown': False, 'ip': '172.16.0.1', 'mask': '255.255.255.0', 'desc': 'Server farm'}
    r2['ifaces']['Loopback0'] = {'shutdown': False, 'ip': '2.2.2.2', 'mask': '255.255.255.255'}
    r2['ospf'] = {'pid': 1, 'rid': '2.2.2.2', 'passive': ['GigabitEthernet0/1'], 'networks': [
        {'net': '0.0.0.0', 'wild': '255.255.255.255', 'area': '0'}]}
    r2['lines']['vty'] = {'password': 'cisco', 'login': True, 'transport': 'all'}

    sw = SW['state']
    sw['vlans'].update({'10': 'STAFF', '20': 'GUEST', '99': 'MGMT'})
    sw['ifaces']['FastEthernet0/1'].update(vlan=10, mode_set=True)
    sw['ifaces']['FastEthernet0/2'].update(vlan=20, mode_set=True)
    sw['ifaces']['GigabitEthernet0/1'].update(mode='trunk', mode_set=True, allowed='10,20,99')
    sw['ifaces']['Vlan1'] = {'shutdown': True}

    PC1['state'].update(ip='192.168.10.10', mask='255.255.255.0', gw='192.168.10.1', dns='172.16.0.10')
    PC2['state'].update(dhcp=True)
    SRV['state'].update(ip='172.16.0.10', mask='255.255.255.0', gw='172.16.0.1', dns='172.16.0.10')
    SRV['state']['services']['dns'] = {'enabled': True, 'records': {'r1.lab.local': '1.1.1.1', 'server.lab.local': '172.16.0.10',
                                                                   'r2.lab.local': '2.2.2.2'}}
    for n in (R1, R2, SW):
        n['startup'] = __import__('copy').deepcopy(n['state'])
    l = [_link(1, 1, 'GigabitEthernet0/0', 3, 'GigabitEthernet0/1'),
         _link(2, 3, 'FastEthernet0/1', 4, 'FastEthernet0'),
         _link(3, 3, 'FastEthernet0/2', 5, 'FastEthernet0'),
         _link(4, 1, 'GigabitEthernet0/1', 2, 'GigabitEthernet0/0'),
         _link(5, 2, 'GigabitEthernet0/1', 6, 'FastEthernet0')]
    notes = [{'id': 1, 'x': 230, 'y': -40, 'text': 'DEMO: Router-on-a-stick (VLAN10/20) + OSPF + DHCP(GUEST) + DNS + ACL 110\n'
              'Coba di PC-Staff:  ping 172.16.0.10   |  tracert 2.2.2.2  |  nslookup r2.lab.local\n'
              'Coba di PC-Guest:  ipconfig /renew  |  ssh -l admin 1.1.1.1 (pass admin123)\n'
              'R1 enable secret: cisco   |   telnet ke R2 password: cisco'}]
    return {'nodes': [R1, R2, SW, PC1, PC2, SRV], 'links': l, 'notes': notes}


def multi_site():
    nodes, links = [], []
    for i, (x, y) in enumerate([(300, 160), (700, 160), (500, 420)], 1):
        nodes.append(_node(i, 'router', f'R{i}', x, y, 'off'))
    for i, (x, y) in enumerate([(120, 300), (880, 300), (500, 600)], 4):
        nodes.append(_node(i, 'switch', f'SW{i - 3}', x, y, 'off'))
    for i, (x, y) in enumerate([(60, 460), (940, 460), (500, 760)], 7):
        nodes.append(_node(i, 'pc', f'PC{i - 6}', x, y, 'off'))
    links = [_link(1, 1, 'GigabitEthernet0/0', 2, 'GigabitEthernet0/0'),
             _link(2, 1, 'GigabitEthernet0/1', 3, 'GigabitEthernet0/0'),
             _link(3, 2, 'GigabitEthernet0/1', 3, 'GigabitEthernet0/1'),
             _link(4, 1, 'GigabitEthernet0/2', 4, 'GigabitEthernet0/1'),
             _link(5, 2, 'GigabitEthernet0/2', 5, 'GigabitEthernet0/1'),
             _link(6, 3, 'GigabitEthernet0/2', 6, 'GigabitEthernet0/1'),
             _link(7, 4, 'FastEthernet0/1', 7, 'FastEthernet0'),
             _link(8, 5, 'FastEthernet0/1', 8, 'FastEthernet0'),
             _link(9, 6, 'FastEthernet0/1', 9, 'FastEthernet0')]
    return {'nodes': nodes, 'links': links, 'notes': [{'id': 1, 'x': 40, 'y': -40, 'text':
            'LATIHAN OSPF 3 site: konfigurasi IP WAN /30, LAN tiap site, lalu router ospf 1 sampai semua PC saling ping.'}]}


def ftth_home():
    """ISP -> OLT -> ODP -> ONT -> router rumah -> AP WiFi + PC, fully configured."""
    import copy
    SRV = _node(1, 'server', 'Server-ISP', 120, 120)
    ISP = _node(2, 'router', 'R-ISP', 330, 120)
    OLT = _node(3, 'olt', 'OLT', 540, 120)
    ODP = _node(4, 'odp', 'ODP-01', 540, 300)
    ONT = _node(5, 'ont', 'ONT-Rumah', 540, 460)
    HR = _node(6, 'router', 'Router-Rumah', 330, 460)
    AP = _node(7, 'ap', 'AP-Rumah', 160, 560)
    PC = _node(8, 'pc', 'PC-Kerja', 330, 700)
    LAP = _node(9, 'laptop', 'Laptop', 40, 700)
    HP = _node(10, 'smartphone', 'HP', 170, 720)
    CAM = _node(11, 'cctv', 'CCTV', 480, 700)
    SW = _node(12, 'switch', 'SW-Rumah', 330, 560)
    AP['props'] = {'ssid': 'Rumah-WiFi', 'security': 'WPA2-PSK', 'key': 'rumah12345', 'channel': 6, 'band': '2.4 GHz'}
    ODP['props'] = {'ratio': '1:8'}
    SRV['state'].update(ip='172.16.0.10', mask='255.255.255.0', gw='172.16.0.1', dns='172.16.0.10')
    SRV['state']['services']['dns'] = {'enabled': True, 'records': {'portal.isp.local': '172.16.0.10'}}
    SRV['state']['services']['http']['index'] = '<html><body><h1>Portal ISP NexLab</h1><p>Koneksi FTTH Anda aktif.</p></body></html>'
    i = ISP['state']
    i['ifaces']['GigabitEthernet0/0'] = {'shutdown': False, 'ip': '172.16.0.1', 'mask': '255.255.255.0', 'desc': 'Server farm'}
    i['ifaces']['GigabitEthernet0/1'] = {'shutdown': False, 'ip': '10.10.0.1', 'mask': '255.255.255.0', 'desc': 'Ke OLT (VLAN 100)'}
    i['routes'] = [{'net': '192.168.1.0', 'mask': '255.255.255.0', 'nh': '10.10.0.2', 'ad': 1}]
    o = OLT['state']
    o['vlans'].update({'100': 'INTERNET'})
    o['ifaces']['GigabitEthernet0/1'].update(vlan=100, mode_set=True, desc='Uplink R-ISP')
    o['ifaces']['GPON0/1'].update(vlan=100, mode_set=True, desc='PON ODP-01')
    h = HR['state']
    h['ifaces']['GigabitEthernet0/0'] = {'shutdown': False, 'ip': '10.10.0.2', 'mask': '255.255.255.0', 'desc': 'WAN ke ONT'}
    h['ifaces']['GigabitEthernet0/1'] = {'shutdown': False, 'ip': '192.168.1.1', 'mask': '255.255.255.0', 'desc': 'LAN/WiFi'}
    h['routes'] = [{'net': '0.0.0.0', 'mask': '0.0.0.0', 'nh': '10.10.0.1', 'ad': 1}]
    h['dhcp_pools'] = {'RUMAH': {'network': '192.168.1.0', 'mask': '255.255.255.0', 'gw': '192.168.1.1', 'dns': '172.16.0.10'}}
    h['dhcp_excluded'] = [['192.168.1.1', '192.168.1.9']]
    for n in (LAP, HP):
        n['state'].update(dhcp=True)
        n['state']['wifi'] = {'ssid': 'Rumah-WiFi', 'key': 'rumah12345'}
    PC['state'].update(dhcp=True)
    CAM['state'].update(ip='192.168.1.5', mask='255.255.255.0', gw='192.168.1.1')
    PC['state']['scripts'] = {'cek-internet': 'echo Cek koneksi rumah ${HOST}\nif ping 192.168.1.1\n  echo [OK] router rumah\nelse\n  echo [GAGAL] router rumah\nend\nif ping 172.16.0.10\n  echo [OK] server ISP\nelse\n  echo [GAGAL] server ISP\nend\nbrowser portal.isp.local'}
    for n in (ISP, OLT, HR):
        n['startup'] = copy.deepcopy(n['state'])
    l = [_link(1, 1, 'FastEthernet0', 2, 'GigabitEthernet0/0'), _link(2, 2, 'GigabitEthernet0/1', 3, 'GigabitEthernet0/1'),
         _link(3, 3, 'GPON0/1', 4, 'IN'), _link(4, 4, 'OUT1', 5, 'PON'), _link(5, 5, 'LAN1', 6, 'GigabitEthernet0/0'),
         _link(6, 6, 'GigabitEthernet0/1', 12, 'GigabitEthernet0/1'), _link(7, 7, 'Wireless0', 9, 'Wireless0'),
         _link(8, 7, 'Wireless1', 10, 'Wireless0'), _link(9, 12, 'FastEthernet0/2', 8, 'FastEthernet0'),
         _link(10, 12, 'FastEthernet0/3', 11, 'FastEthernet0'), _link(11, 12, 'FastEthernet0/1', 7, 'GigabitEthernet0')]
    notes = [{'id': 1, 'x': 700, 'y': 80, 'text': 'FTTH RUMAH: Server-ISP - R-ISP - OLT - ODP 1:8 - ONT - Router rumah - SW rumah - AP WiFi / PC / CCTV\n'
              'WiFi: SSID Rumah-WiFi / rumah12345 (Laptop & HP otomatis DHCP)\n'
              'Coba di Laptop: ipconfig | ping 172.16.0.10 | browser portal.isp.local\n'
              'Di PC-Kerja: run cek-internet\n'
              'Buka tab Peta 3D lalu pilih template "Rumah 2 lantai + FTTH" untuk instalasi fisiknya.'}]
    return {'nodes': [SRV, ISP, OLT, ODP, ONT, HR, AP, PC, LAP, HP, CAM, SW], 'links': l, 'notes': notes}


TEMPLATE_LABS = {
    'blank': ('Lab kosong', lambda: {'nodes': [], 'links': [], 'notes': []}),
    'basic': ('Latihan LAN dasar (belum dikonfigurasi)', basic_lan),
    'ospf': ('Latihan OSPF 3 site (belum dikonfigurasi)', multi_site),
    'demo': ('Demo lengkap terkonfigurasi (VLAN, OSPF, DHCP, DNS, ACL, SSH)', demo_configured),
    'ftth': ('Rumah FTTH + WiFi terkonfigurasi (OLT, ODP, ONT, AP, script)', ftth_home),
}
