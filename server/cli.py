"""Cisco IOS-like CLI and Packet-Tracer-like PC command prompt."""
import asyncio
import copy
import random
import re
import time

from .state import (ip2i, i2ip, valid_ip, valid_mask, mask_len, len_mask, net_of, bcast_of, in_net,
                    wild_to_mask, mac_for, mac_dash, short_if, if_sort_key, hash_secret, running_config,
                    classful_len)
from .net import ROUTER, SWITCH, HOST, parse_vlan_list


class Invalid(Exception):
    def __init__(self, pos):
        self.pos = pos


class Incomplete(Exception):
    pass


class Ambiguous(Exception):
    def __init__(self, word):
        self.word = word


def T(desc, sub=None):
    return (desc, sub if sub is not None else {})


def is_ph(k):
    return k[:1].isupper() or k.startswith('<') or k[:1].isdigit()


def pick(tok, keys):
    t = tok.lower()
    keys = [k for k in keys if not is_ph(k)]
    if t in keys:
        return t, None
    c = [k for k in keys if k.startswith(t)]
    if len(c) == 1:
        return c[0], None
    if not c:
        return None, 'invalid'
    return None, 'ambiguous'


# --------------------------------------------------------------------------- help trees
IFNAME = {'WORD': ('Interface name (e.g. GigabitEthernet0/0, Fa0/1, Vlan10, Loopback0)', {})}
SHOW = {
    'access-lists': T('List access lists'),
    'arp': T('ARP table'),
    'cdp': T('CDP information', {'neighbors': T('CDP neighbor entries', {'detail': T('Show detailed information')})}),
    'clock': T('Display the system clock'),
    'flash:': T('display information about flash: file system'),
    'history': T('Display the session command history'),
    'interfaces': T('Interface status and configuration', {'status': T('Show interface line status'),
                                                          'trunk': T('Show interface trunk information'),
                                                          'WORD': T('Interface name')}),
    'ip': T('IP information', {
        'access-lists': T('List IP access lists'),
        'dhcp': T('Show items in the DHCP database', {'binding': T('DHCP address bindings'),
                                                     'pool': T('DHCP pools information')}),
        'interface': T('IP interface status and configuration', {'brief': T('Brief summary of IP status')}),
        'ospf': T('OSPF information', {'neighbor': T('Neighbor list')}),
        'protocols': T('IP routing protocol process parameters and statistics'),
        'rip': T('IP RIP show commands', {'database': T('IP RIP database')}),
        'route': T('IP routing table', {'connected': T('Connected'), 'static': T('Static routes'),
                                        'ospf': T('Open Shortest Path First (OSPF)'), 'rip': T('Routing Information Protocol (RIP)')}),
    }),
    'mac': T('MAC configuration', {'address-table': T('MAC forwarding table')}),
    'running-config': T('Current operating configuration'),
    'startup-config': T('Contents of startup configuration'),
    'users': T('Display information about terminal lines'),
    'version': T('System hardware and software status'),
    'vlan': T('VTP VLAN status', {'brief': T('VTP all VLAN status in brief')}),
}
SHOW_USER = {k: v for k, v in SHOW.items() if k not in ('running-config', 'startup-config', 'access-lists')}
ADDR = {'WORD': T('Ping destination address or hostname')}
USER = {
    'enable': T('Turn on privileged commands'),
    'exit': T('Exit from the EXEC'),
    'logout': T('Exit from the EXEC'),
    'ping': T('Send echo messages', ADDR),
    'show': T('Show running system information', SHOW_USER),
    'ssh': T('Open a secure shell client connection', {'-l': T('Log in using this user name')}),
    'telnet': T('Open a telnet connection', ADDR),
    'terminal': T('Set terminal line parameters'),
    'traceroute': T('Trace route to destination', ADDR),
}
PRIV = dict(USER)
PRIV.update({
    'clear': T('Reset functions', {'arp-cache': T('Clear the entire ARP cache'),
                                   'mac': T('MAC forwarding table', {'address-table': T('MAC forwarding table')}),
                                   'ip': T('IP', {'ospf': T('OSPF', {'process': T('Reset OSPF process')})}),
                                   'access-list': T('Clear access list statistical information',
                                                    {'counters': T('Clear access list counters')})}),
    'clock': T('Manage the system clock', {'set': T('Set the time and date')}),
    'configure': T('Enter configuration mode', {'terminal': T('Configure from the terminal')}),
    'copy': T('Copy from one file to another', {
        'running-config': T('Copy from current system configuration', {'startup-config': T('Copy to startup configuration')}),
        'startup-config': T('Copy from startup configuration', {'running-config': T('Update (merge with) current system configuration')})}),
    'debug': T('Debugging functions (see also \'undebug\')'),
    'disable': T('Turn off privileged commands'),
    'erase': T('Erase a filesystem', {'startup-config': T('Erase contents of configuration memory')}),
    'reload': T('Halt and perform a cold restart'),
    'show': T('Show running system information', SHOW),
    'undebug': T('Disable debugging functions (see also \'debug\')', {'all': T('Disable all debugging')}),
    'write': T('Write running configuration to memory, network, or terminal',
               {'erase': T('Erase NV memory'), 'memory': T('Write to NV memory'), 'terminal': T('Write to terminal')}),
})
CONFIG = {
    'access-list': T('Add an access list entry', {'<1-99>': T('IP standard access list'), '<100-199>': T('IP extended access list')}),
    'banner': T('Define a login banner', {'motd': T('Set Message of the Day banner')}),
    'cdp': T('Global CDP configuration subcommands', {'run': T('Enable CDP')}),
    'clock': T('Configure time-of-day clock'),
    'crypto': T('Encryption module', {'key': T('Long term key operations', {'generate': T('Generate new keys', {'rsa': T('Generate RSA keys')})})}),
    'do': T('To run exec commands in config mode'),
    'enable': T('Modify enable password parameters', {'password': T('Assign the privileged level password'),
                                                      'secret': T('Assign the privileged level secret')}),
    'end': T('Exit from configure mode'),
    'exit': T('Exit from configure mode'),
    'hostname': T('Set system\'s network name', {'WORD': T('This system\'s network name')}),
    'interface': T('Select an interface to configure', dict(IFNAME, range=T('interface range command'))),
    'ip': T('Global IP configuration subcommands', {
        'access-list': T('Named access-list', {'extended': T('Extended Access List'), 'standard': T('Standard Access List')}),
        'default-gateway': T('Specify default gateway (if not routing IP)'),
        'dhcp': T('Configure DHCP server and relay parameters', {'excluded-address': T('Prevent DHCP from assigning certain addresses'),
                                                                 'pool': T('Configure DHCP address pools')}),
        'domain-lookup': T('Enable IP Domain Name System hostname translation'),
        'domain-name': T('Define the default domain name'),
        'nat': T('NAT configuration commands'),
        'route': T('Establish static routes', {'A.B.C.D': T('Destination prefix')}),
        'routing': T('Enable IP routing'),
        'ssh': T('Configure ssh options'),
    }),
    'line': T('Configure a terminal line', {'console': T('Primary terminal line'), 'vty': T('Virtual terminal')}),
    'logging': T('Modify message logging facilities'),
    'no': T('Negate a command or set its defaults'),
    'router': T('Enable a routing process', {'ospf': T('Open Shortest Path First (OSPF)'), 'rip': T('Routing Information Protocol (RIP)')}),
    'service': T('Modify use of network based services', {'password-encryption': T('Encrypt system passwords')}),
    'spanning-tree': T('Spanning Tree Subsystem'),
    'username': T('Establish User Name Authentication'),
    'vlan': T('Vlan commands', {'<1-4094>': T('ISL VLAN IDs 1-1005')}),
}
CONFIG['no'] = T('Negate a command or set its defaults', CONFIG)
IF = {
    'cdp': T('CDP interface subcommands'),
    'channel-group': T('Etherchannel/port bundling configuration'),
    'description': T('Interface specific description'),
    'do': T('To run exec commands in config mode'),
    'duplex': T('Configure duplex operation.'),
    'encapsulation': T('Set encapsulation type for an interface', {'dot1q': T('IEEE 802.1Q Virtual LAN')}),
    'end': T('Exit from configure mode'),
    'exit': T('Exit from interface configuration mode'),
    'interface': T('Select an interface to configure', IFNAME),
    'ip': T('Interface Internet Protocol config commands', {
        'access-group': T('Specify access control for packets'),
        'address': T('Set the IP address of an interface', {'A.B.C.D': T('IP address'), 'dhcp': T('IP Address negotiated via DHCP')}),
        'helper-address': T('Specify a destination address for UDP broadcasts'),
        'nat': T('NAT interface commands'), 'ospf': T('OSPF interface commands')}),
    'no': T('Negate a command or set its defaults'),
    'shutdown': T('Shutdown the selected interface'),
    'spanning-tree': T('Spanning Tree Subsystem', {'portfast': T('Spanning tree portfast options'),
                                                   'bpduguard': T('Don\'t accept BPDUs on this interface')}),
    'speed': T('Configure speed operation.'),
    'switchport': T('Set switching mode characteristics', {
        'access': T('Set access mode characteristics of the interface', {'vlan': T('Set VLAN when interface is in access mode')}),
        'mode': T('Set trunking mode of the interface', {'access': T('Set trunking mode to ACCESS unconditionally'),
                                                       'trunk': T('Set trunking mode to TRUNK unconditionally'),
                                                       'dynamic': T('Set trunking mode to dynamically negotiate')}),
        'nonegotiate': T('Device will not engage in negotiation protocol on this interface'),
        'port-security': T('Security related command'),
        'trunk': T('Set trunking characteristics of the interface', {'allowed': T('Set allowed VLAN characteristics'),
                                                                    'encapsulation': T('Set trunking encapsulation'),
                                                                    'native': T('Set trunking native characteristics')}),
        'voice': T('Voice appliance attributes')}),
}
IF['no'] = T('Negate a command or set its defaults', IF)
VLAN = {'exit': T('Apply changes, bump revision number, and exit mode'), 'end': T('Exit from configure mode'),
        'name': T('Ascii name of the VLAN'), 'no': T('Negate a command or set its defaults'), 'do': T('Run exec command')}
ROUTER_T = {'auto-summary': T('Enable automatic network number summarization'),
            'default-information': T('Control distribution of default information', {'originate': T('Distribute a default route')}),
            'do': T('Run exec command'), 'end': T('Exit from configure mode'), 'exit': T('Exit from routing protocol configuration mode'),
            'network': T('Enable routing on an IP network'), 'no': T('Negate a command or set its defaults'),
            'passive-interface': T('Suppress routing updates on an interface'), 'router-id': T('router-id for this OSPF process'),
            'version': T('Set routing protocol version'), 'log-adjacency-changes': T('Log changes in adjacency state')}
ROUTER_T['no'] = T('Negate a command or set its defaults', ROUTER_T)
DHCP_T = {'default-router': T('Default routers'), 'dns-server': T('DNS servers'), 'do': T('Run exec command'),
          'domain-name': T('Domain name'), 'end': T('Exit from configure mode'), 'exit': T('Exit from DHCP pool configuration mode'),
          'lease': T('Address lease time'), 'network': T('Network number and mask'), 'no': T('Negate a command')}
LINE_T = {'do': T('Run exec command'), 'end': T('Exit from configure mode'), 'exec-timeout': T('Set the EXEC timeout'),
          'exit': T('Exit from line configuration mode'), 'logging': T('Modify message logging facilities', {'synchronous': T('Synchronized message output')}),
          'login': T('Enable password checking', {'local': T('Local password checking')}), 'no': T('Negate a command'),
          'password': T('Set a password'), 'transport': T('Define transport protocols for line', {'input': T('Define which protocols to use when connecting to the terminal server')})}
ACL_T = {'deny': T('Specify packets to reject'), 'permit': T('Specify packets to forward'), 'remark': T('Access list entry comment'),
         'do': T('Run exec command'), 'end': T('Exit from configure mode'), 'exit': T('Exit from access-list configuration mode'),
         'no': T('Negate a command')}
TREES = {'user': USER, 'priv': PRIV, 'config': CONFIG, 'if': IF, 'subif': IF, 'ifr': IF, 'vlan': VLAN,
         'router': ROUTER_T, 'dhcp': DHCP_T, 'line': LINE_T, 'acl': ACL_T}
