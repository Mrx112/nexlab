"""Device state model, IP helpers and Cisco-style running-config generator."""
import hashlib
import re

# ---------------------------------------------------------------- IP helpers
def ip2i(s):
    p = str(s).split('.')
    if len(p) != 4:
        raise ValueError(s)
    v = 0
    for x in p:
        if not x.isdigit():
            raise ValueError(s)
        n = int(x)
        if n > 255:
            raise ValueError(s)
        v = v * 256 + n
    return v


def i2ip(v):
    return '.'.join(str((v >> s) & 255) for s in (24, 16, 8, 0))


def valid_ip(s):
    try:
        ip2i(s)
        return True
    except Exception:
        return False


def mask_len(m):
    v = ip2i(m)
    n = bin(v).count('1')
    if v != ((0xffffffff << (32 - n)) & 0xffffffff):
        raise ValueError('bad mask')
    return n


def valid_mask(m):
    try:
        mask_len(m)
        return True
    except Exception:
        return False


def len_mask(n):
    return i2ip((0xffffffff << (32 - n)) & 0xffffffff)


def net_of(ip, ln):
    return ip2i(ip) & ((0xffffffff << (32 - ln)) & 0xffffffff)


def bcast_of(ip, ln):
    return net_of(ip, ln) | (~((0xffffffff << (32 - ln)) & 0xffffffff) & 0xffffffff)


def in_net(ip, net, ln):
    return net_of(ip, ln) == net_of(net, ln)


def classful_len(ip):
    f = ip2i(ip) >> 24
    return 8 if f < 128 else 16 if f < 192 else 24


def wild_to_mask(w):
    return i2ip(~ip2i(w) & 0xffffffff)


def mac_for(*parts):
    h = hashlib.md5('|'.join(str(p) for p in parts).encode()).hexdigest()
    return '00d0.' + h[0:4] + '.' + h[4:8]


def mac_dash(mac):
    m = mac.replace('.', '')
    return '-'.join(m[i:i + 2] for i in range(0, 12, 2)).upper()


SHORT = [('TenGigabitEthernet', 'Te'), ('GigabitEthernet', 'Gi'), ('FastEthernet', 'Fa'),
         ('Ethernet', 'Et'), ('Wireless', 'Wl'), ('GPON', 'GPON'), ('Loopback', 'Lo'), ('Port-channel', 'Po'), ('Serial', 'Se'), ('Vlan', 'Vl')]


def short_if(n):
    for full, s in SHORT:
        if n.startswith(full):
            return s + n[len(full):]
    return n


def if_sort_key(n):
    order = ['FastEthernet', 'GigabitEthernet', 'TenGigabitEthernet', 'Ethernet', 'Serial', 'eth',
             'Port-channel', 'Loopback', 'Vlan']
    base = re.match(r'[A-Za-z\-]+', n)
    b = base.group(0) if base else n
    idx = order.index(b) if b in order else 50
    nums = [int(x) for x in re.findall(r'\d+', n)]
    return (idx, nums)


def hash_secret(p):
    return hashlib.sha256(('nexlab$' + p).encode()).hexdigest()


def show_secret(h):
    return '$1$' + h[:4] + '$' + h[4:26]


def type7(p):
    # cosmetic "type 7" look for service password-encryption
    return ''.join('%02X' % ((ord(c) + 7 * (i + 3)) & 0xff) for i, c in enumerate(p))


# ---------------------------------------------------------------- defaults
HOST_TYPES = ('pc', 'laptop', 'server', 'printer', 'ipphone', 'iot', 'tablet', 'smartphone', 'cctv')
ROUTER_TYPES = ('router', 'firewall')
SWITCH_TYPES = ('switch', 'l3switch', 'olt')


