"""Lab runtime: node power, state persistence, console sessions."""
import asyncio
import copy
import json
import re
import time

from .templates import TEMPLATES, PROP_DEFAULTS, node_ifaces
from .state import new_state, hash_secret
from .net import Net, SIM, ROUTER, SWITCH, HOST
from .cli import IOSCli, PCCli, help_text, complete

BOOT = """System Bootstrap, Version 15.4(1r)M, RELEASE SOFTWARE (fc1)
Copyright (c) 1986-2026 by cisco Systems, Inc.  [NexLab simulated platform]

Initializing memory for ECC
{model} platform with 524288 Kbytes of main memory

Readonly ROMMON initialized
Self decompressing the image : ######################################## [OK]

              Restricted Rights Legend
Cisco IOS Software, {model} Software, Version 15.4(3)M2, RELEASE SOFTWARE (fc2)
Compiled by NexLab simulation engine

{n} Ethernet interfaces
255K bytes of non-volatile configuration memory.

"""


def kind_of(t):
    return TEMPLATES[t]['kind']


class ConsoleSession:
    """One browser terminal attached to a simulated device (sim-mode console)."""

    def __init__(self, rt, nid, send):
        self.rt = rt
        self.nid = nid
        self.send = send
        self.stack = []
        self.awaiting = None
        self.closed = False
        rt.sessions.add(self)

    def close(self):
        self.closed = True
        self.rt.sessions.discard(self)

    @property
    def top(self):
        return self.stack[-1]

    async def out(self, text):
        if self.closed:
            return
        try:
            await self.send({'t': 'out', 'd': text.replace('\r\n', '\n').replace('\n', '\r\n')})
        except Exception:
            self.close()

    async def clear(self):
        await self.send({'t': 'clear'})

    def ask(self, prompt, cb, echo=False):
        self.awaiting = (prompt, cb, echo)

    def make_cli(self, nid, vty=False):
        t = self.rt.node(nid)['type']
        return PCCli(self, nid) if t in HOST else IOSCli(self, nid, vty)

    async def start(self):
        node = self.rt.node(self.nid)
        if not self.rt.is_running(self.nid):
            await self.out('\r\n%% Device is powered off. Start the node first.\r\n')
            return False
        cli = self.make_cli(self.nid)
        self.stack = [cli]
        if cli.kind == 'ios':
            if self.rt.take_boot_banner(self.nid):
                n = len([i for i in self.rt.state(self.nid)['ifaces'] if not i.startswith(('Vlan', 'Loopback')) and '.' not in i])
                for chunk in BOOT.format(model=self.rt.model(self.nid), n=n).split('\n'):
                    await self.out(chunk + '\n')
                    await asyncio.sleep(0.02)
                await self.out('\n\nPress RETURN to get started!\n\n')
                self.ask('', self.after_return, echo=True)
            else:
                await self.after_return('')
        else:
            await self.out('\nPacket Tracer PC Command Line 1.0  [NexLab]\nType "help" for a list of commands.\n')
        await self.send_prompt()
        return True

    async def after_return(self, _):
        s = self.rt.state(self.nid)
        cli = self.stack[0]
        cli.mode = 'user'
        if s.get('banner'):
            await self.out('\n' + s['banner'] + '\n\n')
        con = s['lines']['con']
        if con.get('login') == 'local':
            await self.out('\nUser Access Verification\n\n')
            await self.login_local(s, lambda priv: self._con_ok(priv))
        elif con.get('login') and con.get('password'):
            await self.out('\nUser Access Verification\n\n')
            tries = [0]

            async def chk(pw):
                if pw == con['password']:
                    return
                tries[0] += 1
                if tries[0] >= 3:
                    await self.out('% Bad passwords\n')
                    self.ask('', self.after_return, echo=True)
                    return
                self.ask('Password: ', chk)
            self.ask('Password: ', chk)

    async def _con_ok(self, priv):
        if priv >= 15:
            self.stack[0].mode = 'priv'

    async def login_local(self, s, on_ok, fixed_user=None, on_fail=None):
        tries = [0]
        cur = {'u': fixed_user}

        async def ask_user(u):
            cur['u'] = u.strip()
            self.ask('Password: ', ask_pw)

        async def ask_pw(pw):
            u = s.get('users', {}).get(cur['u'])
            ok = u and ((u.get('secret') and u['secret'] == hash_secret(pw)) or
                        (not u.get('secret') and u.get('password') == pw))
            if ok:
                return await on_ok(int(u.get('priv', 1)))
            tries[0] += 1
            if tries[0] >= 3:
                await self.out('% Authentication failed\n')
                if on_fail:
                    return await on_fail()
                self.ask('', self.after_return, echo=True)
                return
            await self.out('% Login invalid\n\n')
            if fixed_user:
                self.ask('Password: ', ask_pw)
            else:
                self.ask('Username: ', ask_user, echo=True)
        if fixed_user:
            self.ask('Password: ', ask_pw)
        else:
            self.ask('Username: ', ask_user, echo=True)

    async def handle(self, msg):
        t = msg.get('t')
        d = msg.get('d', '')
        if not self.stack:
            return
        if t == 'line':
            if self.awaiting:
                p, cb, e = self.awaiting
                self.awaiting = None
                await cb(d)
            else:
                await self.top.run(d)
            await self.send_prompt()
        elif t == 'help':
            if self.awaiting:
                return await self.send({'t': 'help', 'd': ''})
            txt = help_text(self.top.tree(), d)
            await self.send({'t': 'help', 'd': txt.replace('\n', '\r\n')})
        elif t == 'tab':
            nl = None if self.awaiting else complete(self.top.tree(), d)
            await self.send({'t': 'tab', 'd': nl})
        elif t == 'ctrl':
            if d == 'z' and self.top.kind == 'ios' and self.top.mode not in ('user', 'priv'):
                self.top.mode, self.top.ctx = 'priv', None
                await self.out('\n%SYS-5-CONFIG_I: Configured from console by console\n')
            elif d == 'c':
                self.awaiting = None
            await self.send_prompt()

    async def send_prompt(self):
        if self.closed or not self.stack:
            return
        if self.awaiting:
            p, cb, e = self.awaiting
            await self.send({'t': 'prompt', 'd': p, 'echo': e})
        else:
            await self.send({'t': 'prompt', 'd': self.top.prompt(), 'echo': True})

    async def exit_cli(self, cli):
        if len(self.stack) > 1:
            gone = self.stack.pop()
            host = self.rt.net().name(gone.nid)
            await self.out(f'\n[Connection to {host} closed by foreign host]\n')
            return
        s = self.rt.state(self.nid)
        await self.out(f"\n\n\n\n{s['hostname']} con0 is now available\n\n\n\n\n\nPress RETURN to get started.\n")
        cli.mode, cli.ctx = 'user', None
        self.ask('', self.after_return, echo=True)

    async def connect(self, cli, dst, proto, user):
        net = self.rt.net()
        port = 22 if proto == 'ssh' else 23
        if cli.kind == 'ios':
            await self.out(f'Trying {dst} ...')
        res = net.ping(cli.nid, dst, 'tcp', port)
        await asyncio.sleep(0.4)
        if not res['ok']:
            await asyncio.sleep(1.2)
            return await self.out('\n% Connection timed out; remote host not responding\n')
        target = res['dst_node']
        tt = self.rt.node(target)['type']
        if tt not in ROUTER | SWITCH:
            return await self.out('\n% Connection refused by remote host\n')
        s = self.rt.state(target)
        vty = s['lines']['vty']
        tr = vty.get('transport', 'all')
        if tr == 'none' or (tr != 'all' and tr != proto):
            return await self.out('\n% Connection refused by remote host\n')
        host = s['hostname']

        async def opened(priv=1):
            new = IOSCli(self, target, vty=True)
            new.mode = 'priv' if priv >= 15 else 'user'
            self.stack.append(new)
            if s.get('banner'):
                await self.out('\n' + s['banner'] + '\n')

        async def failed():
            await self.out(f'\n[Connection to {dst} closed by foreign host]\n')

        if proto == 'ssh':
            if not s.get('rsa'):
                return await self.out('\n% Connection refused by remote host\n')
            if vty.get('login') != 'local' or user not in s.get('users', {}):
                if vty.get('login') != 'local':
                    return await self.out('\n% Connection refused by remote host\n')
            await self.out('Open\n')
            return await self.login_local(s, opened, fixed_user=user, on_fail=failed)
        await self.out('Open\n')
        if vty.get('login') == 'local':
            await self.out('\nUser Access Verification\n\n')
            return await self.login_local(s, opened, on_fail=failed)
        if not vty.get('password') or not vty.get('login'):
            if not vty.get('login') and vty.get('password') is None:
                return await self.out(f'\n\nPassword required, but none set\n\n[Connection to {dst} closed by foreign host]\n')
            if not vty.get('login'):
                return await opened()
        await self.out('\nUser Access Verification\n\n')
        tries = [0]

        async def chk(pw):
            if pw == vty['password']:
                return await opened()
            tries[0] += 1
            if tries[0] >= 3:
                await self.out('% Bad passwords\n')
                return await failed()
            self.ask('Password: ', chk)
        self.ask('Password: ', chk)

    async def reload_device(self, nid):
        self.rt.reload_node(nid)
        for sess in list(self.rt.sessions):
            if sess.stack and sess.stack[0].nid == nid:
                await sess.out('\n%SYS-5-RELOAD: Reload requested by console. Reload Reason: Reload Command.\n\n')
                await sess.start()

    async def notify(self, nid, msg):
        for sess in list(self.rt.sessions):
            if sess is self or not sess.stack:
                continue
            if sess.top.nid == nid and sess.top.kind == 'ios':
                await sess.send({'t': 'log', 'd': msg.replace('\n', '\r\n')})