PROMPTS = {'user': '>', 'priv': '#', 'config': '(config)#', 'if': '(config-if)#', 'ifr': '(config-if-range)#',
           'subif': '(config-subif)#', 'vlan': '(config-vlan)#', 'line': '(config-line)#', 'router': '(config-router)#',
           'dhcp': '(dhcp-config)#', 'acl': '(config-ext-nacl)#'}

IFACE_PREFIX = [('gigabitethernet', 'GigabitEthernet'), ('fastethernet', 'FastEthernet'), ('ethernet', 'Ethernet'),
                ('loopback', 'Loopback'), ('vlan', 'Vlan'), ('serial', 'Serial'),
                ('tengigabitethernet', 'TenGigabitEthernet'), ('port-channel', 'Port-channel'), ('gpon', 'GPON'), ('wireless', 'Wireless')]

# config-mode commands that are accepted and kept verbatim (no simulation effect)
PASSTHRU = ('ip ssh', 'logging', 'spanning-tree', 'clock', 'ntp', 'snmp-server', 'ip http', 'vtp',
            'license', 'archive', 'errdisable', 'mac', 'lldp', 'aaa', 'ipv6')


def parse_ifname(s):
    m = re.match(r'^([a-zA-Z\-]+)\s*(\d[\d/\.:]*)$', s.strip())
    if not m:
        return None
    p = m.group(1).lower()
    for k, full in IFACE_PREFIX:
        if k.startswith(p):
            return full + m.group(2)
    return None


def walk(tree, words):
    """Return the subtree after walking keyword list (None if leaves tree)."""
    node = tree
    for w in words:
        k, e = pick(w, node.keys())
        if k:
            node = node[k][1]
            continue
        ph = [x for x in node if is_ph(x)]
        if ph:
            node = node[ph[0]][1]
            continue
        return None
    return node


def help_text(tree, line):
    words = line.split()
    if line.endswith(' ') or not line:
        node = walk(tree, words)
        if node is None:
            return '% Unrecognized command\n'
        if not node:
            return '  <cr>\n'
        w = max(len(k) for k in node) + 2
        out = ''.join(f"  {k.ljust(w)}{v[0]}\n" for k, v in sorted(node.items()))
        return out + ('  <cr>\n' if words else '')
    node = walk(tree, words[:-1])
    if node is None:
        return '% Unrecognized command\n'
    part = words[-1].lower()
    m = [k for k in sorted(node) if k.startswith(part) and not is_ph(k)]
    if not m:
        return '% Unrecognized command\n'
    return '  '.join(m) + '\n'


def complete(tree, line):
    words = line.split()
    if not words or line.endswith(' '):
        return None
    node = walk(tree, words[:-1])
    if not node:
        return None
    part = words[-1].lower()
    m = [k for k in node if k.startswith(part) and not is_ph(k)]
    if len(m) == 1:
        return line[:len(line) - len(words[-1])] + m[0] + ' '
    return None


def fmt_cols(rows, widths):
    out = []
    for r in rows:
        out.append(''.join(str(c).ljust(w) for c, w in zip(r, widths)).rstrip())
    return '\n'.join(out) + '\n'