def new_state(t, name, ifaces):
    if t in HOST_TYPES:
        s = {'hostname': name, 'ip': '', 'mask': '', 'gw': '', 'dns': '', 'dhcp': False, 'scripts': {}}
        if any(i.startswith('Wireless') for i in ifaces):
            s['wifi'] = {'ssid': '', 'key': ''}
        if t == 'server':
            s['services'] = {
                'dhcp': {'enabled': False, 'start': '', 'max': 50, 'gw': '', 'dns': ''},
                'dns': {'enabled': False, 'records': {}},
                'http': {'enabled': True, 'index': '<html><body><h1>Selamat datang di ' + name + '</h1><p>Web server NexLab</p></body></html>'},
            }
        return s
    if t not in ROUTER_TYPES + SWITCH_TYPES:
        return {'hostname': name}
    s = {
        'hostname': name, 'enable_secret': None, 'enable_password': None, 'pw_encrypt': False,
        'banner': '', 'domain': '', 'domain_lookup': True,
        'ifaces': {}, 'routes': [], 'vlans': {'1': 'default'},
        'ip_routing': t in ROUTER_TYPES, 'default_gw': '',
        'ospf': None, 'rip': None, 'dhcp_pools': {}, 'dhcp_excluded': [], 'leases': {},
        'acls': {}, 'users': {}, 'rsa': False, 'extra': [], 'cdp': True,
        'lines': {'con': {'password': None, 'login': False},
                  'vty': {'password': None, 'login': False, 'transport': 'all'}},
    }
    for i in ifaces:
        if t in ROUTER_TYPES:
            s['ifaces'][i] = {'shutdown': True}
        else:
            s['ifaces'][i] = {'shutdown': False, 'mode': 'access', 'vlan': 1}
    if t in SWITCH_TYPES:
        s['ifaces']['Vlan1'] = {'shutdown': True}
    return s


# ---------------------------------------------------------------- running-config
def _pw(s, p):
    if s.get('pw_encrypt'):
        return '7 ' + type7(p)
    return p