class LabRuntime:
    def __init__(self, mgr, row):
        self.mgr = mgr
        self.id = row['id']
        self.owner = row['owner']
        self.lab = json.loads(row['data'] or '{}')
        self.lab.setdefault('nodes', [])
        self.lab.setdefault('links', [])
        self.lab.setdefault('notes', [])
        self.lab.setdefault('map3d', {'buildings': [], 'objects': [], 'cables': [], 'settings': {}})
        self.arp = {}
        self.dirty = False
        self.sessions = set()
        self.boot = {}
        self.banner_pending = set()
        self._reindex()
        for n in self.lab['nodes']:
            self.ensure(n)
            if kind_of(n['type']) == 'sim' and n.get('power') == 'on':
                self.boot[n['id']] = time.time()

    def _reindex(self):
        self.by_id = {n['id']: n for n in self.lab['nodes']}

    def ensure(self, n):
        t = n['type']
        n.setdefault('props', {})
        for k, v in PROP_DEFAULTS.get(t, {}).items():
            n['props'].setdefault(k, v)
        n['ifaces'] = node_ifaces(t, n['props'])
        n.setdefault('name', f"{TEMPLATES[t]['prefix']}{n['id']}")
        if kind_of(t) in ('sim', 'cloud') and not n.get('state'):
            n['state'] = new_state(t, n['name'], n['ifaces'])
        n.setdefault('startup', None)
        n.setdefault('power', 'off')

    # ------------------------------------------------------------ accessors
    def node(self, nid):
        return self.by_id[nid]

    def state(self, nid):
        n = self.by_id[nid]
        if not n.get('state'):
            n['state'] = new_state(n['type'], n['name'], n['ifaces'])
        return n['state']

    def set_state(self, nid, st):
        self.by_id[nid]['state'] = st
        self.mark_dirty()

    def model(self, nid):
        return TEMPLATES[self.by_id[nid]['type']]['model']

    def is_running(self, nid):
        n = self.by_id.get(nid)
        if not n:
            return False
        k = kind_of(n['type'])
        if k == 'cloud':
            return True
        if k == 'sim':
            return n.get('power') == 'on'
        if k == 'remote':
            return True
        return self.mgr.real.is_running(self.id, nid)

    def started_at(self, nid):
        return self.boot.get(nid, time.time())

    def take_boot_banner(self, nid):
        if nid in self.banner_pending:
            self.banner_pending.discard(nid)
            return True
        return False

    def net(self):
        return Net(self)

    def mark_dirty(self):
        self.dirty = True

    def save_startup(self, nid):
        self.by_id[nid]['startup'] = copy.deepcopy(self.state(nid))
        self.mark_dirty()

    def reload_node(self, nid):
        n = self.by_id[nid]
        n['state'] = copy.deepcopy(n['startup']) if n.get('startup') else new_state(n['type'], n['name'], n['ifaces'])
        self.boot[nid] = time.time()
        self.banner_pending.add(nid)
        self.arp.pop(nid, None)
        self.mark_dirty()

    # ------------------------------------------------------------ power
    async def start_node(self, nid, user):
        n = self.by_id[nid]
        k = kind_of(n['type'])
        if k == 'sim':
            if n.get('power') != 'on':
                n['power'] = 'on'
                self.boot[nid] = time.time()
                self.banner_pending.add(nid)
                if n['type'] in HOST and self.state(nid).get('dhcp'):
                    self.state(nid)['ip'] = ''
                self.mark_dirty()
            return True, ''
        if k == 'real':
            if user.get('role') != 'admin':
                return False, 'Hanya admin yang boleh menjalankan node real (butuh root).'
            ok, msg = await self.mgr.real.start(self, n)
            if ok:
                await self.mgr.real.sync_links(self)
            return ok, msg
        return True, ''

    async def stop_node(self, nid):
        n = self.by_id[nid]
        k = kind_of(n['type'])
        if k == 'sim':
            n['power'] = 'off'
            self.arp.pop(nid, None)
            self.mark_dirty()
            for sess in list(self.sessions):
                if sess.stack and any(c.nid == nid for c in sess.stack):
                    await sess.out('\n\n%% Device powered off\n')
                    sess.stack = []
        elif k == 'real':
            await self.mgr.real.stop(self, n)
            await self.mgr.real.sync_links(self)

    async def wipe_node(self, nid):
        n = self.by_id[nid]
        await self.stop_node(nid)
        if kind_of(n['type']) in ('sim', 'cloud'):
            n['state'] = new_state(n['type'], n['name'], n['ifaces'])
            n['startup'] = None
        elif n['type'] == 'qemu':
            self.mgr.real.wipe(self, n)
        self.mark_dirty()

    # ------------------------------------------------------------ topology
    def update_topology(self, nodes, links, notes=None):
        old = dict(self.by_id)
        new_nodes = []
        for raw in nodes:
            nid = int(raw['id'])
            t = raw.get('type')
            if t not in TEMPLATES:
                continue
            o = old.get(nid)
            if o is None or o['type'] != t:
                o = {'id': nid, 'type': t, 'name': str(raw.get('name') or f"{TEMPLATES[t]['prefix']}{nid}")[:40],
                     'props': {}}
                if raw.get('state'):
                    o['state'] = raw['state']
                if raw.get('startup'):
                    o['startup'] = raw['startup']
            o['name'] = str(raw.get('name') or o['name'])[:40]
            o['x'] = float(raw.get('x', 0))
            o['y'] = float(raw.get('y', 0))
            try:
                o['size'] = max(0.5, min(2.5, float(raw['size']))) if raw.get('size') else 1
            except (TypeError, ValueError):
                o['size'] = 1
            o['lpos'] = raw.get('lpos') if raw.get('lpos') in ('top', 'left', 'right') else 'bottom'
            if isinstance(raw.get('props'), dict):
                for k, v in raw['props'].items():
                    if k in PROP_DEFAULTS.get(t, {}):
                        o['props'][k] = v
            self.ensure(o)
            new_nodes.append(o)
        removed = [nid for nid in old if nid not in {n['id'] for n in new_nodes}]
        self.lab['nodes'] = new_nodes
        self._reindex()
        used = set()
        new_links = []
        for l in links:
            try:
                a = {'node': int(l['a']['node']), 'iface': str(l['a']['iface'])}
                b = {'node': int(l['b']['node']), 'iface': str(l['b']['iface'])}
            except Exception:
                continue
            if a['node'] not in self.by_id or b['node'] not in self.by_id or a == b:
                continue
            if a['iface'] not in self.by_id[a['node']]['ifaces'] or b['iface'] not in self.by_id[b['node']]['ifaces']:
                continue
            ka, kb = (a['node'], a['iface']), (b['node'], b['iface'])
            if ka in used or kb in used:
                continue
            used.update([ka, kb])
            nl = {'id': str(l.get('id') or f"{ka}-{kb}"), 'a': a, 'b': b, 'style': l.get('style', 'copper')}
            # PNETLab link design: colour, line style, width
            if re.match(r'^#[0-9a-fA-F]{6}$', str(l.get('color') or '')):
                nl['color'] = l['color']
            if l.get('dash') in ('dashed', 'dotted'):
                nl['dash'] = l['dash']
            if str(l.get('width') or '').isdigit() and 1 <= int(l['width']) <= 6:
                nl['width'] = int(l['width'])
            new_links.append(nl)
        self.lab['links'] = new_links
        if notes is not None:
            self.lab['notes'] = notes[:100]
        self.mark_dirty()
        return removed

    def status(self):
        net = self.net()
        nodes = {}
        for n in self.lab['nodes']:
            st = n.get('state') or {}
            nodes[n['id']] = {'running': self.is_running(n['id']), 'kind': kind_of(n['type']),
                              'hostname': st.get('hostname')}
            if n['type'] in HOST:
                nodes[n['id']]['ip'] = st.get('ip') or ('DHCP' if st.get('dhcp') else '')
            elif n['type'] == 'netns':
                nodes[n['id']]['ip'] = n['props'].get('ip') or ''
            elif n['type'] == 'remote':
                nodes[n['id']]['ip'] = n['props'].get('host') or ''
        links = {}
        for l in self.lab['links']:
            sides = []
            for side in ('a', 'b'):
                nid, ifn = l[side]['node'], l[side]['iface']
                k = kind_of(self.by_id[nid]['type'])
                if k == 'sim':
                    if not self.is_running(nid):
                        sides.append('off')
                    elif not net.admin_up(nid, ifn):
                        sides.append('down')
                    elif net.link_up(nid, ifn):
                        sides.append('up')
                    else:
                        sides.append('wait')
                elif k == 'cloud':
                    sides.append('up')
                else:
                    sides.append('up' if self.is_running(nid) else 'off')
            ka = kind_of(self.by_id[l['a']['node']]['type'])
            kb = kind_of(self.by_id[l['b']['node']]['type'])
            real_a, real_b = ka in ('real', 'remote'), kb in ('real', 'remote')
            mixed = (ka == 'sim' and real_b) or (kb == 'sim' and real_a)
            links[l['id']] = {'a': sides[0], 'b': sides[1], 'mixed': mixed}
        return {'nodes': nodes, 'links': links, 'restart': self.mgr.real.stale_links(self)}

    def dhcp_tick(self):
        net = None
        for n in self.lab['nodes']:
            if n['type'] in HOST and n.get('power') == 'on':
                s = self.state(n['id'])
                if s.get('dhcp') and not s.get('ip'):
                    net = net or self.net()
                    res = net.dhcp_offer(n['id'])
                    if res:
                        s.update(ip=res['ip'], mask=res['mask'], gw=res['gw'], dns=res['dns'])
                        self.mark_dirty()
                        net = None

    def export(self):
        return copy.deepcopy(self.lab)


class RuntimeManager:
    def __init__(self, db, real):
        self.db = db
        self.real = real
        self.labs = {}

    def get(self, lab_id):
        if lab_id in self.labs:
            return self.labs[lab_id]
        row = self.db.q('SELECT * FROM labs WHERE id=?', (lab_id,), one=True)
        if not row:
            return None
        rt = LabRuntime(self, row)
        self.labs[lab_id] = rt
        return rt

    def drop(self, lab_id):
        self.labs.pop(lab_id, None)

    def flush(self):
        for rt in list(self.labs.values()):
            if rt.dirty:
                rt.dirty = False
                self.db.x('UPDATE labs SET data=?, updated=? WHERE id=?',
                          (json.dumps(rt.lab), time.time(), rt.id))

    async def loop(self):
        while True:
            await asyncio.sleep(2)
            try:
                for rt in list(self.labs.values()):
                    rt.dhcp_tick()
                self.flush()
            except Exception as e:  # keep the loop alive
                print('[runtime] error', e)