# --------------------------------------------------------------------------- IOS CLI
class IOSCli:
    kind = 'ios'

    def __init__(self, sess, nid, vty=False):
        self.sess = sess
        self.rt = sess.rt
        self.nid = nid
        self.vty = vty
        self.mode = 'user'
        self.ctx = None
        self.capture = None
        self.history = []
        self.line_prefix = ''

    # ---------------------------------------------------------------- utils
    @property
    def s(self):
        return self.rt.state(self.nid)

    @property
    def t(self):
        return self.rt.node(self.nid)['type']

    def net(self):
        return self.rt.net()

    def prompt(self):
        return self.s['hostname'] + PROMPTS[self.mode]

    def tree(self):
        return TREES[self.mode]

    async def out(self, text):
        if self.capture is not None:
            self.capture.append(text)
        else:
            await self.sess.out(text)

    def dirty(self):
        self.rt.mark_dirty()

    def pk(self, toks, idx, keys):
        if idx >= len(toks):
            raise Incomplete()
        tok, pos = toks[idx]
        k, e = pick(tok, keys)
        if e == 'ambiguous':
            raise Ambiguous(tok)
        if e:
            raise Invalid(pos)
        return k

    def arg(self, toks, idx):
        if idx >= len(toks):
            raise Incomplete()
        return toks[idx][0]

    def ip_arg(self, toks, idx):
        v = self.arg(toks, idx)
        if not valid_ip(v):
            raise Invalid(toks[idx][1])
        return v

    def int_arg(self, toks, idx, lo=None, hi=None):
        v = self.arg(toks, idx)
        if not v.isdigit() or (lo is not None and int(v) < lo) or (hi is not None and int(v) > hi):
            raise Invalid(toks[idx][1])
        return int(v)

    def l2(self, ifn):
        return self.t in SWITCH and not ifn.startswith(('Vlan', 'Loopback')) and \
            self.s['ifaces'].get(ifn, {}).get('mode') != 'routed'

    def resolve_if(self, text, create=False):
        name = parse_ifname(text)
        if not name:
            return None
        s = self.s
        if name in s['ifaces']:
            return name
        if not create:
            return None
        if name.startswith('Loopback'):
            s['ifaces'][name] = {'shutdown': False}
            return name
        if name.startswith('Vlan') and self.t in SWITCH:
            v = name[4:]
            if not v.isdigit() or not 1 <= int(v) <= 4094:
                return None
            s['ifaces'][name] = {'shutdown': False}
            return name
        if '.' in name:
            base, sub = name.split('.', 1)
            if base in s['ifaces'] and sub.isdigit() and (self.t in ROUTER or s['ifaces'][base].get('mode') == 'routed'):
                s['ifaces'][name] = {'shutdown': False}
                return name
        return None

    # ---------------------------------------------------------------- entry
    async def run(self, raw):
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith('!'):
            return
        self.history.append(line)
        self.history = self.history[-50:]
        filt = None
        if '|' in line and (self.mode in ('user', 'priv') or line.strip().lower().startswith('do ')):
            line, filt = line.split('|', 1)
            filt = filt.strip()
            self.capture = []
        toks = [(m.group(), m.start()) for m in re.finditer(r'\S+', line)]
        try:
            await self.dispatch(toks, line)
        except Invalid as e:
            col = len(self.prompt()) + e.pos
            await self.out(' ' * col + '^\n% Invalid input detected at \'^\' marker.\n\n')
        except Incomplete:
            await self.out('% Incomplete command.\n\n')
        except Ambiguous as e:
            await self.out(f'% Ambiguous command: "{e.word}"\n')
        if filt is not None:
            text = ''.join(self.capture)
            self.capture = None
            await self.out(self.apply_filter(text, filt))

    def apply_filter(self, text, f):
        parts = f.split(None, 1)
        if len(parts) < 2:
            return text
        k, e = pick(parts[0], ['include', 'exclude', 'begin', 'section'])
        pat = parts[1]
        lines = text.split('\n')
        try:
            rx = re.compile(pat)
        except re.error:
            rx = re.compile(re.escape(pat))
        if k == 'include':
            lines = [l for l in lines if rx.search(l)]
        elif k == 'exclude':
            lines = [l for l in lines if not rx.search(l)]
        elif k == 'begin':
            for i, l in enumerate(lines):
                if rx.search(l):
                    lines = lines[i:]
                    break
            else:
                lines = []
        elif k == 'section':
            out, on = [], False
            for l in lines:
                if l and not l.startswith(' '):
                    on = bool(rx.search(l))
                if on:
                    out.append(l)
            lines = out
        return '\n'.join(lines) + '\n'

    async def dispatch(self, toks, line):
        m = self.mode
        if m == 'user':
            return await self.m_exec(toks, line, priv=False)
        if m == 'priv':
            return await self.m_exec(toks, line, priv=True)
        if m == 'config':
            return await self.m_config(toks, line)
        # sub-modes: try sub-mode parser, fall back to global config like IOS
        handler = {'if': self.m_if, 'ifr': self.m_if, 'subif': self.m_if, 'vlan': self.m_vlan,
                   'router': self.m_router, 'dhcp': self.m_dhcp, 'line': self.m_line, 'acl': self.m_acl}[m]
        try:
            return await handler(toks, line)
        except Invalid as e:
            # e.g. "ip route ..." typed right after an interface block: valid first word, invalid here
            first = toks[0][0].lower()
            k, err = pick(first, CONFIG.keys())
            if not k or k in ('exit', 'end', 'do') or (k == 'no' and e.pos == 0):
                raise
            saved = (self.mode, self.ctx)
            self.mode, self.ctx = 'config', None
            try:
                await self.m_config(toks, line)
            except (Invalid, Incomplete, Ambiguous):
                self.mode, self.ctx = saved
                raise e

    # ---------------------------------------------------------------- EXEC
    async def m_exec(self, toks, line, priv):
        tree = PRIV if priv else USER
        tok0, pos0 = toks[0]
        k, e = pick(tok0, tree.keys())
        if e == 'ambiguous':
            raise Ambiguous(tok0)
        if not k:
            if len(toks) == 1:
                if self.s.get('domain_lookup', True):
                    await self.out(f'Translating "{tok0}"...domain server (255.255.255.255)\n')
                    await asyncio.sleep(0.6)
                await self.out('% Unknown command or computer name, or unable to find computer address\n')
                return
            raise Invalid(pos0)
        if k == 'enable':
            return await self.do_enable()
        if k == 'disable':
            self.mode = 'user'
            return
        if k in ('exit', 'logout'):
            return await self.sess.exit_cli(self)
        if k == 'ping':
            return await self.do_ping(toks)
        if k == 'traceroute':
            return await self.do_trace(toks)
        if k == 'show':
            return await self.do_show(toks, priv)
        if k in ('telnet', 'ssh'):
            return await self.do_remote(k, toks)
        if k == 'terminal':
            return
        if k == 'configure':
            if len(toks) > 1:
                self.pk(toks, 1, ['terminal'])
            await self.out('Enter configuration commands, one per line.  End with CNTL/Z.\n')
            self.mode = 'config'
            return
        if k == 'write':
            sub = self.pk(toks, 1, ['memory', 'terminal', 'erase']) if len(toks) > 1 else 'memory'
            if sub == 'memory':
                return await self.save()
            if sub == 'terminal':
                return await self.out(running_config(self.t, self.s))
            return await self.erase()
        if k == 'copy':
            a = self.pk(toks, 1, ['running-config', 'startup-config'])
            b = self.pk(toks, 2, ['running-config', 'startup-config'])
            if a == b:
                raise Invalid(toks[2][1])
            if a == 'running-config':
                async def done(ans):
                    await self.save()
                self.sess.ask('Destination filename [startup-config]? ', done, echo=True)
            else:
                st = self.rt.node(self.nid).get('startup')
                if st:
                    self.rt.set_state(self.nid, copy.deepcopy(st))
                    await self.out(f'{len(running_config(self.t, st))} bytes copied in 0.416 secs\n')
            return
        if k == 'erase':
            self.pk(toks, 1, ['startup-config'])
            return await self.erase()
        if k == 'reload':
            return await self.reload()
        if k == 'clear':
            what = self.pk(toks, 1, ['arp-cache', 'mac', 'ip', 'access-list', 'counters'])
            if what == 'arp-cache':
                self.rt.arp.pop(self.nid, None)
            elif what == 'access-list':
                for acl in self.s.get('acls', {}).values():
                    for ent in acl:
                        ent.pop('hits', None)
            return
        if k == 'clock':
            return
        if k in ('debug', 'undebug'):
            if k == 'undebug' or (len(toks) > 1 and toks[1][0].lower().startswith('al')):
                return await self.out('All possible debugging has been turned off\n')
            return await self.out('% Debug output is not available in the simulator\n')
        raise Invalid(pos0)

    async def do_enable(self):
        s = self.s
        if self.mode == 'priv':
            return
        if self.vty and not (s.get('enable_secret') or s.get('enable_password')):
            return await self.out('% No password set\n')
        if s.get('enable_secret') or s.get('enable_password'):
            tries = [0]

            async def check(pw):
                ok = (s.get('enable_secret') and hash_secret(pw) == s['enable_secret']) or \
                     (not s.get('enable_secret') and pw == s.get('enable_password'))
                if ok:
                    self.mode = 'priv'
                    return
                tries[0] += 1
                if tries[0] >= 3:
                    await self.out('% Bad secrets\n\n')
                    return
                self.sess.ask('Password: ', check)
            self.sess.ask('Password: ', check)
            return
        self.mode = 'priv'

    async def save(self):
        await self.out('Building configuration...\n')
        await asyncio.sleep(0.3)
        self.rt.save_startup(self.nid)
        await self.out('[OK]\n')

    async def erase(self):
        async def go(ans):
            if ans.strip().lower() in ('', 'y', 'yes', 'confirm'):
                self.rt.node(self.nid)['startup'] = None
                self.dirty()
                await self.out('[OK]\nErase of nvram: complete\n')
                await self.out(f'%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram\n')
        self.sess.ask('Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', go, echo=True)

    async def reload(self):
        node = self.rt.node(self.nid)
        modified = (node.get('startup') or None) != self.s

        async def confirm(ans):
            if ans.strip().lower() in ('', 'y', 'yes', 'confirm'):
                await self.sess.reload_device(self.nid)

        async def save_q(ans):
            a = ans.strip().lower()
            if a.startswith('y'):
                await self.save()
            elif not a.startswith('n'):
                await self.out('% Please answer \'yes\' or \'no\'.\n')
                self.sess.ask('System configuration has been modified. Save? [yes/no]: ', save_q, echo=True)
                return
            self.sess.ask('Proceed with reload? [confirm]', confirm, echo=True)
        if modified:
            self.sess.ask('System configuration has been modified. Save? [yes/no]: ', save_q, echo=True)
        else:
            self.sess.ask('Proceed with reload? [confirm]', confirm, echo=True)

    # ---------------------------------------------------------------- ping / trace
    def first_loss(self, res):
        cache = self.rt.arp
        now = time.time()
        new = False
        for (n, ip) in res.get('arps', []):
            c = cache.setdefault(n, {})
            if ip not in c or now - c[ip] > 240:
                new = True
            c[ip] = now
        return new

    async def do_ping(self, toks):
        if len(toks) < 2:
            raise Incomplete()
        dst = toks[1][0]
        count, src = 5, None
        i = 2
        while i < len(toks):
            k = self.pk(toks, i, ['repeat', 'source', 'size', 'timeout'])
            if k == 'repeat':
                count = self.int_arg(toks, i + 1, 1, 1000)
            elif k == 'source':
                v = self.arg(toks, i + 1)
                if valid_ip(v):
                    src = v
                else:
                    ifn = self.resolve_if(v)
                    i_ = self.s['ifaces'].get(ifn or '', {})
                    if not ifn or not i_.get('ip'):
                        raise Invalid(toks[i + 1][1])
                    src = i_['ip']
            i += 2
        if not valid_ip(dst):
            await self.out('% Unrecognized host or address, or protocol not running.\n\n')
            return
        net = self.net()
        res = net.ping(self.nid, dst, src_ip=src)
        await self.out('Type escape sequence to abort.\n')
        await self.out(f'Sending {count}, 100-byte ICMP Echos to {dst}, timeout is 2 seconds:\n')
        if src:
            await self.out(f'Packet sent with a source address of {src} \n')
        ok = 0
        lose_first = res['ok'] and self.first_loss(res)
        unreach = (not res['ok']) and res.get('why') == 'unreachable' and res.get('at') != self.nid
        filtered = (not res['ok']) and res.get('why') == 'filtered' and res.get('at') != self.nid
        for n in range(count):
            if res['ok'] and not (n == 0 and lose_first):
                ok += 1
                await self.out('!')
                await asyncio.sleep(0.08)
            elif unreach or filtered:
                await self.out('U' if (unreach and n % 2 == 0) or filtered else '.')
                await asyncio.sleep(0.25)
            else:
                await self.out('.')
                await asyncio.sleep(0.4)
            if (n + 1) % 70 == 0:
                await self.out('\n')
        pct = ok * 100 // count
        if ok:
            hops = len(res['hops'])
            await self.out(f'\nSuccess rate is {pct} percent ({ok}/{count}), round-trip min/avg/max = '
                           f'{hops}/{hops + 1}/{hops * 2 + 2} ms\n')
        else:
            await self.out(f'\nSuccess rate is 0 percent (0/{count})\n')

    async def do_trace(self, toks):
        if len(toks) < 2:
            raise Incomplete()
        dst = toks[1][0]
        if not valid_ip(dst):
            await self.out('% Unrecognized host or address, or protocol not running.\n\n')
            return
        await self.out('Type escape sequence to abort.\nTracing the route to ' + dst + '\nVRF info: (vrf in name/id, vrf out name/id)\n')
        net = self.net()
        res = net.ping(self.nid, dst)
        f = net.forward(self.nid, dst)
        n = 0
        for n, h in enumerate(f['hops'], 1):
            await asyncio.sleep(0.15)
            await self.out(f'  {n} {h["ip"]} {n} msec {n} msec {n + 1} msec\n')
        if not res['ok']:
            for k in range(3):
                await asyncio.sleep(0.6)
                await self.out(f'  {n + 1 + k}  *    *    *    \n')
        await self.out('\n')

    async def do_remote(self, proto, toks):
        user = None
        if proto == 'ssh':
            if len(toks) < 4 or toks[1][0] != '-l':
                raise Incomplete()
            user = toks[2][0]
            dst = toks[3][0]
        else:
            if len(toks) < 2:
                raise Incomplete()
            dst = toks[1][0]
        if not valid_ip(dst):
            await self.out(f'Translating "{dst}"\n% Unknown command or computer name, or unable to find computer address\n')
            return
        await self.sess.connect(self, dst, proto, user)

    # ---------------------------------------------------------------- SHOW
    async def do_show(self, toks, priv):
        tree = SHOW if priv else SHOW_USER
        k = self.pk(toks, 1, tree.keys())
        net = self.net()
        s = self.s
        t = self.t
        if k == 'running-config':
            return await self.out(running_config(t, s))
        if k == 'startup-config':
            st = self.rt.node(self.nid).get('startup')
            if not st:
                return await self.out('startup-config is not present\n')
            txt = running_config(t, st).split('\n', 3)[3]
            return await self.out(f'Using {len(txt)} bytes\n' + txt)
        if k == 'version':
            return await self.out(self.version_text())
        if k == 'clock':
            return await self.out(time.strftime('*%H:%M:%S.000 UTC %a %b %d %Y\n', time.gmtime()))
        if k == 'history':
            return await self.out(''.join(f'  {h}\n' for h in self.history))
        if k == 'users':
            return await self.out('    Line       User       Host(s)              Idle       Location\n'
                                  f'*  0 {"vty 0" if self.vty else "con 0"}                idle                 00:00:00\n\n'
                                  '  Interface    User               Mode         Idle     Peer Address\n')
        if k == 'flash:':
            return await self.out('Directory of flash:/\n\n    1  -rw-    33591768          <no date>  ios-image.bin\n'
                                  '\n64016384 bytes total (30424616 bytes free)\n')
        if k == 'vlan':
            if t not in SWITCH:
                raise Invalid(toks[1][1])
            return await self.out(self.show_vlan())
        if k == 'mac':
            if t not in SWITCH:
                raise Invalid(toks[1][1])
            rows = net.mac_table(self.nid)
            o = '          Mac Address Table\n-------------------------------------------\n\n' \
                'Vlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n'
            for v, mac, port in rows:
                o += f'{str(v).rjust(4)}    {mac}    DYNAMIC     {short_if(port)}\n'
            return await self.out(o)
        if k == 'cdp':
            sub = self.pk(toks, 2, ['neighbors'])
            detail = len(toks) > 3 and toks[3][0].lower().startswith('d')
            rows = net.cdp(self.nid)
            if detail:
                o = ''
                for r in rows:
                    rip = next((e['ip'] for e in net.node_eps(r['nid'])), None)
                    o += ('-------------------------\n'
                          f"Device ID: {r['dev']}\nEntry address(es): \n" + (f'  IP address: {rip}\n' if rip else '') +
                          f"Platform: cisco {r['model']},  Capabilities: {'Router' if r['type'] in ROUTER else 'Switch'}\n"
                          f"Interface: {r['local']},  Port ID (outgoing port): {r['remote']}\nHoldtime: 171 sec\n\n")
                return await self.out(o)
            o = ('Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n'
                 '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone\n'
                 'Device ID    Local Intrfce   Holdtme    Capability   Platform    Port ID\n')
            for r in rows:
                cap = 'R' if r['type'] in ROUTER else ('S I' if r['type'] == 'switch' else 'R S I')
                o += f"{r['dev'][:12].ljust(13)}{short_if(r['local']).ljust(16)}{'171'.ljust(11)}{cap.ljust(13)}{r['model'][:11].ljust(12)}{short_if(r['remote'])}\n"
            return await self.out(o)
        if k == 'arp':
            return await self.out(self.show_arp(net))
        if k == 'interfaces':
            if len(toks) > 2:
                tok = toks[2][0].lower()
                if 'status'.startswith(tok) and len(tok) >= 2 or tok == 'status':
                    return await self.out(self.show_if_status(net))
                if 'trunk'.startswith(tok):
                    return await self.out(self.show_trunk(net))
                ifn = self.resolve_if(''.join(x[0] for x in toks[2:]))
                if not ifn:
                    raise Invalid(toks[2][1])
                return await self.out(self.show_if(net, ifn))
            return await self.out(''.join(self.show_if(net, n) for n in sorted(s['ifaces'], key=if_sort_key)))
        if k == 'access-lists':
            return await self.out(self.show_acls())
        if k == 'ip':
            sub = self.pk(toks, 2, SHOW['ip'][1].keys())
            if sub == 'interface':
                if len(toks) > 3:
                    self.pk(toks, 3, ['brief'])
                    return await self.out(self.show_ip_brief(net))
                return await self.out(self.show_ip_brief(net))
            if sub == 'route':
                flt = self.pk(toks, 3, ['connected', 'static', 'ospf', 'rip']) if len(toks) > 3 else None
                return await self.out(self.show_ip_route(net, flt))
            if sub == 'protocols':
                return await self.out(self.show_protocols())
            if sub == 'ospf':
                self.pk(toks, 3, ['neighbor'])
                return await self.out(self.show_ospf_nbr(net))
            if sub == 'rip':
                return await self.out(self.show_ip_route(net, 'rip'))
            if sub == 'dhcp':
                what = self.pk(toks, 3, ['binding', 'pool'])
                if what == 'binding':
                    o = 'IP address       Client-ID/              Lease expiration        Type\n' \
                        '                 Hardware address\n'
                    for cid, ip in s.get('leases', {}).items():
                        try:
                            mac = mac_for(int(cid), self.rt.node(int(cid))['ifaces'][0])
                        except Exception:
                            mac = '0000.0000.0000'
                        o += f'{ip.ljust(17)}{mac.ljust(24)}--                      Automatic\n'
                    return await self.out(o)
                o = ''
                for n, p in s.get('dhcp_pools', {}).items():
                    o += f"Pool {n} :\n Utilization mark (high/low)    : 100 / 0\n Subnet size (first/next)       : 0 / 0 \n" \
                         f" Total addresses                : {2 ** (32 - mask_len(p['mask'])) - 2 if p.get('mask') else 0}\n" \
                         f" Leased addresses               : {len(s.get('leases', {}))}\n Excluded addresses             : {len(s.get('dhcp_excluded', []))}\n\n"
                return await self.out(o)
            if sub == 'access-lists':
                return await self.out(self.show_acls())
        raise Invalid(toks[1][1])

    def model(self):
        return self.rt.model(self.nid)

    def version_text(self):
        m = self.model()
        up = int(time.time() - self.rt.started_at(self.nid))
        return (f"Cisco IOS Software, {m} Software (simulated by NexLab), Version 15.4(3)M2, RELEASE SOFTWARE (fc2)\n"
                "Technical Support: http://www.cisco.com/techsupport\n"
                "ROM: System Bootstrap, Version 15.4(1r)M, RELEASE SOFTWARE (fc1)\n\n"
                f"{self.s['hostname']} uptime is {up // 3600} hours, {up % 3600 // 60} minutes, {up % 60} seconds\n"
                "System image file is \"flash:ios-image.bin\"\n\n"
                f"cisco {m} processor with 491520K/32768K bytes of memory.\n"
                f"{len([i for i in self.s['ifaces'] if not i.startswith(('Vlan', 'Loopback')) and '.' not in i])} Ethernet interfaces\n"
                "255K bytes of non-volatile configuration memory.\n\n"
                "Configuration register is 0x2102\n")

    def show_ip_brief(self, net):
        o = 'Interface              IP-Address      OK? Method Status                Protocol \n'
        for n in sorted(self.s['ifaces'], key=if_sort_key):
            i = self.s['ifaces'][n]
            st, pr = net.if_status(self.nid, n)
            ip = i.get('ip') or 'unassigned'
            meth = 'manual' if i.get('ip') else 'unset'
            o += f"{n.ljust(23)}{ip.ljust(16)}{'YES' if i.get('ip') else 'YES'} {meth.ljust(7)}{st.ljust(22)}{pr}\n"
        return o

    def show_if(self, net, n):
        i = self.s['ifaces'][n]
        st, pr = net.if_status(self.nid, n)
        mac = mac_for(self.nid, n)
        hw = 'Gigabit Ethernet' if 'Gigabit' in n else 'Fast Ethernet' if 'Fast' in n else \
            'Loopback' if n.startswith('Loopback') else 'EtherSVI' if n.startswith('Vlan') else 'Ethernet'
        o = f'{n} is {st}, line protocol is {pr}' + (' (connected)' if pr == 'up' and self.l2(n) else '') + '\n'
        o += f'  Hardware is {hw}, address is {mac} (bia {mac})\n'
        if i.get('desc'):
            o += f"  Description: {i['desc']}\n"
        if i.get('ip'):
            o += f"  Internet address is {i['ip']}/{mask_len(i['mask'])}\n"
        bw = 1000000 if 'Gigabit' in n else 100000
        o += f'  MTU 1500 bytes, BW {bw} Kbit/sec, DLY 10 usec,\n     reliability 255/255, txload 1/255, rxload 1/255\n'
        o += '  Encapsulation ' + (f"802.1Q Virtual LAN, Vlan ID  {i['dot1q']}" if i.get('dot1q') else 'ARPA, loopback not set') + '\n'
        o += '  Full-duplex, Auto-speed, media type is RJ45\n' if not n.startswith(('Loopback', 'Vlan')) else ''
        o += ('  5 minute input rate 0 bits/sec, 0 packets/sec\n  5 minute output rate 0 bits/sec, 0 packets/sec\n'
              f'     {random.randint(100, 900)} packets input, {random.randint(10000, 90000)} bytes\n'
              f'     {random.randint(100, 900)} packets output, {random.randint(10000, 90000)} bytes\n')
        return o

    def show_if_status(self, net):
        if self.t not in SWITCH:
            return '% Command available on switches only\n'
        o = 'Port      Name               Status       Vlan       Duplex  Speed Type\n'
        for n in sorted(self.s['ifaces'], key=if_sort_key):
            if not self.l2(n):
                continue
            i = self.s['ifaces'][n]
            st, pr = net.if_status(self.nid, n)
            status = 'disabled' if st.startswith('admin') else 'connected' if pr == 'up' else 'notconnect'
            vl = 'trunk' if i.get('mode') == 'trunk' else str(i.get('vlan', 1))
            typ = 'GPON 2.5G/1.25G' if n.startswith('GPON') else '10/100/1000BaseTX' if 'Gigabit' in n else '10/100BaseTX'
            o += f"{short_if(n).ljust(10)}{(i.get('desc') or '')[:18].ljust(19)}{status.ljust(13)}{vl.ljust(11)}{'auto'.ljust(8)}{'auto'.ljust(6)}{typ}\n"
        return o

    def show_trunk(self, net):
        rows = [(n, i) for n, i in sorted(self.s['ifaces'].items(), key=lambda x: if_sort_key(x[0]))
                if self.l2(n) and i.get('mode') == 'trunk' and net.link_up(self.nid, n)]
        o = 'Port        Mode         Encapsulation  Status        Native vlan\n'
        for n, i in rows:
            o += f"{short_if(n).ljust(12)}{'on'.ljust(13)}{'802.1q'.ljust(15)}{'trunking'.ljust(14)}{i.get('native', 1)}\n"
        o += '\nPort        Vlans allowed on trunk\n'
        for n, i in rows:
            o += f"{short_if(n).ljust(12)}{i.get('allowed') or '1-1005'}\n"
        o += '\nPort        Vlans allowed and active in management domain\n'
        for n, i in rows:
            al = parse_vlan_list(i.get('allowed'))
            act = sorted(int(v) for v in self.s['vlans'] if al is None or int(v) in al)
            o += f"{short_if(n).ljust(12)}{','.join(map(str, act))}\n"
        return o

    def show_vlan(self):
        s = self.s
        o = ('\nVLAN Name                             Status    Ports\n'
             '---- -------------------------------- --------- -------------------------------\n')
        for v in sorted(s['vlans'], key=int):
            ports = [short_if(n) for n in sorted(s['ifaces'], key=if_sort_key)
                     if self.l2(n) and s['ifaces'][n].get('mode', 'access') != 'trunk'
                     and int(s['ifaces'][n].get('vlan', 1)) == int(v)]
            chunks = [', '.join(ports[i:i + 4]) for i in range(0, len(ports), 4)] or ['']
            o += f"{v.ljust(5)}{s['vlans'][v][:32].ljust(33)}{'active'.ljust(10)}{chunks[0]}\n"
            for c in chunks[1:]:
                o += ' ' * 48 + c + '\n'
        for v, n in (('1002', 'fddi-default'), ('1003', 'token-ring-default'), ('1004', 'fddinet-default'), ('1005', 'trnet-default')):
            o += f"{v.ljust(5)}{n.ljust(33)}act/unsup \n"
        return o

    def show_arp(self, net):
        o = 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n'
        now = time.time()
        for e in net.node_eps(self.nid):
            if e['ifn'].startswith('Loopback'):
                continue
            o += f"Internet  {e['ip'].ljust(17)}{'-'.ljust(11)}{mac_for(self.nid, e['ifn']).ljust(16)}ARPA   {e['ifn']}\n"
        for ip, ts in sorted(self.rt.arp.get(self.nid, {}).items()):
            if now - ts > 14400:
                continue
            ep = next((e for e in net.eps() if e['ip'] == ip), None)
            if not ep:
                continue
            mine = next((e for e in net.node_eps(self.nid) if e['dom'] == ep['dom']), None)
            o += f"Internet  {ip.ljust(17)}{str(int((now - ts) // 60)).ljust(11)}{mac_for(ep['nid'], ep['ifn']).ljust(16)}ARPA   {mine['ifn'] if mine else ''}\n"
        return o

    def show_ip_route(self, net, flt=None):
        s = self.s
        o = ('Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n'
             '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n'
             '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n'
             '       E1 - OSPF external type 1, E2 - OSPF external type 2\n'
             '       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2\n'
             '       ia - IS-IS inter area, * - candidate default, U - per-user static route\n'
             '       o - ODR, P - periodic downloaded static route, + - replicated route\n\n')
        if not net.can_route(self.nid):
            dg = s.get('default_gw')
            return 'Default gateway is ' + (dg if dg else 'not set') + '\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty\n'
        routes = net.routes(self.nid)
        d = next((r for r in routes if r['ln'] == 0), None)
        if d:
            o += f"Gateway of last resort is {d['nh'] or '0.0.0.0'} to network 0.0.0.0\n\n"
        else:
            o += 'Gateway of last resort is not set\n\n'
        mp = {'connected': ('C', 'L'), 'static': ('S', 'S*'), 'ospf': ('O', 'O*E2'), 'rip': ('R', 'R*')}
        for r in sorted(routes, key=lambda r: (ip2i(r['net']), r['ln'])):
            if flt and r['code'] not in mp[flt]:
                continue
            p = f"{r['net']}/{r['ln']}"
            code = r['code'].ljust(9)
            if r['code'] in ('C', 'L'):
                o += f"{code}{p} is directly connected, {r['iface']}\n"
            elif r['nh']:
                tail = f", 00:0{random.randint(1, 9)}:{random.randint(10, 59)}, {r['iface']}" if r['code'][0] in 'OR' else ''
                o += f"{code}{p} [{r['ad']}/{r['metric']}] via {r['nh']}{tail}\n"
            else:
                o += f"{code}{p} is directly connected, {r['iface']}\n"
        return o

    def show_protocols(self):
        s = self.s
        o = ''
        if s.get('ospf'):
            ospf = s['ospf']
            o += f"Routing Protocol is \"ospf {ospf.get('pid', 1)}\"\n  Outgoing update filter list for all interfaces is not set\n" \
                 f"  Router ID {ospf.get('rid') or self.router_id()}\n  Number of areas in this router is 1. 1 normal 0 stub 0 nssa\n" \
                 "  Maximum path: 4\n  Routing for Networks:\n"
            for n in ospf.get('networks', []):
                o += f"    {n['net']} {n['wild']} area {n['area']}\n"
            o += '  Distance: (default is 110)\n\n'
        if s.get('rip'):
            o += 'Routing Protocol is "rip"\n  Sending updates every 30 seconds\n  Default version control: send version ' \
                 f"{s['rip'].get('version', 1)}, receive any version\n  Routing for Networks:\n"
            for n in s['rip'].get('networks', []):
                o += f'\t{n}\n'
            o += '  Distance: (default is 120)\n'
        return o

    def router_id(self):
        ips = [i['ip'] for n, i in self.s['ifaces'].items() if i.get('ip') and n.startswith('Loopback')] or \
              [i['ip'] for i in self.s['ifaces'].values() if i.get('ip')]
        return max(ips, key=ip2i) if ips else '0.0.0.0'

    def show_ospf_nbr(self, net):
        net.dynamic()
        o = '\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n'
        for (v, oif, nhip, _) in net.adj['ospf'].get(self.nid, []):
            other = self.rt.state(v)
            rid = (other.get('ospf') or {}).get('rid') or IOSCli(self.sess, v).router_id()
            o += f"{rid.ljust(16)}{'1'.ljust(6)}{'FULL/DR'.ljust(16)}{'00:00:3' + str(random.randint(0, 9))}    {nhip.ljust(16)}{oif}\n"
        return o

    def show_acls(self):
        o = ''
        for name, entries in self.s.get('acls', {}).items():
            std = entries and entries[0].get('std')
            o += f"{'Standard' if std else 'Extended'} IP access list {name}\n"
            for i, e in enumerate(entries, 1):
                if e.get('remark'):
                    continue
                o += f"    {i * 10} {e['text']}" + (f" ({e['hits']} match(es))" if e.get('hits') else '') + '\n'
        return o

    # ---------------------------------------------------------------- CONFIG
    async def run_do(self, toks, line):
        rest = line[toks[1][1]:] if len(toks) > 1 else ''
        if not rest:
            raise Incomplete()
        sub = [(t, p - toks[1][1]) for t, p in toks[1:]]
        saved = self.mode
        self.mode = 'priv'
        try:
            await self.m_exec(sub, rest, priv=True)
        finally:
            if self.mode == 'priv':
                self.mode = saved

    async def m_config(self, toks, line):
        s = self.s
        tok0, pos0 = toks[0]
        neg = False
        if pick(tok0, CONFIG.keys())[0] == 'no':
            neg = True
            toks = toks[1:]
            if not toks:
                raise Incomplete()
        k = self.pk(toks, 0, CONFIG.keys())
        if k == 'do' and not neg:
            return await self.run_do(toks, line)
        if k == 'end':
            self.mode, self.ctx = 'priv', None
            return await self.out(f'%SYS-5-CONFIG_I: Configured from console by console\n')
        if k == 'exit':
            self.mode, self.ctx = 'priv', None
            return
        self.dirty()
        if k == 'hostname':
            if neg:
                s['hostname'] = self.default_name()
                return
            name = self.arg(toks, 1)
            if not re.match(r'^[A-Za-z][\w\-]{0,62}$', name):
                raise Invalid(toks[1][1])
            s['hostname'] = name
            return
        if k == 'enable':
            w = self.pk(toks, 1, ['secret', 'password'])
            if neg:
                s['enable_' + w] = None
                return
            idx = 2
            if len(toks) > 3 and toks[2][0] in ('0', '5', '7'):
                idx = 3
            pw = self.arg(toks, idx)
            s['enable_' + w] = hash_secret(pw) if w == 'secret' else pw
            return
        if k == 'service':
            self.pk(toks, 1, ['password-encryption'])
            s['pw_encrypt'] = not neg
            return
        if k == 'cdp':
            self.pk(toks, 1, ['run'])
            s['cdp'] = not neg
            return
        if k == 'interface':
            return await self.cfg_interface(toks, neg)
        if k == 'vlan':
            if self.t not in SWITCH:
                raise Invalid(toks[0][1])
            ids = parse_vlan_list(self.arg(toks, 1)) or set()
            if not ids or any(not 1 <= v <= 4094 for v in ids):
                raise Invalid(toks[1][1])
            if neg:
                for v in ids:
                    if v == 1:
                        await self.out('%Default VLAN 1 may not be deleted.\n')
                        continue
                    s['vlans'].pop(str(v), None)
                return
            for v in ids:
                s['vlans'].setdefault(str(v), f'VLAN{v:04d}')
            self.mode, self.ctx = 'vlan', sorted(ids)
            return
        if k == 'ip':
            return await self.cfg_ip(toks, neg)
        if k == 'router':
            p = self.pk(toks, 1, ['ospf', 'rip'])
            if not (self.t in ROUTER or self.t == 'l3switch'):
                raise Invalid(toks[0][1])
            if neg:
                s[p] = None
                return
            if p == 'ospf':
                pid = self.int_arg(toks, 2, 1, 65535)
                if not s.get('ospf'):
                    s['ospf'] = {'pid': pid, 'networks': [], 'passive': []}
            else:
                if not s.get('rip'):
                    s['rip'] = {'networks': [], 'passive': [], 'version': 1, 'auto_summary': True}
            self.mode, self.ctx = 'router', p
            return
        if k == 'line':
            w = self.pk(toks, 1, ['console', 'vty'])
            self.int_arg(toks, 2, 0, 15)
            self.mode, self.ctx = 'line', 'con' if w == 'console' else 'vty'
            return
        if k == 'banner':
            self.pk(toks, 1, ['motd'])
            if neg:
                s['banner'] = ''
                return
            rest = line[toks[2][1]:] if len(toks) > 2 else ''
            if not rest:
                raise Incomplete()
            delim = rest[0]
            body = rest[1:]
            if delim in body:
                s['banner'] = body[:body.index(delim)]
                return
            buf = [body]

            async def more(text):
                if delim in text:
                    buf.append(text[:text.index(delim)])
                    s['banner'] = '\n'.join(buf).strip('\n')
                    self.dirty()
                else:
                    buf.append(text)
                    self.sess.ask('', more, echo=True)
            await self.out(f"Enter TEXT message.  End with the character '{delim}'.\n")
            self.sess.ask('', more, echo=True)
            return
        if k == 'username':
            u = self.arg(toks, 1)
            if neg:
                s['users'].pop(u, None)
                return
            priv = 1
            i = 2
            d = {}
            while i < len(toks):
                w = self.pk(toks, i, ['privilege', 'secret', 'password'])
                if w == 'privilege':
                    priv = self.int_arg(toks, i + 1, 0, 15)
                    i += 2
                    continue
                idx = i + 1
                if len(toks) > i + 2 and toks[i + 1][0] in ('0', '5', '7'):
                    idx = i + 2
                pw = self.arg(toks, idx)
                d = {'secret': hash_secret(pw)} if w == 'secret' else {'password': pw}
                break
            if not d:
                raise Incomplete()
            d['priv'] = priv
            d['plain'] = None
            s['users'][u] = d
            return
        if k == 'crypto':
            self.pk(toks, 1, ['key'])
            w = self.pk(toks, 2, ['generate', 'zeroize'])
            if w == 'zeroize':
                s['rsa'] = False
                return
            self.pk(toks, 3, ['rsa'])
            if not s.get('domain'):
                return await self.out('% Please define a domain-name first.\n')
            name = f"{s['hostname']}.{s['domain']}"
            modulus = None
            for i, (tk, _) in enumerate(toks):
                if tk.lower().startswith('mod') and i + 1 < len(toks):
                    modulus = toks[i + 1][0]

            async def gen(bits):
                b = bits.strip() or '512'
                await self.out(f"% Generating {b} bit RSA keys, keys will be non-exportable...[OK]\n")
                s['rsa'] = True
                self.dirty()
                await self.out('*Mar 1 0:12:4.511: %SSH-5-ENABLED: SSH 1.99 has been enabled\n')
            await self.out(f"The name for the keys will be: {name}\nChoose the size of the key modulus in the range of 360 to 4096 for your\n"
                           "  General Purpose Keys. Choosing a key modulus greater than 512 may take\n  a few minutes.\n\n")
            if modulus:
                await gen(modulus)
            else:
                self.sess.ask('How many bits in the modulus [512]: ', gen, echo=True)
            return
        if k == 'access-list':
            num = self.arg(toks, 1)
            if not num.isdigit() or not (1 <= int(num) <= 199 or 1300 <= int(num) <= 2699):
                raise Invalid(toks[1][1])
            if neg:
                s['acls'].pop(num, None)
                return
            std = int(num) < 100 or 1300 <= int(num) <= 1999
            ent = self.parse_ace(toks, 2, std, line)
            s['acls'].setdefault(num, []).append(ent)
            return
        if k in ('spanning-tree', 'logging', 'clock'):
            return self.passthru(line, neg)
        raise Invalid(toks[0][1])

    def passthru(self, line, neg):
        text = line.strip()
        ex = self.s.setdefault('extra', [])
        if neg:
            target = text[3:].strip()
            self.s['extra'] = [x for x in ex if x != target]
            return
        if text not in ex:
            ex.append(text)

    def default_name(self):
        return self.rt.node(self.nid)['name']

    def parse_ace(self, toks, i, std, line):
        action = self.pk(toks, i, ['permit', 'deny', 'remark'])
        if action == 'remark':
            return {'action': 'remark', 'remark': True, 'text': line[toks[i][1]:].strip(), 'std': std}
        text = line[toks[i][1]:].strip()
        i += 1

        def addr(i):
            w = self.arg(toks, i).lower()
            if w == 'any':
                return None, i + 1
            if w == 'host':
                return (self.ip_arg(toks, i + 1), '0.0.0.0'), i + 2
            ip = self.ip_arg(toks, i)
            if i + 1 < len(toks) and valid_ip(toks[i + 1][0]):
                return (ip, toks[i + 1][0]), i + 2
            return (ip, '0.0.0.0'), i + 1
        if std:
            src, i = addr(i)
            return {'action': action, 'std': True, 'src': src, 'text': text}
        proto = self.pk(toks, i, ['ip', 'icmp', 'tcp', 'udp'])
        src, i = addr(i + 1)
        if proto in ('tcp', 'udp') and i < len(toks) and toks[i][0] in ('eq', 'neq', 'gt', 'lt'):
            i += 2
        dst, i = addr(i)
        port = None
        if i < len(toks) and proto in ('tcp', 'udp'):
            op = self.pk(toks, i, ['eq', 'neq', 'gt', 'lt', 'established'])
            if op != 'established':
                v = self.arg(toks, i + 1).lower()
                names = {'telnet': 23, 'ssh': 22, 'www': 80, 'http': 80, 'https': 443, 'domain': 53, 'ftp': 21,
                         'bootps': 67, 'bootpc': 68, 'tftp': 69, 'smtp': 25}
                n = names.get(v, int(v) if v.isdigit() else None)
                if n is None:
                    raise Invalid(toks[i + 1][1])
                port = (op, n)
        return {'action': action, 'std': False, 'proto': proto, 'src': src, 'dst': dst, 'port': port, 'text': text}

    async def cfg_ip(self, toks, neg):
        s = self.s
        sub = self.pk(toks, 1, CONFIG['ip'][1].keys())
        if sub == 'route':
            net = self.ip_arg(toks, 2)
            mask = self.ip_arg(toks, 3)
            if not valid_mask(mask):
                raise Invalid(toks[3][1])
            if neg:
                nh = toks[4][0] if len(toks) > 4 else None
                s['routes'] = [r for r in s['routes'] if not (r['net'] == net and r['mask'] == mask and (nh is None or r['nh'] == nh))]
                return
            nh_tok = self.arg(toks, 4)
            if valid_ip(nh_tok):
                nh = nh_tok
            else:
                nh = self.resolve_if(nh_tok + (toks[5][0] if len(toks) > 5 and toks[5][0][0].isdigit() else ''))
                if not nh:
                    raise Invalid(toks[4][1])
            if net_of(net, mask_len(mask)) != ip2i(net):
                return await self.out('%Inconsistent address and mask\n')
            ad = 1
            if len(toks) > 5 and toks[-1][0].isdigit():
                ad = int(toks[-1][0])
            s['routes'] = [r for r in s['routes'] if not (r['net'] == net and r['mask'] == mask and r['nh'] == nh)]
            s['routes'].append({'net': net, 'mask': mask, 'nh': nh, 'ad': ad})
            return
        if sub == 'routing':
            if self.t == 'switch':
                raise Invalid(toks[1][1])
            s['ip_routing'] = not neg
            return
        if sub == 'default-gateway':
            s['default_gw'] = '' if neg else self.ip_arg(toks, 2)
            return
        if sub == 'domain-name':
            s['domain'] = '' if neg else self.arg(toks, 2)
            return
        if sub == 'domain-lookup':
            s['domain_lookup'] = not neg
            return
        if sub == 'nat':
            text = ' '.join(t[0] for t in toks)
            return self.passthru(('no ' + text) if neg else text, neg)
        if sub == 'ssh':
            return self.passthru(' '.join(t[0] for t in toks) if not neg else 'no ' + ' '.join(t[0] for t in toks), neg)
        if sub == 'dhcp':
            w = self.pk(toks, 2, ['pool', 'excluded-address'])
            if w == 'pool':
                name = self.arg(toks, 3)
                if neg:
                    s['dhcp_pools'].pop(name, None)
                    return
                s['dhcp_pools'].setdefault(name, {})
                self.mode, self.ctx = 'dhcp', name
                return
            a = self.ip_arg(toks, 3)
            b = self.ip_arg(toks, 4) if len(toks) > 4 else a
            if neg:
                s['dhcp_excluded'] = [x for x in s['dhcp_excluded'] if x != [a, b]]
            elif [a, b] not in s['dhcp_excluded']:
                s['dhcp_excluded'].append([a, b])
            return
        if sub == 'access-list':
            kind = self.pk(toks, 2, ['standard', 'extended'])
            name = self.arg(toks, 3)
            if neg:
                s['acls'].pop(name, None)
                return
            s['acls'].setdefault(name, [])
            self.mode, self.ctx = 'acl', (name, kind == 'standard')
            return
        raise Invalid(toks[1][1])

    async def cfg_interface(self, toks, neg):
        s = self.s
        if len(toks) < 2:
            raise Incomplete()
        if toks[1][0].lower().startswith('ra') and pick(toks[1][0], ['range'])[0]:
            spec = ' '.join(t[0] for t in toks[2:])
            names = []
            for part in spec.split(','):
                m = re.match(r'^\s*([a-zA-Z\-]+)\s*([\d/]*/)?(\d+)\s*(?:-\s*(\d+))?\s*$', part)
                if not m:
                    raise Invalid(toks[2][1] if len(toks) > 2 else toks[1][1])
                pref, mid, a, b = m.group(1), m.group(2) or '', int(m.group(3)), int(m.group(4) or m.group(3))
                for n in range(a, b + 1):
                    nm = self.resolve_if(f'{pref}{mid}{n}')
                    if not nm:
                        raise Invalid(toks[2][1])
                    names.append(nm)
            if not names:
                raise Incomplete()
            self.mode, self.ctx = 'ifr', names
            return
        text = ''.join(t[0] for t in toks[1:])
        if neg:
            nm = parse_ifname(text)
            if nm and nm in s['ifaces'] and (nm.startswith(('Loopback', 'Vlan')) or '.' in nm):
                del s['ifaces'][nm]
                return
            raise Invalid(toks[1][1])
        name = self.resolve_if(text, create=True)
        if not name:
            raise Invalid(toks[1][1])
        self.mode = 'subif' if '.' in name else 'if'
        self.ctx = [name]
        if name.startswith('Loopback') and not s['ifaces'][name].get('announced'):
            s['ifaces'][name]['announced'] = True
            await self.out(f'\n%LINK-5-CHANGED: Interface {name}, changed state to up\n\n'
                           f'%LINEPROTO-5-UPDOWN: Line protocol on Interface {name}, changed state to up\n')

    # ---------------------------------------------------------------- interface mode
    async def m_if(self, toks, line):
        s = self.s
        tok0, pos0 = toks[0]
        neg = False
        if pick(tok0, IF.keys())[0] == 'no':
            neg = True
            toks = toks[1:]
            if not toks:
                raise Incomplete()
        k = self.pk(toks, 0, IF.keys())
        if k == 'do' and not neg:
            return await self.run_do(toks, line)
        if k == 'exit':
            self.mode, self.ctx = 'config', None
            return
        if k == 'end':
            self.mode, self.ctx = 'priv', None
            return await self.out('%SYS-5-CONFIG_I: Configured from console by console\n')
        if k == 'interface':
            return await self.cfg_interface([('interface', 0)] + toks[1:], False)
        self.dirty()
        names = self.ctx
        before = None
        if k == 'shutdown':
            net0 = self.net()
            before = {n: net0.if_status(self.nid, n) for n in names}
            for n in names:
                s['ifaces'][n]['shutdown'] = not neg
            net1 = self.net()
            for n in names:
                await self.announce(n, before[n], net1.if_status(self.nid, n), net1)
            return
        if k == 'description':
            for n in names:
                if neg:
                    s['ifaces'][n].pop('desc', None)
                else:
                    s['ifaces'][n]['desc'] = line[toks[1][1]:].strip() if len(toks) > 1 else ''
            return
        if k == 'ip':
            sub = self.pk(toks, 1, IF['ip'][1].keys())
            if sub == 'address':
                for n in names:
                    if self.l2(n):
                        raise Invalid(toks[0][1])
                if neg:
                    for n in names:
                        s['ifaces'][n].pop('ip', None)
                        s['ifaces'][n].pop('mask', None)
                        s['ifaces'][n].pop('dhcp_client', None)
                    return
                if len(toks) > 2 and toks[2][0].lower() == 'dhcp':
                    return await self.out('% DHCP client on interfaces is not simulated; use a static address\n')
                ip = self.ip_arg(toks, 2)
                mask = self.ip_arg(toks, 3)
                if not valid_mask(mask):
                    raise Invalid(toks[3][1])
                ln = mask_len(mask)
                n = names[0]
                if '.' in n and not s['ifaces'][n].get('dot1q'):
                    return await self.out('\n% Configuring IP routing on a LAN subinterface is only allowed if that\n'
                                          'subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,\n'
                                          'or ISL vLAN.\n\n')
                if ln < 31 and (ip2i(ip) == net_of(ip, ln) or ip2i(ip) == bcast_of(ip, ln)):
                    return await self.out(f'Bad mask /{ln} for address {ip}\n')
                for other, oi in s['ifaces'].items():
                    if other != n and oi.get('ip') and (in_net(ip, oi['ip'], min(ln, mask_len(oi['mask'])))):
                        return await self.out(f"% {i2ip(net_of(ip, ln))} overlaps with {other}\n")
                s['ifaces'][n]['ip'] = ip
                s['ifaces'][n]['mask'] = mask
                return
            if sub == 'helper-address':
                for n in names:
                    if neg:
                        s['ifaces'][n].pop('helper', None)
                    else:
                        s['ifaces'][n]['helper'] = self.ip_arg(toks, 2)
                return
            if sub == 'access-group':
                name = self.arg(toks, 2)
                d = self.pk(toks, 3, ['in', 'out'])
                for n in names:
                    if neg:
                        s['ifaces'][n].pop('acl_' + d, None)
                    else:
                        s['ifaces'][n]['acl_' + d] = name
                return
            if sub == 'nat':
                d = self.pk(toks, 2, ['inside', 'outside'])
                for n in names:
                    if neg:
                        s['ifaces'][n].pop('nat', None)
                    else:
                        s['ifaces'][n]['nat'] = d
                return
            if sub == 'ospf':
                return self.if_passthru(names, line, neg)
        if k == 'switchport':
            if len(toks) == 1:
                if self.t != 'l3switch':
                    raise Invalid(toks[0][1])
                for n in names:
                    if neg:
                        s['ifaces'][n] = {'shutdown': s['ifaces'][n].get('shutdown', False), 'mode': 'routed'}
                    else:
                        s['ifaces'][n] = {'shutdown': s['ifaces'][n].get('shutdown', False), 'mode': 'access', 'vlan': 1}
                return
            for n in names:
                if not self.l2(n):
                    raise Invalid(toks[0][1])
            sub = self.pk(toks, 1, IF['switchport'][1].keys())
            if sub == 'mode':
                m = self.pk(toks, 2, ['access', 'trunk', 'dynamic'])
                for n in names:
                    i = s['ifaces'][n]
                    if neg:
                        i['mode'] = 'access'
                        i.pop('mode_set', None)
                        continue
                    old = i.get('mode')
                    i['mode'] = 'access' if m == 'dynamic' else m
                    i['mode_set'] = True
                    if old != i['mode'] and self.net().link_up(self.nid, n):
                        await self.out(f'\n%LINEPROTO-5-UPDOWN: Line protocol on Interface {n}, changed state to down\n\n'
                                       f'%LINEPROTO-5-UPDOWN: Line protocol on Interface {n}, changed state to up\n')
                return
            if sub == 'access':
                self.pk(toks, 2, ['vlan'])
                if neg:
                    for n in names:
                        s['ifaces'][n]['vlan'] = 1
                    return
                v = self.int_arg(toks, 3, 1, 4094)
                if str(v) not in s['vlans']:
                    await self.out(f'% Access VLAN does not exist. Creating vlan {v}\n')
                    s['vlans'][str(v)] = f'VLAN{v:04d}'
                for n in names:
                    s['ifaces'][n]['vlan'] = v
                return
            if sub == 'trunk':
                w = self.pk(toks, 2, ['allowed', 'native', 'encapsulation'])
                if w == 'encapsulation':
                    return
                if w == 'native':
                    self.pk(toks, 3, ['vlan'])
                    v = 1 if neg else self.int_arg(toks, 4, 1, 4094)
                    for n in names:
                        s['ifaces'][n]['native'] = v
                    return
                self.pk(toks, 3, ['vlan'])
                if neg:
                    for n in names:
                        s['ifaces'][n].pop('allowed', None)
                    return
                op = toks[4][0].lower() if len(toks) > 4 else ''
                for n in names:
                    i = s['ifaces'][n]
                    cur = parse_vlan_list(i.get('allowed'))
                    if op in ('add', 'remove', 'except', 'all', 'none'):
                        if op == 'all':
                            i.pop('allowed', None)
                            continue
                        if op == 'none':
                            i['allowed'] = 'none'
                            continue
                        lst = parse_vlan_list(self.arg(toks, 5)) or set()
                        if op == 'add':
                            cur = (cur if cur is not None else set()) | lst
                        elif op == 'remove':
                            cur = (cur if cur is not None else set(range(1, 4095))) - lst
                        else:
                            cur = set(range(1, 4095)) - lst
                    else:
                        try:
                            cur = parse_vlan_list(self.arg(toks, 4))
                        except ValueError:
                            raise Invalid(toks[4][1])
                    i['allowed'] = self.compress(cur) if cur is not None else None
                return
            return self.if_passthru(names, line, neg)
        if k == 'encapsulation':
            self.pk(toks, 1, ['dot1q'])
            for n in names:
                if '.' not in n:
                    return await self.out('% Configuring 802.1Q on the main interface is not supported; use a subinterface\n')
                if neg:
                    s['ifaces'][n].pop('dot1q', None)
                    continue
                s['ifaces'][n]['dot1q'] = self.int_arg(toks, 2, 1, 4094)
                s['ifaces'][n]['native_sub'] = len(toks) > 3 and toks[3][0].lower().startswith('nat')
            return
        if k in ('speed', 'duplex', 'spanning-tree', 'cdp', 'channel-group'):
            return self.if_passthru(names, line, neg)
        raise Invalid(toks[0][1])

    def compress(self, vals):
        vals = sorted(vals)
        if not vals:
            return 'none'
        out, start, prev = [], vals[0], vals[0]
        for v in vals[1:] + [None]:
            if v is not None and v == prev + 1:
                prev = v
                continue
            out.append(str(start) if start == prev else f'{start}-{prev}')
            if v is not None:
                start = prev = v
        return ','.join(out)

    def if_passthru(self, names, line, neg):
        text = line.strip()
        for n in names:
            ex = self.s['ifaces'][n].setdefault('extra', [])
            if neg:
                tgt = text[3:].strip()
                self.s['ifaces'][n]['extra'] = [x for x in ex if x != tgt]
            elif text not in ex:
                ex.append(text)

    async def announce(self, n, before, after, net):
        if before == after:
            return
        st, pr = after
        if st.startswith('admin'):
            await self.out(f'\n%LINK-5-CHANGED: Interface {n}, changed state to administratively down\n')
            if before[1] == 'up':
                await self.out(f'\n%LINEPROTO-5-UPDOWN: Line protocol on Interface {n}, changed state to down\n')
        else:
            await self.out(f'\n%LINK-5-CHANGED: Interface {n}, changed state to {st}\n')
            if pr == 'up':
                await self.out(f'\n%LINEPROTO-5-UPDOWN: Line protocol on Interface {n}, changed state to up\n')
        # peer side announcement goes to peer's open consoles
        l = net.port_link.get((self.nid, n.split('.')[0]))
        if l:
            pn, pi = net.peer(l, self.nid, n)
            pst = net.if_status(pn, pi)
            if net.t(pn) in ROUTER | SWITCH:
                msg = f'\n%LINK-5-CHANGED: Interface {pi}, changed state to {"up" if pst[1] == "up" else "down"}\n'
                if pst[1] == 'up':
                    msg += f'\n%LINEPROTO-5-UPDOWN: Line protocol on Interface {pi}, changed state to up\n'
                await self.sess.notify(pn, msg)

    # ---------------------------------------------------------------- other sub modes
    def submode_common(self, toks, tree):
        tok0 = toks[0][0]
        neg = False
        if pick(tok0, tree.keys())[0] == 'no':
            neg = True
            toks = toks[1:]
            if not toks:
                raise Incomplete()
        return neg, toks, self.pk(toks, 0, tree.keys())

    async def common_exit(self, k, toks, line):
        if k == 'do':
            await self.run_do(toks, line)
            return True
        if k == 'exit':
            self.mode, self.ctx = 'config', None
            return True
        if k == 'end':
            self.mode, self.ctx = 'priv', None
            await self.out('%SYS-5-CONFIG_I: Configured from console by console\n')
            return True
        return False

    async def m_vlan(self, toks, line):
        neg, toks, k = self.submode_common(toks, VLAN)
        if await self.common_exit(k, toks, line):
            return
        self.dirty()
        if k == 'name':
            for v in self.ctx:
                self.s['vlans'][str(v)] = f'VLAN{v:04d}' if neg else self.arg(toks, 1)[:32]
            return
        raise Invalid(toks[0][1])

    async def m_router(self, toks, line):
        neg, toks, k = self.submode_common(toks, ROUTER_T)
        if await self.common_exit(k, toks, line):
            return
        self.dirty()
        cfg = self.s[self.ctx]
        if k == 'network':
            ip = self.ip_arg(toks, 1)
            if self.ctx == 'ospf':
                wild = self.ip_arg(toks, 2)
                self.pk(toks, 3, ['area'])
                area = self.arg(toks, 4)
                ent = {'net': ip, 'wild': wild, 'area': area}
                cfg['networks'] = [n for n in cfg['networks'] if not (n['net'] == ip and n['wild'] == wild)]
                if not neg:
                    cfg['networks'].append(ent)
            else:
                ln = classful_len(ip)
                cn = i2ip(net_of(ip, ln))
                cfg['networks'] = [n for n in cfg['networks'] if n != cn]
                if not neg:
                    cfg['networks'].append(cn)
            if not neg and self.ctx == 'ospf':
                net = self.net()
                for (v, oif, nhip, _) in net.adj['ospf'].get(self.nid, []) if net.dynamic() is not None else []:
                    rid = (self.rt.state(v).get('ospf') or {}).get('rid') or IOSCli(self.sess, v).router_id()
                    await self.out(f'\n%OSPF-5-ADJCHG: Process {cfg.get("pid", 1)}, Nbr {rid} on {oif} from LOADING to FULL, Loading Done\n')
                    await self.sess.notify(v, f'\n%OSPF-5-ADJCHG: Process 1, Nbr {self.router_id()} on {_} from LOADING to FULL, Loading Done\n')
            return
        if k == 'passive-interface':
            n = self.resolve_if(''.join(t[0] for t in toks[1:]))
            if not n:
                raise Invalid(toks[1][1] if len(toks) > 1 else toks[0][1])
            cfg['passive'] = [x for x in cfg.get('passive', []) if x != n]
            if not neg:
                cfg['passive'].append(n)
            return
        if k == 'router-id':
            cfg['rid'] = None if neg else self.ip_arg(toks, 1)
            if not neg:
                await self.out('Reload or use "clear ip ospf process" command, for this to take effect\n')
            return
        if k == 'default-information':
            self.pk(toks, 1, ['originate'])
            cfg['default_originate'] = not neg
            return
        if k == 'version':
            cfg['version'] = self.int_arg(toks, 1, 1, 2) if not neg else 1
            return
        if k == 'auto-summary':
            cfg['auto_summary'] = not neg
            return
        if k == 'log-adjacency-changes':
            return
        raise Invalid(toks[0][1])

    async def m_dhcp(self, toks, line):
        neg, toks, k = self.submode_common(toks, DHCP_T)
        if await self.common_exit(k, toks, line):
            return
        self.dirty()
        p = self.s['dhcp_pools'].setdefault(self.ctx, {})
        if k == 'network':
            if neg:
                p.pop('network', None)
                return
            a = self.arg(toks, 1)
            if '/' in a:
                ip, ln = a.split('/')
                mask = len_mask(int(ln))
            else:
                ip = self.ip_arg(toks, 1)
                mask = self.ip_arg(toks, 2)
            if not valid_mask(mask):
                raise Invalid(toks[-1][1])
            p['network'] = i2ip(net_of(ip, mask_len(mask)))
            p['mask'] = mask
            return
        if k == 'default-router':
            p['gw'] = '' if neg else self.ip_arg(toks, 1)
            return
        if k == 'dns-server':
            p['dns'] = '' if neg else self.ip_arg(toks, 1)
            return
        if k == 'domain-name':
            p['domain'] = '' if neg else self.arg(toks, 1)
            return
        if k == 'lease':
            return
        raise Invalid(toks[0][1])

    async def m_line(self, toks, line):
        neg, toks, k = self.submode_common(toks, LINE_T)
        if await self.common_exit(k, toks, line):
            return
        self.dirty()
        ln = self.s['lines'][self.ctx]
        if k == 'password':
            if neg:
                ln['password'] = None
                return
            idx = 2 if len(toks) > 2 and toks[1][0] in ('0', '7') else 1
            ln['password'] = self.arg(toks, idx)
            return
        if k == 'login':
            if neg:
                ln['login'] = False
            elif len(toks) > 1:
                self.pk(toks, 1, ['local'])
                ln['login'] = 'local'
            else:
                ln['login'] = True
                if not ln.get('password'):
                    await self.out('% Login disabled on line, until \'password\' is set\n')
            return
        if k == 'transport':
            self.pk(toks, 1, ['input'])
            vals = [t[0].lower() for t in toks[2:]]
            if not vals:
                raise Incomplete()
            ok = {'ssh', 'telnet', 'all', 'none'}
            for i, v in enumerate(vals):
                if v not in ok:
                    raise Invalid(toks[2 + i][1])
            ln['transport'] = 'all' if 'all' in vals or set(vals) >= {'ssh', 'telnet'} else vals[0]
            return
        if k in ('exec-timeout', 'logging'):
            return
        raise Invalid(toks[0][1])

    async def m_acl(self, toks, line):
        neg, toks, k = self.submode_common(toks, ACL_T)
        if await self.common_exit(k, toks, line):
            return
        self.dirty()
        name, std = self.ctx
        acl = self.s['acls'].setdefault(name, [])
        if neg:
            text = line.strip()[3:].strip()
            self.s['acls'][name] = [e for e in acl if e['text'] != text]
            return
        sub = [(tk, p) for tk, p in toks]
        acl.append(self.parse_ace(sub, 0, std, line))