def running_config(t, s, order=None):
    if t in HOST_TYPES:
        lines = [f"hostname {s.get('hostname', '')}",
                 f"ip address {s.get('ip') or 'dhcp' if s.get('dhcp') else s.get('ip', '')} {s.get('mask', '')}",
                 f"default-gateway {s.get('gw', '')}", f"dns-server {s.get('dns', '')}"]
        return '\n'.join(lines) + '\n'
    L = ['!', 'version 15.4',
         'no service timestamps log datetime msec', 'no service timestamps debug datetime msec',
         'service password-encryption' if s.get('pw_encrypt') else 'no service password-encryption',
         '!', f"hostname {s['hostname']}", '!']
    if s.get('enable_secret'):
        L.append(f"enable secret 5 {show_secret(s['enable_secret'])}")
    if s.get('enable_password'):
        L.append(f"enable password {_pw(s, s['enable_password'])}")
    L.append('!')
    for a, b in s.get('dhcp_excluded', []):
        L.append(f"ip dhcp excluded-address {a}" + (f" {b}" if b != a else ''))
    for name, p in s.get('dhcp_pools', {}).items():
        L.append(f"ip dhcp pool {name}")
        if p.get('network'):
            L.append(f" network {p['network']} {p['mask']}")
        if p.get('gw'):
            L.append(f" default-router {p['gw']}")
        if p.get('dns'):
            L.append(f" dns-server {p['dns']}")
        if p.get('domain'):
            L.append(f" domain-name {p['domain']}")
    if t in ROUTER_TYPES or t == 'l3switch':
        L += ['!', 'ip cef' if s.get('ip_routing') else 'no ip cef']
    if t == 'l3switch' and s.get('ip_routing'):
        L.append('ip routing')
    if t in ROUTER_TYPES and not s.get('ip_routing', True):
        L.append('no ip routing')
    L.append('!')
    for u, d in s.get('users', {}).items():
        if d.get('secret'):
            L.append(f"username {u} privilege {d.get('priv', 1)} secret 5 {show_secret(d['secret'])}")
        else:
            L.append(f"username {u} privilege {d.get('priv', 1)} password {_pw(s, d.get('password', ''))}")
    if s.get('domain'):
        L.append(f"ip domain-name {s['domain']}")
    if not s.get('domain_lookup', True):
        L.append('no ip domain-lookup')
    for x in s.get('extra', []):
        L.append(x)
    if t in SWITCH_TYPES:
        L += ['!', 'spanning-tree mode pvst']
    L.append('!')
    names = sorted(s['ifaces'].keys(), key=if_sort_key)
    for n in names:
        i = s['ifaces'][n]
        L.append(f"interface {n}")
        if i.get('desc'):
            L.append(f" description {i['desc']}")
        if i.get('dot1q'):
            L.append(f" encapsulation dot1Q {i['dot1q']}" + (' native' if i.get('native_sub') else ''))
        is_l2 = t in SWITCH_TYPES and not n.startswith(('Vlan', 'Loopback')) and i.get('mode') != 'routed'
        if t == 'l3switch' and i.get('mode') == 'routed':
            L.append(' no switchport')
        if is_l2:
            if i.get('mode') == 'trunk':
                if int(i.get('native', 1)) != 1:
                    L.append(f" switchport trunk native vlan {i['native']}")
                if i.get('allowed') not in (None, '', 'all'):
                    L.append(f" switchport trunk allowed vlan {i['allowed']}")
                L.append(' switchport mode trunk')
            else:
                if int(i.get('vlan', 1)) != 1:
                    L.append(f" switchport access vlan {i['vlan']}")
                if i.get('mode_set'):
                    L.append(' switchport mode access')
        else:
            if i.get('ip'):
                L.append(f" ip address {i['ip']} {i['mask']}")
            elif i.get('dhcp_client'):
                L.append(' ip address dhcp')
            else:
                L.append(' no ip address')
            if i.get('helper'):
                L.append(f" ip helper-address {i['helper']}")
            if i.get('nat'):
                L.append(f" ip nat {i['nat']}")
        if i.get('acl_in'):
            L.append(f" ip access-group {i['acl_in']} in")
        if i.get('acl_out'):
            L.append(f" ip access-group {i['acl_out']} out")
        for x in i.get('extra', []):
            L.append(' ' + x)
        if i.get('shutdown'):
            L.append(' shutdown')
        L.append('!')
    o = s.get('ospf')
    if o:
        L.append(f"router ospf {o.get('pid', 1)}")
        if o.get('rid'):
            L.append(f" router-id {o['rid']}")
        L.append(' log-adjacency-changes')
        for p in o.get('passive', []):
            L.append(f" passive-interface {p}")
        for nw in o.get('networks', []):
            L.append(f" network {nw['net']} {nw['wild']} area {nw['area']}")
        if o.get('default_originate'):
            L.append(' default-information originate')
        L.append('!')
    r = s.get('rip')
    if r:
        L.append('router rip')
        if r.get('version'):
            L.append(f" version {r['version']}")
        for p in r.get('passive', []):
            L.append(f" passive-interface {p}")
        for nw in r.get('networks', []):
            L.append(f" network {nw}")
        if r.get('default_originate'):
            L.append(' default-information originate')
        if not r.get('auto_summary', True):
            L.append(' no auto-summary')
        L.append('!')
    L.append('ip classless')
    for rt in s.get('routes', []):
        L.append(f"ip route {rt['net']} {rt['mask']} {rt['nh']}" + (f" {rt['ad']}" if rt.get('ad', 1) != 1 else ''))
    if s.get('default_gw'):
        L.append(f"ip default-gateway {s['default_gw']}")
    L.append('!')
    for name, entries in s.get('acls', {}).items():
        if name.isdigit():
            for e in entries:
                L.append(f"access-list {name} {e['text']}")
        else:
            kind = 'standard' if entries and entries[0].get('std') else 'extended'
            L.append(f"ip access-list {kind} {name}")
            for e in entries:
                L.append(f" {e['text']}")
    L.append('!')
    if s.get('banner'):
        L.append('banner motd ^C' + s['banner'] + '^C')
        L.append('!')
    ln = s.get('lines', {})
    L.append('line con 0')
    c = ln.get('con', {})
    if c.get('password'):
        L.append(f" password {_pw(s, c['password'])}")
    if c.get('login') == 'local':
        L.append(' login local')
    elif c.get('login'):
        L.append(' login')
    L.append('!')
    L.append('line aux 0')
    L.append('!')
    v = ln.get('vty', {})
    L.append('line vty 0 4')
    if v.get('password'):
        L.append(f" password {_pw(s, v['password'])}")
    if v.get('login') == 'local':
        L.append(' login local')
    elif v.get('login'):
        L.append(' login')
    if v.get('transport', 'all') != 'all':
        L.append(f" transport input {v['transport']}")
    L += ['!', '!', 'end']
    body = '\n'.join(L) + '\n'
    return f"Building configuration...\n\nCurrent configuration : {len(body)} bytes\n" + body
