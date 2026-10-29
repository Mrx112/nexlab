"""Simulation engine.

Computes L2 broadcast domains (VLAN/trunk/802.1Q subinterfaces), the L3 routing
table of every device (connected / static / OSPF / RIP), ACL filtering, DHCP,
DNS and the path of a packet (ping / traceroute / telnet / ssh).
Everything is calculated on demand from the lab state, so it costs almost no
CPU or RAM when idle.
"""
import time

from .state import (ip2i, i2ip, mask_len, len_mask, net_of, bcast_of, in_net,
                    classful_len, valid_ip, mac_for)

SWITCH = {'switch', 'l3switch', 'olt'}
ROUTER = {'router', 'firewall'}
HOST = {'pc', 'laptop', 'server', 'printer', 'ipphone', 'iot', 'tablet', 'smartphone', 'cctv'}
HUB = {'cloud', 'hub', 'ap', 'odp', 'ont'}          # passive / always-on L2 segments
SIM = SWITCH | ROUTER | HOST | HUB

STP_LISTEN_SEC = 15
STP_LEARN_SEC = 15


def L3(n, i):
    return f'{n}|L3|{i}'


def VP(n, v):
    return f'{n}|V|{int(v)}'


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        p = self.p
        p.setdefault(x, x)
        root = x
        while p[root] != root:
            root = p[root]
        while p[x] != root:
            p[x], x = root, p[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def parse_vlan_list(s):
    if s in (None, '', 'all'):
        return None
    out = set()
    for part in str(s).split(','):
        part = part.strip()
        if not part or part == 'none':
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return out


def addr_match(spec, ip):
    if spec is None:
        return True
    net, wild = spec
    w = ip2i(wild)
    return (ip2i(ip) & ~w & 0xffffffff) == (ip2i(net) & ~w & 0xffffffff)


def acl_match(ent, pkt):
    if not addr_match(ent.get('src'), pkt['src']):
        return False
    if ent.get('std'):
        return True
    p = ent.get('proto', 'ip')
    if p not in ('ip', pkt['proto']):
        return False
    if not addr_match(ent.get('dst'), pkt['dst']):
        return False
    port = ent.get('port')
    if port:
        if pkt['proto'] not in ('tcp', 'udp') or pkt.get('dport') is None:
            return False
        op, n = port
        dp = pkt['dport']
        if (op == 'eq' and dp != n) or (op == 'neq' and dp == n) or \
           (op == 'gt' and not dp > n) or (op == 'lt' and not dp < n):
            return False
    return True


class Net:
    def __init__(self, rt):
        self.rt = rt
        self.nodes = {n['id']: n for n in rt.lab['nodes']}
        self.links = rt.lab['links']
        self.port_link = {}
        for l in self.links:
            self.port_link[(l['a']['node'], l['a']['iface'])] = l
            self.port_link[(l['b']['node'], l['b']['iface'])] = l
        self.uf = UF()
        self._eps = None
        self._routes = {}
        self._dyn = None
        self.adj = {'ospf': {}, 'rip': {}}
        self._build()

    # ------------------------------------------------------------ basics
    def t(self, nid):
        return self.nodes[nid]['type']

    def st(self, nid):
        return self.rt.state(nid)

    def name(self, nid):
        return self.st(nid).get('hostname') or self.nodes[nid]['name']

    def running(self, nid):
        n = self.nodes.get(nid)
        return bool(n) and n['type'] in SIM and self.rt.is_running(nid)

    def peer(self, l, nid, ifn):
        if l['a']['node'] == nid and l['a']['iface'] == ifn:
            return l['b']['node'], l['b']['iface']
        return l['a']['node'], l['a']['iface']

    def host_if(self, nid):
        ifs = self.nodes[nid].get('ifaces') or ['FastEthernet0']
        for i in ifs:
            if (nid, i) in self.port_link:
                return i
        return ifs[0]

    def iface(self, nid, ifn):
        return self.st(nid).get('ifaces', {}).get(ifn)

    def admin_up(self, nid, ifn):
        t = self.t(nid)
        if t in HOST or t in HUB:
            return True
        if t not in SIM:
            return False
        i = self.iface(nid, ifn)
        if i is None or i.get('shutdown'):
            return False
        if '.' in ifn:
            return self.admin_up(nid, ifn.split('.')[0])
        return True

    def link_up(self, nid, ifn):
        base = ifn.split('.')[0]
        if not self.running(nid) or not self.admin_up(nid, base):
            return False
        l = self.port_link.get((nid, base))
        if not l:
            return False
        pn, pi = self.peer(l, nid, base)
        if not (pn in self.nodes and self.running(pn) and self.admin_up(pn, pi)):
            return False
        return self.wifi_ok(nid, base, pn, pi)

    def _port_stp_state(self, nid, ifn):
        """Simulated STP port state: listening → learning → forwarding.

        Non-switch ports always forward.  Switch ports transition based on how
        long the node has been running.
        """
        t = self.t(nid)
        if t not in SWITCH:
            return 'forwarding'
        if ifn.startswith(('Vlan', 'Loopback')) or '.' in ifn:
            return 'forwarding'
        elapsed = time.time() - self.rt.started_at(nid)
        if elapsed < STP_LISTEN_SEC:
            return 'listening'
        if elapsed < STP_LISTEN_SEC + STP_LEARN_SEC:
            return 'learning'
        return 'forwarding'

    def port_forwarding(self, nid, ifn):
        """True when the port is past STP listening/learning and can forward."""
        return self._port_stp_state(nid, ifn) == 'forwarding'

    def wifi_ok(self, a, ai, b, bi):
        """Wireless link: client SSID/key must match the access point."""
        for ap, api, cl, cli in ((a, ai, b, bi), (b, bi, a, ai)):
            if self.t(ap) == 'ap' and api.startswith('Wireless'):
                p = self.nodes[ap].get('props', {})
                if self.t(cl) not in HOST:
                    return True
                w = self.st(cl).get('wifi') or {}
                if w.get('ssid') != p.get('ssid'):
                    return False
                if p.get('security', 'WPA2-PSK') != 'Open' and w.get('key') != p.get('key'):
                    return False
        return True

    def svi_up(self, nid, v):
        s = self.st(nid)
        if str(v) not in s['vlans']:
            return False
        for ifn, i in s['ifaces'].items():
            if ifn.startswith(('Vlan', 'Loopback')) or i.get('mode') == 'routed':
                continue
            if not self.link_up(nid, ifn):
                continue
            if i.get('mode', 'access') == 'trunk':
                al = parse_vlan_list(i.get('allowed'))
                if al is None or int(v) in al:
                    return True
            elif int(i.get('vlan', 1)) == int(v):
                return True
        return False

    def l3_up(self, nid, ifn):
        if not self.running(nid):
            return False
        t = self.t(nid)
        if t in HOST:
            return self.link_up(nid, ifn)
        if not self.admin_up(nid, ifn):
            return False
        if ifn.startswith('Loopback'):
            return True
        if ifn.startswith('Vlan'):
            return self.svi_up(nid, ifn[4:])
        return self.link_up(nid, ifn)

    def if_status(self, nid, ifn):
        """(status, protocol) like 'show ip interface brief'."""
        if not self.admin_up(nid, ifn.split('.')[0]) or not self.admin_up(nid, ifn):
            return 'administratively down', 'down'
        if self.l3_up(nid, ifn) or (self.t(nid) in SWITCH and not ifn.startswith(('Vlan', 'Loopback'))
                                    and self.link_up(nid, ifn)):
            if self.t(nid) in SWITCH and not ifn.startswith(('Vlan', 'Loopback')) and '.' not in ifn \
                    and not self.port_forwarding(nid, ifn):
                return 'up', 'down'
            return 'up', 'up'
        if ifn.startswith('Vlan') and str(ifn[4:]) in self.st(nid)['vlans']:
            return 'up', 'down'
        return 'down', 'down'

    # ------------------------------------------------------------ L2
    def channels(self, nid, ifn):
        t = self.t(nid)
        if t in HOST:
            return {'u': L3(nid, ifn)}
        if t in HUB:
            return {'u': f'{nid}|hub'}
        s = self.st(nid)
        i = s['ifaces'].get(ifn, {})
        if t in ROUTER or i.get('mode') == 'routed':
            d = {'u': L3(nid, ifn)}
            for sub, si in s['ifaces'].items():
                if sub.startswith(ifn + '.') and si.get('dot1q') and not si.get('shutdown'):
                    if si.get('native_sub'):
                        d['u'] = L3(nid, sub)
                    else:
                        d[int(si['dot1q'])] = L3(nid, sub)
            return d
        vl = s['vlans']
        if i.get('mode', 'access') == 'trunk':
            d = {}
            nat = int(i.get('native', 1))
            al = parse_vlan_list(i.get('allowed'))
            if str(nat) in vl:
                d['u'] = VP(nid, nat)
            for v in vl:
                v = int(v)
                if v != nat and (al is None or v in al):
                    d[v] = VP(nid, v)
            return d
        v = int(i.get('vlan', 1))
        return {'u': VP(nid, v)} if str(v) in vl else {}

    def _build(self):
        for nid in self.nodes:
            if not self.running(nid) or self.t(nid) not in SWITCH:
                continue
            for ifn in self.st(nid)['ifaces']:
                if ifn.startswith('Vlan') and self.l3_up(nid, ifn):
                    self.uf.union(L3(nid, ifn), VP(nid, ifn[4:]))
        for l in self.links:
            a = (l['a']['node'], l['a']['iface'])
            b = (l['b']['node'], l['b']['iface'])
            if a[0] not in self.nodes or b[0] not in self.nodes:
                continue
            if not self.link_up(*a):
                continue
            if self.t(a[0]) in SWITCH and not self.port_forwarding(a[0], a[1]):
                continue
            ca, cb = self.channels(*a), self.channels(*b)
            for ch, p in ca.items():
                if ch in cb:
                    self.uf.union(p, cb[ch])

    def dom(self, nid, ifn):
        if ifn.startswith('Loopback'):
            return f'lo|{nid}|{ifn}'
        return self.uf.find(L3(nid, ifn))

    # ------------------------------------------------------------ L3 endpoints
    def eps(self):
        if self._eps is None:
            out = []
            for nid, n in self.nodes.items():
                if not self.running(nid):
                    continue
                t = n['type']
                s = self.st(nid)
                if t in HOST:
                    ifn = self.host_if(nid)
                    if s.get('ip') and s.get('mask') and self.l3_up(nid, ifn):
                        out.append(dict(nid=nid, ifn=ifn, ip=s['ip'], ln=mask_len(s['mask']),
                                        dom=self.dom(nid, ifn)))
                elif t in ROUTER or t in SWITCH:
                    for ifn, i in s['ifaces'].items():
                        if not i.get('ip'):
                            continue
                        if t in SWITCH and not (ifn.startswith(('Vlan', 'Loopback')) or i.get('mode') == 'routed'):
                            continue
                        if self.l3_up(nid, ifn):
                            out.append(dict(nid=nid, ifn=ifn, ip=i['ip'], ln=mask_len(i['mask']),
                                            dom=self.dom(nid, ifn)))
            self._eps = out
        return self._eps

    def node_eps(self, nid):
        return [e for e in self.eps() if e['nid'] == nid]

    def owns(self, nid, ip):
        return ip == '127.0.0.1' or any(e['ip'] == ip for e in self.node_eps(nid))

    def owner(self, ip):
        e = next((e for e in self.eps() if e['ip'] == ip), None)
        return e['nid'] if e else None

    def can_route(self, nid):
        t = self.t(nid)
        if t in ROUTER:
            return self.st(nid).get('ip_routing', True)
        if t == 'l3switch':
            return bool(self.st(nid).get('ip_routing'))
        return False

    # ------------------------------------------------------------ routing
    def connected(self, nid):
        r = []
        for e in self.node_eps(nid):
            r.append(dict(code='C', net=i2ip(net_of(e['ip'], e['ln'])), ln=e['ln'], iface=e['ifn'],
                          nh=None, ad=0, metric=0))
            if e['ln'] < 32:
                r.append(dict(code='L', net=e['ip'], ln=32, iface=e['ifn'], nh=None, ad=0, metric=0))
        return r

    def routes(self, nid):
        if nid in self._routes:
            return self._routes[nid]
        t = self.t(nid)
        s = self.st(nid)
        conn = self.connected(nid)
        if t in HOST:
            r = list(conn)
            if s.get('gw') and valid_ip(s['gw']):
                r.append(dict(code='S*', net='0.0.0.0', ln=0, iface=None, nh=s['gw'], ad=1, metric=0))
        elif not self.can_route(nid):
            r = list(conn)
            if s.get('default_gw'):
                r.append(dict(code='S*', net='0.0.0.0', ln=0, iface=None, nh=s['default_gw'], ad=1, metric=0))
        else:
            cand = list(conn)
            for rt in s.get('routes', []):
                ln = mask_len(rt['mask'])
                code = 'S*' if ln == 0 else 'S'
                nh = rt['nh']
                ad = int(rt.get('ad', 1))
                if valid_ip(nh):
                    cand.append(dict(code=code, net=rt['net'], ln=ln, iface=None, nh=nh, ad=ad, metric=0))
                elif self.l3_up(nid, nh):
                    cand.append(dict(code=code, net=rt['net'], ln=ln, iface=nh, nh=None, ad=ad, metric=0))
            cand += self.dynamic().get(nid, [])
            best = {}
            for c in cand:
                k = (c['net'], c['ln'])
                b = best.get(k)
                if b is None or (c['ad'], c['metric']) < (b['ad'], b['metric']):
                    best[k] = c
            r = list(best.values())
        self._routes[nid] = r
        return r

    def lookup(self, nid, dst, depth=0):
        best = None
        for r in self.routes(nid):
            if in_net(dst, r['net'], r['ln']) and (best is None or r['ln'] > best['ln']):
                best = r
        if not best:
            return None
        if best['iface'] is None and best['nh']:
            if depth > 5:
                return None
            sub = self.lookup(nid, best['nh'], depth + 1)
            if not sub or not sub.get('iface'):
                return None
            return dict(best, iface=sub['iface'], nh=sub['nh'] or best['nh'])
        return best

    def proto_match(self, cfg, proto, e):
        if proto == 'ospf':
            for n in cfg.get('networks', []):
                w = ip2i(n['wild'])
                if (ip2i(e['ip']) & ~w & 0xffffffff) == (ip2i(n['net']) & ~w & 0xffffffff):
                    return True
            return False
        for n in cfg.get('networks', []):
            if in_net(e['ip'], n, classful_len(n)):
                return True
        return False

    def dynamic(self):
        if self._dyn is not None:
            return self._dyn
        self._dyn = {}
        for proto, ad in (('ospf', 110), ('rip', 120)):
            parts = {}
            for nid in self.nodes:
                if not self.running(nid) or not self.can_route(nid):
                    continue
                cfg = self.st(nid).get(proto)
                if not cfg:
                    continue
                parts[nid] = (cfg, [e for e in self.node_eps(nid) if self.proto_match(cfg, proto, e)])
            bydom = {}
            for nid, (cfg, eps) in parts.items():
                for e in eps:
                    if e['ifn'].startswith('Loopback') or e['ifn'] in (cfg.get('passive') or []):
                        continue
                    bydom.setdefault(e['dom'], []).append((nid, e))
            adj = {nid: [] for nid in parts}
            for mem in bydom.values():
                for n1, e1 in mem:
                    for n2, e2 in mem:
                        if n1 != n2 and e1['ln'] == e2['ln'] and in_net(e2['ip'], e1['ip'], e1['ln']):
                            adj[n1].append((n2, e1['ifn'], e2['ip'], e2['ifn']))
            self.adj[proto] = adj
            adv = {}
            for nid, (cfg, eps) in parts.items():
                a = [(i2ip(net_of(e['ip'], e['ln'])), e['ln']) for e in eps]
                if cfg.get('default_originate') and any(
                        mask_len(r['mask']) == 0 for r in self.st(nid).get('routes', [])):
                    a.append(('0.0.0.0', 0))
                adv[nid] = a
            for src in parts:
                own = {(c['net'], c['ln']) for c in self.connected(src)}
                dist = {src: 0}
                first = {src: None}
                q = [src]
                while q:
                    nq = []
                    for u in q:
                        for (v, oif, nhip, _) in adj[u]:
                            if v not in dist:
                                dist[v] = dist[u] + 1
                                first[v] = (oif, nhip) if u == src else first[u]
                                nq.append(v)
                    q = nq
                for v, d in dist.items():
                    if v == src:
                        continue
                    for net, ln in adv[v]:
                        if (net, ln) in own:
                            continue
                        metric = d + 1 if proto == 'ospf' else d
                        if proto == 'rip' and metric > 15:
                            continue
                        code = 'O' if proto == 'ospf' else 'R'
                        if ln == 0:
                            code = 'O*E2' if proto == 'ospf' else 'R*'
                        self._dyn.setdefault(src, []).append(dict(
                            code=code, net=net, ln=ln, iface=first[v][0], nh=first[v][1], ad=ad, metric=metric))
        return self._dyn

    # ------------------------------------------------------------ ACL
    def acl_ok(self, nid, ifn, d, pkt):
        if self.t(nid) not in ROUTER | SWITCH:
            return True
        i = self.iface(nid, ifn) or {}
        name = i.get('acl_' + d)
        if not name:
            return True
        acl = self.st(nid).get('acls', {}).get(str(name))
        if not acl:
            return True
        for ent in acl:
            if acl_match(ent, pkt):
                ent['hits'] = ent.get('hits', 0) + 1
                return ent['action'] == 'permit'
        return False

    # ------------------------------------------------------------ forwarding
    def forward(self, src, dst, proto='icmp', dport=None, src_ip=None, acl=True):
        hops, arps = [], []
        pkt = dict(src=src_ip, dst=dst, proto=proto, dport=dport)
        if self.owns(src, dst):
            return dict(ok=True, hops=[], src_ip=dst, dst_node=src, arps=[])
        cur, ttl = src, 30

        def fail(why, at):
            return dict(ok=False, why=why, at=at, hops=hops, src_ip=pkt['src'], arps=arps)

        while ttl > 0:
            r = self.lookup(cur, dst)
            if not r or not r.get('iface'):
                return fail('unreachable', cur)
            out = r['iface']
            if pkt['src'] is None:
                e = next((e for e in self.node_eps(cur) if e['ifn'] == out), None)
                if not e:
                    return fail('unreachable', cur)
                pkt['src'] = e['ip']
            if acl and not self.acl_ok(cur, out, 'out', pkt):
                return fail('filtered', cur)
            target = r['nh'] or dst
            d = self.dom(cur, out)
            nxt = next((e for e in self.eps() if e['dom'] == d and e['ip'] == target and e['nid'] != cur), None)
            if not nxt:
                return fail('noarp', cur)
            arps.append((cur, target))
            if acl and not self.acl_ok(nxt['nid'], nxt['ifn'], 'in', pkt):
                return fail('filtered', nxt['nid'])
            hops.append(dict(nid=nxt['nid'], ip=nxt['ip']))
            if self.owns(nxt['nid'], dst):
                return dict(ok=True, hops=hops, src_ip=pkt['src'], dst_node=nxt['nid'], arps=arps)
            if not self.can_route(nxt['nid']):
                return fail('noroute', nxt['nid'])
            cur = nxt['nid']
            ttl -= 1
        return fail('ttl', cur)

    def ping(self, src, dst, proto='icmp', dport=None, src_ip=None):
        f = self.forward(src, dst, proto, dport, src_ip)
        if not f['ok']:
            return f
        b = self.forward(f['dst_node'], f['src_ip'], proto, None, dst, acl=(proto == 'icmp'))
        f['arps'] = f['arps'] + b['arps']
        if not b['ok'] or b['dst_node'] != src:
            return dict(f, ok=False, why='noreturn', at=b.get('at'))
        return f

    # ------------------------------------------------------------ DHCP / DNS
    def dhcp_offer(self, host):
        ifn = self.host_if(host)
        if not self.link_up(host, ifn):
            return None
        d = self.dom(host, ifn)
        for e in list(self.eps()):
            if e['dom'] != d or e['nid'] == host:
                continue
            res = self._dhcp_serve(e['nid'], e['ip'], e['ln'], host)
            if res:
                return res
            if self.t(e['nid']) in ROUTER | SWITCH:
                h = (self.iface(e['nid'], e['ifn']) or {}).get('helper')
                if h:
                    f = self.forward(e['nid'], h, 'udp', 67)
                    if f['ok']:
                        res = self._dhcp_serve(f['dst_node'], e['ip'], e['ln'], host)
                        if res:
                            return res
        return self._dhcp_fallback(host, d)

    def _dhcp_fallback(self, host, dom):
        """Auto-assign an IP from the directly connected subnet when no DHCP
        server or helper is found."""
        for e in self.eps():
            if e['dom'] != dom or e['nid'] == host:
                continue
            net = net_of(e['ip'], e['ln'])
            bc = bcast_of(e['ip'], e['ln'])
            used = {x['ip'] for x in self.eps()} | {e['ip'], i2ip(net), i2ip(bc)}
            for v in range(net + 1, bc):
                ip = i2ip(v)
                if ip not in used:
                    s = self.st(host)
                    dns = s.get('dns') or e.get('dns') or ''
                    return dict(ip=ip, mask=len_mask(e['ln']), gw=e['ip'], dns=dns, server=e['nid'])
        return None

    def _dhcp_serve(self, srv, giaddr, ln, client):
        t = self.t(srv)
        s = self.st(srv)
        pools = []
        if t in ROUTER | SWITCH:
            for p in s.get('dhcp_pools', {}).values():
                if p.get('network') and p.get('mask') and in_net(giaddr, p['network'], mask_len(p['mask'])):
                    pools.append(p)
        elif t == 'server':
            sv = s.get('services', {}).get('dhcp', {})
            if sv.get('enabled') and valid_ip(sv.get('start', '')) and in_net(giaddr, sv['start'], ln):
                pools.append(dict(network=i2ip(net_of(sv['start'], ln)), mask=len_mask(ln), gw=sv.get('gw', ''),
                                  dns=sv.get('dns', ''), start=sv['start'], max=int(sv.get('max') or 50)))
        for p in pools:
            ip = self._alloc(s, p, client)
            if ip:
                return dict(ip=ip, mask=p['mask'], gw=p.get('gw', ''), dns=p.get('dns', ''), server=srv)
        return None

    def _alloc(self, s, p, client):
        leases = s.setdefault('leases', {})
        key = str(client)
        ln = mask_len(p['mask'])
        if key in leases and in_net(leases[key], p['network'], ln):
            return leases[key]
        net, bc = net_of(p['network'], ln), bcast_of(p['network'], ln)
        used = {e['ip'] for e in self.eps()} | set(leases.values())
        for nid, n in self.nodes.items():
            if n['type'] in HOST:
                hs = self.st(nid)
                if hs.get('ip') and not hs.get('dhcp'):
                    used.add(hs['ip'])
        excl = s.get('dhcp_excluded', [])
        start = ip2i(p['start']) if p.get('start') else net + 1
        end = min(bc - 1, start + int(p['max']) - 1) if p.get('max') else bc - 1
        for v in range(start, end + 1):
            ip = i2ip(v)
            if ip in used or any(ip2i(a) <= v <= ip2i(b) for a, b in excl):
                continue
            leases[key] = ip
            self.rt.mark_dirty()
            return ip
        return None

    def dns_resolve(self, nid, name):
        name = name.lower().rstrip('.')
        s = self.st(nid)
        dns = s.get('dns')
        if not dns or not valid_ip(dns):
            return None, 'nodns'
        f = self.ping(nid, dns, 'udp', 53)
        if not f['ok']:
            return None, 'timeout'
        srv = f['dst_node']
        if self.t(srv) == 'server':
            d = self.st(srv).get('services', {}).get('dns', {})
            if d.get('enabled'):
                rec = {k.lower(): v for k, v in d.get('records', {}).items()}
                if name in rec:
                    return rec[name], 'ok'
        return None, 'nx'

    # ------------------------------------------------------------ L2 tables
    def mac_table(self, sw):
        s = self.st(sw)
        adj = {}
        for l in self.links:
            a, b = (l['a']['node'], l['a']['iface']), (l['b']['node'], l['b']['iface'])
            if a[0] in self.nodes and b[0] in self.nodes and self.link_up(*a):
                adj.setdefault(a[0], []).append(b[0])
                adj.setdefault(b[0], []).append(a[0])
        out = []
        for ifn, i in sorted(s['ifaces'].items()):
            if ifn.startswith(('Vlan', 'Loopback')) or i.get('mode') == 'routed' or not self.link_up(sw, ifn):
                continue
            pn, _ = self.peer(self.port_link[(sw, ifn)], sw, ifn)
            seen, q = {sw}, [pn]
            reach = []
            while q:
                u = q.pop()
                if u in seen:
                    continue
                seen.add(u)
                reach.append(u)
                if self.t(u) in SWITCH | HUB:
                    q += adj.get(u, [])
            for u in reach:
                t = self.t(u)
                if t in HOST:
                    cands = [self.host_if(u)]
                elif t in ROUTER:
                    cands = list(self.st(u)['ifaces'])
                elif t in SWITCH:
                    cands = [x for x, xi in self.st(u)['ifaces'].items()
                             if x.startswith('Vlan') or xi.get('mode') == 'routed']
                else:
                    cands = []
                for c in cands:
                    root = self.uf.find(L3(u, c))
                    for v in s['vlans']:
                        if root == self.uf.find(VP(sw, v)):
                            out.append((int(v), mac_for(u, c), ifn))
        return sorted(set(out))

    def cdp(self, nid):
        out = []
        if not self.st(nid).get('cdp', True):
            return out
        for (n, ifn), l in self.port_link.items():
            if n != nid or not self.link_up(nid, ifn):
                continue
            pn, pi = self.peer(l, nid, ifn)
            if self.t(pn) in ROUTER | SWITCH and self.st(pn).get('cdp', True):
                out.append(dict(dev=self.name(pn), local=ifn, remote=pi, nid=pn, type=self.t(pn),
                                model=self.rt.model(pn)))
        return sorted(out, key=lambda x: x['local'])