# --------------------------------------------------------------------------- PC command prompt
PC_HELP = """Packet Tracer PC Command Line 1.0 (NexLab)
Available Commands:
?            Display the list of available commands
arp          Display the arp table  (arp -a | arp -d)
cls          Clear the screen
dhcp         Request an IP address via DHCP   (same as ipconfig /renew)
help         Display the list of available commands
hostname     Show or set the host name
ip           VPCS style: ip <addr>/<len> [gateway]  |  ip <addr> <mask> [gateway]  |  ip dns <addr>
ipconfig     Display/Set IP configuration: ipconfig | ipconfig /all | ipconfig /renew | /release
             ipconfig <IP> <mask> [gateway]
netstat      Display current connections
nslookup     DNS lookup:  nslookup <name>
ping         Send echo messages:  ping <ip|name> [-n count] [-t]
show         VPCS style: show ip
ssh          Secure shell:  ssh -l <user> <ip>
telnet       Telnet client: telnet <ip>
tracert      Trace route to destination
curl         Ambil halaman web:  curl http://<ip|nama>/
browser      Buka web (teks):    browser <ip|nama>
wifi         Sambung WiFi:       wifi <ssid> [password]   |  wifi (status)
script       Daftar script tersimpan
run          Jalankan script:    run <nama>
"""


class StopScript(Exception):
    pass


class PCCli:
    kind = 'pc'

    def __init__(self, sess, nid):
        self.sess = sess
        self.rt = sess.rt
        self.nid = nid
        self.history = []
        self.vty = False

    @property
    def s(self):
        return self.rt.state(self.nid)

    def prompt(self):
        return 'C:\\>'

    def tree(self):
        return {k: T('') for k in ('arp', 'browser', 'cls', 'curl', 'dhcp', 'help', 'hostname', 'ip', 'ipconfig', 'netstat',
                                   'nslookup', 'ping', 'run', 'script', 'show', 'ssh', 'telnet', 'tracert', 'wifi')}

    async def out(self, t):
        await self.sess.out(t)

    def ifname(self):
        return (self.rt.node(self.nid).get('ifaces') or ['FastEthernet0'])[0]

    async def run(self, raw):
        line = raw.strip()
        if not line:
            return
        self.history.append(line)
        p = line.split()
        c = p[0].lower()
        a = p[1:]
        s = self.s
        if c in ('?', 'help'):
            return await self.out(PC_HELP)
        if c == 'cls':
            return await self.sess.clear()
        if c == 'hostname':
            if a:
                s['hostname'] = a[0]
                self.rt.mark_dirty()
            return await self.out(s.get('hostname', '') + '\n')
        if c == 'ipconfig':
            if not a:
                return await self.out(self.ipconfig(False))
            o = a[0].lower()
            if o == '/all':
                return await self.out(self.ipconfig(True))
            if o == '/renew':
                return await self.dhcp()
            if o == '/release':
                s['ip'] = s['mask'] = s['gw'] = ''
                self.rt.mark_dirty()
                return await self.out('\n   IP Address......................: 0.0.0.0\n   Subnet Mask.....................: 0.0.0.0\n'
                                      '   Default Gateway.................: 0.0.0.0\n   DNS Server......................: 0.0.0.0\n\n')
            if len(a) >= 2 and valid_ip(a[0]) and valid_mask(a[1]):
                return await self.set_ip(a[0], a[1], a[2] if len(a) > 2 else '')
            return await self.out('Invalid Command.\n')
        if c == 'dhcp' or (c == 'ip' and a and a[0].lower() == 'dhcp'):
            return await self.dhcp()
        if c == 'ip':
            if not a:
                return await self.out('Invalid Command.\n')
            if a[0].lower() == 'dns' and len(a) > 1 and valid_ip(a[1]):
                s['dns'] = a[1]
                self.rt.mark_dirty()
                return
            if '/' in a[0]:
                ip, ln = a[0].split('/', 1)
                if not valid_ip(ip) or not ln.isdigit():
                    return await self.out('Invalid address\n')
                return await self.set_ip(ip, len_mask(int(ln)), a[1] if len(a) > 1 else '')
            if len(a) >= 2 and valid_ip(a[0]) and valid_mask(a[1]):
                return await self.set_ip(a[0], a[1], a[2] if len(a) > 2 else '')
            if valid_ip(a[0]):
                return await self.set_ip(a[0], '255.255.255.0', a[1] if len(a) > 1 else '')
            return await self.out('Invalid Command.\n')
        if c == 'show' and a and a[0].lower() == 'ip':
            return await self.out(self.ipconfig(True))
        if c == 'arp':
            if a and a[0] == '-d':
                self.rt.arp.pop(self.nid, None)
                return
            return await self.out(self.arp())
        if c == 'ping':
            return await self.ping(a)
        if c in ('tracert', 'trace', 'traceroute'):
            return await self.tracert(a)
        if c == 'nslookup':
            if not a:
                return await self.out('Invalid Command.\n')
            net = self.rt.net()
            ip, st = net.dns_resolve(self.nid, a[0])
            server = s.get('dns') or '0.0.0.0'
            await self.out(f'\nServer: [{server}]\nAddress:  {server}\n\n')
            if ip:
                return await self.out(f'Non-authoritative answer:\nName:   {a[0]}\nAddress:  {ip}\n')
            return await self.out('DNS request timed out.\n    timeout was 15000 milli seconds.\n' if st != 'nx'
                                  else f'*** UnKnown can\'t find {a[0]}: Non-existent domain\n')
        if c == 'netstat':
            return await self.out('\nActive Connections\n\n  Proto  Local Address          Foreign Address        State\n')
        if c in ('telnet', 'ssh'):
            user = None
            if c == 'ssh':
                if len(a) < 3 or a[0] != '-l':
                    return await self.out('Usage: ssh -l <user> <ip>\n')
                user, dst = a[1], a[2]
            else:
                if not a:
                    return await self.out('Usage: telnet <ip>\n')
                dst = a[0]
            if not valid_ip(dst):
                ip, _ = self.rt.net().dns_resolve(self.nid, dst)
                if not ip:
                    return await self.out(f'Unable to resolve {dst}\n')
                dst = ip
            await self.out(f'Trying {dst} ...')
            return await self.sess.connect(self, dst, c, user)
        if c in ('curl', 'browser', 'http', 'wget'):
            return await self.http_get(a, render=(c == 'browser'))
        if c == 'wifi':
            return await self.wifi(a)
        if c == 'script':
            names = sorted(s.get('scripts', {}))
            return await self.out(('Script tersimpan:\n' + ''.join(f'  {n}\n' for n in names)) if names
                                  else 'Belum ada script. Buat lewat panel kanan editor (bagian Script).\n')
        if c == 'run':
            if not a:
                return await self.out('Pakai: run <nama-script>\n')
            txt = s.get('scripts', {}).get(a[0])
            if txt is None:
                return await self.out(f'Script "{a[0]}" tidak ditemukan. Ketik: script\n')
            return await self.run_script(txt)
        if c == 'echo':
            return await self.out(line[4:].strip() + '\n')
        await self.out('Invalid Command.\n')

    # ---------------------------------------------------------------- wifi / http
    async def wifi(self, a):
        s = self.s
        if 'wifi' not in s:
            return await self.out('Perangkat ini tidak memiliki kartu wireless.\n')
        if not a:
            w = s['wifi']
            net = self.rt.net()
            ok = net.link_up(self.nid, self.ifname())
            return await self.out(f"SSID: {w.get('ssid') or '-'}\nStatus: {'Terhubung' if ok else 'Tidak terhubung'}\n")
        s['wifi'] = {'ssid': a[0], 'key': a[1] if len(a) > 1 else ''}
        self.rt.mark_dirty()
        await self.out(f'Menghubungkan ke "{a[0]}" ...\n')
        await asyncio.sleep(0.5)
        ok = self.rt.net().link_up(self.nid, self.ifname())
        await self.out('Terhubung.\n' if ok else 'Gagal: SSID/password salah atau belum ada link ke Access Point.\n')
        if ok and s.get('dhcp') and not s.get('ip'):
            await self.dhcp()

    async def http_get(self, a, render=False):
        if not a:
            return await self.out('Pakai: curl http://<ip>/\n')
        url = a[0]
        m = re.match(r'^(?:https?://)?([^/:]+)(?::(\d+))?(/.*)?$', url)
        if not m:
            return await self.out('URL tidak valid\n')
        host, port = m.group(1), int(m.group(2) or 80)
        dst = await self.resolve(host)
        if not dst:
            return
        net = self.rt.net()
        res = net.ping(self.nid, dst, 'tcp', port)
        if not res['ok']:
            await asyncio.sleep(1)
            return await self.out(f'curl: (28) Connection timed out to {host} port {port}\n')
        tgt = res['dst_node']
        node = self.rt.node(tgt)
        http = self.rt.state(tgt).get('services', {}).get('http', {}) if node['type'] == 'server' else {}
        if not http.get('enabled') or port != 80:
            return await self.out(f'curl: (7) Failed to connect to {host} port {port}: Connection refused\n')
        page = http.get('index', '')
        if render:
            txt = re.sub(r'<(br|/p|/h\d|/li|/tr|/div)[^>]*>', '\n', page, flags=re.I)
            txt = re.sub(r'<[^>]+>', '', txt)
            txt = re.sub(r'\n\s*\n+', '\n\n', txt).strip()
            return await self.out(f'--- http://{host}/ ---\n{txt}\n------------------------\n')
        await self.out(f'HTTP/1.1 200 OK\nServer: NexLab-HTTP\nContent-Length: {len(page)}\n\n{page}\n')

    # ---------------------------------------------------------------- scripting
    def parse_script(self, text):
        root = []
        stack, blocks = [root], []
        for no, raw in enumerate(text.replace('\r', '').split('\n'), 1):
            l = raw.strip()
            if not l or l.startswith('#') or l.lower().startswith('rem '):
                continue
            low = l.lower()
            parts = l.split()
            if low.startswith('repeat '):
                node = {'k': 'repeat', 'n': parts[1] if len(parts) > 1 else '1', 'body': []}
                stack[-1].append(node); stack.append(node['body']); blocks.append(node)
            elif low.startswith(('if ping ', 'if reach ', 'ifnot ping ')):
                node = {'k': 'if', 'neg': low.startswith('ifnot'), 'target': parts[2] if len(parts) > 2 else '',
                        'body': [], 'else': []}
                stack[-1].append(node); stack.append(node['body']); blocks.append(node)
            elif low == 'else':
                if not blocks or blocks[-1]['k'] != 'if':
                    raise ValueError(f'baris {no}: else tanpa if')
                stack.pop(); stack.append(blocks[-1]['else'])
            elif low == 'end':
                if not blocks:
                    raise ValueError(f'baris {no}: end tanpa repeat/if')
                stack.pop(); blocks.pop()
            else:
                stack[-1].append({'k': 'cmd', 'l': l, 'no': no})
        if blocks:
            raise ValueError('ada blok repeat/if yang belum ditutup dengan end')
        return root

    def subst(self, text):
        return re.sub(r'\$\{(\w+)\}', lambda m: str(self.vars.get(m.group(1), '')), text)

    async def run_script(self, text):
        try:
            tree = self.parse_script(text)
        except ValueError as e:
            return await self.out(f'Script error: {e}\n')
        self.vars = {'HOST': self.s.get('hostname', ''), 'IP': self.s.get('ip', '')}
        self.steps = 0
        await self.out(f'[script dimulai pada {self.s.get("hostname")}]\n')
        try:
            await self.exec_block(tree)
        except StopScript:
            pass
        await self.out('[script selesai]\n')

    async def exec_block(self, block):
        for node in block:
            self.steps += 1
            if self.steps > 500:
                await self.out('[script dihentikan: lebih dari 500 langkah]\n')
                raise StopScript()
            if node['k'] == 'repeat':
                n = self.subst(node['n'])
                n = min(int(n) if n.isdigit() else 1, 100)
                for i in range(1, n + 1):
                    self.vars['i'] = i
                    await self.exec_block(node['body'])
            elif node['k'] == 'if':
                tgt = self.subst(node['target'])
                ok = valid_ip(tgt) and self.rt.net().ping(self.nid, tgt)['ok']
                await self.exec_block(node['body'] if ok != node['neg'] else node['else'])
            else:
                line = self.subst(node['l'])
                p = line.split()
                c = p[0].lower()
                if c == 'set' and len(p) >= 2:
                    self.vars[p[1]] = ' '.join(p[2:])
                elif c == 'echo':
                    await self.out(line[4:].strip() + '\n')
                elif c in ('sleep', 'wait'):
                    sec = float(p[1]) if len(p) > 1 and p[1].replace('.', '', 1).isdigit() else 1
                    await asyncio.sleep(min(sec, 10))
                elif c in ('telnet', 'ssh', 'run'):
                    await self.out(f'[{c} tidak bisa dipakai di dalam script]\n')
                else:
                    await self.out(f'{self.prompt()}{line}\n')
                    await self.run(line)

    async def set_ip(self, ip, mask, gw):
        s = self.s
        if gw and not valid_ip(gw):
            return await self.out('Invalid gateway\n')
        s.update(ip=ip, mask=mask, gw=gw, dhcp=False)
        self.rt.mark_dirty()
        await self.out(f'Checking for duplicate address...\n')
        await asyncio.sleep(0.2)
        net = self.rt.net()
        dup = [e for e in net.eps() if e['ip'] == ip and e['nid'] != self.nid]
        if dup:
            await self.out(f'Duplicate IP address {ip} detected!\n')
        await self.out(f'PC : {ip} {mask}' + (f' gateway {gw}' if gw else '') + '\n')

    async def dhcp(self):
        s = self.s
        await self.out('DHCP request sent...  ')
        await asyncio.sleep(0.6)
        s['dhcp'] = True
        net = self.rt.net()
        res = net.dhcp_offer(self.nid)
        if res:
            s.update(ip=res['ip'], mask=res['mask'], gw=res['gw'], dns=res['dns'])
            self.rt.mark_dirty()
            await self.out(f"DORA IP {res['ip']}/{mask_len(res['mask'])} GW {res['gw'] or '0.0.0.0'}\n")
            return await self.out(self.ipconfig(False))
        s.update(ip='', mask='', gw='')
        self.rt.mark_dirty()
        await self.out('\nDHCP request failed. (No DHCP server answered)\n'
                       '   IP Address......................: 169.254.0.0  (APIPA)\n')

    def ipconfig(self, full):
        s = self.s
        mac = mac_for(self.nid, self.ifname())
        o = f"\n{self.ifname()} Connection:(default port)\n\n   Connection-specific DNS Suffix..: \n"
        if full:
            o += f"   Physical Address................: {mac.upper()}\n   DHCP Enabled....................: {'Yes' if s.get('dhcp') else 'No'}\n"
        o += f"   Link-local IPv6 Address.........: FE80::{mac[5:9]}:{mac[10:]}\n"
        o += f"   IPv4 Address....................: {s.get('ip') or '0.0.0.0'}\n"
        o += f"   Subnet Mask.....................: {s.get('mask') or '0.0.0.0'}\n"
        o += f"   Default Gateway.................: {s.get('gw') or '0.0.0.0'}\n"
        if full:
            o += f"   DNS Servers.....................: {s.get('dns') or '0.0.0.0'}\n"
        return o + '\n'

    def arp(self):
        net = self.rt.net()
        rows = []
        for ip, ts in self.rt.arp.get(self.nid, {}).items():
            ep = next((e for e in net.eps() if e['ip'] == ip), None)
            if ep:
                rows.append((ip, mac_dash(mac_for(ep['nid'], ep['ifn'])).lower()))
        if not rows:
            return 'No ARP Entries Found\n'
        o = f"  Internet Address      Physical Address      Type\n"
        for ip, mac in rows:
            o += f"  {ip.ljust(22)}{mac.ljust(22)}dynamic\n"
        return o

    async def resolve(self, target):
        if valid_ip(target):
            return target
        ip, st = self.rt.net().dns_resolve(self.nid, target)
        if not ip:
            await self.out(f'Ping request could not find host {target}. Please check the name and try again.\n')
        return ip

    async def ping(self, a):
        if not a:
            return await self.out('Invalid Command.\n')
        count = 4
        target = None
        i = 0
        while i < len(a):
            if a[i] == '-n' and i + 1 < len(a) and a[i + 1].isdigit():
                count = min(int(a[i + 1]), 100)
                i += 2
                continue
            if a[i] == '-t':
                count = 20
                i += 1
                continue
            target = a[i]
            i += 1
        if not target:
            return await self.out('Invalid Command.\n')
        dst = await self.resolve(target)
        if not dst:
            return
        net = self.rt.net()
        res = net.ping(self.nid, dst)
        await self.out(f'\nPinging {dst} with 32 bytes of data:\n\n')
        ok = 0
        lose_first = False
        if res['ok']:
            cache = self.rt.arp
            now = time.time()
            for (n, ip) in res['arps']:
                c = cache.setdefault(n, {})
                if ip not in c or now - c[ip] > 240:
                    lose_first = True
                c[ip] = now
        hops = len(res.get('hops', []))
        dnode = res.get('dst_node')
        ttl_base = 255 if dnode is not None and self.rt.node(dnode)['type'] in ROUTER | SWITCH else 128
        unreach_ip = None
        if not res['ok'] and res.get('why') in ('unreachable', 'noarp') and res.get('at') != self.nid and res.get('hops'):
            unreach_ip = res['hops'][-1]['ip']
        for n in range(count):
            if res['ok'] and not (n == 0 and lose_first):
                ok += 1
                await asyncio.sleep(0.25)
                ms = '<1ms' if hops <= 1 else f'={hops - 1}ms'
                await self.out(f'Reply from {dst}: bytes=32 time{ms} TTL={ttl_base - max(0, hops - 1)}\n')
            elif unreach_ip:
                await asyncio.sleep(0.3)
                await self.out(f'Reply from {unreach_ip}: Destination host unreachable.\n')
            else:
                await asyncio.sleep(0.9)
                await self.out('Request timed out.\n')
        lost = count - ok
        await self.out(f'\nPing statistics for {dst}:\n    Packets: Sent = {count}, Received = {ok}, Lost = {lost} '
                       f'({lost * 100 // count}% loss),\n')
        if ok:
            await self.out(f'Approximate round trip times in milli-seconds:\n    Minimum = 0ms, Maximum = {hops}ms, Average = {hops // 2}ms\n')

    async def tracert(self, a):
        if not a:
            return await self.out('Invalid Command.\n')
        dst = await self.resolve(a[0])
        if not dst:
            return
        await self.out(f'\nTracing route to {dst} over a maximum of 30 hops: \n\n')
        net = self.rt.net()
        f = net.forward(self.nid, dst)
        res = net.ping(self.nid, dst)
        n = 0
        for n, h in enumerate(f['hops'], 1):
            await asyncio.sleep(0.25)
            await self.out(f'  {str(n).ljust(3)} {"0 ms".ljust(9)} {"0 ms".ljust(9)} {"1 ms".ljust(9)} {h["ip"]}\n')
        if not res['ok']:
            for k in range(3):
                await asyncio.sleep(0.8)
                await self.out(f'  {str(n + 1 + k).ljust(3)} {"*".ljust(9)} {"*".ljust(9)} {"*".ljust(9)} Request timed out.\n')
        else:
            await self.out('\nTrace complete.\n')
