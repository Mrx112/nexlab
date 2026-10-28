"""Claude CLI integration: build or extend labs from a prompt, and answer questions about a lab.

Uses the `claude` CLI installed on the server PC and whatever account it is logged in with
(`claude auth status`), so NexLab never stores an API key.
"""
import asyncio
import copy
import json
import os
import re
import shutil
import tempfile
import time

from .templates import TEMPLATES, PROP_DEFAULTS, node_ifaces
from .runtime import ConsoleSession, kind_of
from .net import HOST
from .state import running_config, valid_ip, valid_mask

_status_cache = {'t': 0, 'v': None}
_login_proc = {'p': None, 'out': ''}
_lock = asyncio.Lock()
SYSTEM_SHORT = 'You are the NexLab network lab generator. Follow the instructions in the user message exactly.'
MODELS = ('', 'sonnet', 'opus', 'haiku')


def find_cli():
    exe = os.environ.get('NEXLAB_CLAUDE') or shutil.which('claude')
    if not exe and os.name == 'nt':
        cand = os.path.join(os.environ.get('APPDATA', ''), 'npm', 'claude.cmd')
        exe = cand if os.path.exists(cand) else None
    return exe


async def _run(args, stdin_text=None, timeout=60, cwd=None):
    proc = await asyncio.create_subprocess_exec(
        *args, stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd)
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin_text.encode('utf-8') if stdin_text is not None else None), timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise
    return proc.returncode, out.decode('utf-8', 'replace'), err.decode('utf-8', 'replace')


async def status(force=False):
    if not force and _status_cache['v'] and time.time() - _status_cache['t'] < 30:
        return _status_cache['v']
    exe = find_cli()
    st = {'installed': bool(exe), 'path': exe or '', 'version': '', 'loggedIn': False, 'authMethod': '', 'subscription': '',
          'email': '', 'configDir': '', 'error': '', 'user': os.environ.get('USERNAME') or os.environ.get('USER') or ''}
    if exe:
        try:
            _, out, _ = await _run([exe, '--version'], timeout=20)
            st['version'] = out.strip().splitlines()[0] if out.strip() else ''
            code, out, err = await _run([exe, 'auth', 'status', '--json'], timeout=20)
            try:
                j = json.loads(out)
                st.update(loggedIn=bool(j.get('loggedIn')), authMethod=j.get('authMethod') or '',
                          subscription=j.get('subscriptionType') or '', email=j.get('email') or '',
                          configDir=j.get('configDirectory') or '')
            except ValueError:
                st['error'] = (err or out).strip()[:300]
        except (OSError, asyncio.TimeoutError) as e:
            st['error'] = f'Gagal menjalankan Claude CLI: {e}'
    _status_cache.update(t=time.time(), v=st)
    return st


async def start_login():
    """Start `claude auth login` on the server PC (opens the browser there). Returns early output (may contain a URL)."""
    exe = find_cli()
    if not exe:
        return {'ok': False, 'output': 'Claude CLI tidak ditemukan di server.'}
    p = _login_proc['p']
    if p and p.returncode is None:
        return {'ok': True, 'output': _login_proc['out'] or 'Proses login sudah berjalan — selesaikan di browser server.'}
    proc = await asyncio.create_subprocess_exec(exe, 'auth', 'login', stdin=asyncio.subprocess.DEVNULL,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    _login_proc.update(p=proc, out='')

    async def pump():
        try:
            while True:
                line = await asyncio.wait_for(proc.stdout.readline(), 600)
                if not line:
                    break
                _login_proc['out'] = (_login_proc['out'] + line.decode('utf-8', 'replace'))[-4000:]
        except asyncio.TimeoutError:
            proc.kill()
        _status_cache['t'] = 0
    asyncio.ensure_future(pump())
    await asyncio.sleep(4)
    return {'ok': True, 'output': _login_proc['out'] or 'Login dimulai. Selesaikan proses di jendela browser pada komputer server.'}


async def ask_claude(prompt, model=''):
    exe = find_cli()
    if not exe:
        raise RuntimeError('Claude CLI tidak ditemukan di server. Pasang dengan: npm install -g @anthropic-ai/claude-code')
    args = [exe, '-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config',
            '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch', '--system-prompt', SYSTEM_SHORT]
    if model in MODELS and model:
        args += ['--model', model]
    work = tempfile.mkdtemp(prefix='nexlab-ai-')
    async with _lock:
        try:
            code, out, err = await _run(args, stdin_text=prompt, timeout=420, cwd=work)
        except asyncio.TimeoutError:
            raise RuntimeError('Claude tidak menjawab dalam 7 menit.')
        finally:
            shutil.rmtree(work, ignore_errors=True)
    try:
        j = json.loads(out)
    except ValueError:
        msg = (err or out).strip()
        if 'login' in msg.lower() or 'auth' in msg.lower():
            msg = 'Claude CLI belum login. ' + msg
        raise RuntimeError(msg[:500] or f'Claude CLI keluar dengan kode {code}')
    if j.get('is_error'):
        raise RuntimeError(str(j.get('result') or 'Claude CLI mengembalikan error')[:500])
    return str(j.get('result') or ''), {'cost': j.get('total_cost_usd'), 'ms': j.get('duration_ms')}


def extract_json(text):
    m = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.S)
    raw = m.group(1) if m else text[text.find('{'): text.rfind('}') + 1]
    try:
        return json.loads(raw)
    except ValueError:
        raise RuntimeError('Jawaban Claude bukan JSON yang valid. Coba ulangi atau perjelas prompt.')


# ------------------------------------------------------------------ prompt building
def _catalog_text():
    lines = []
    for t, v in TEMPLATES.items():
        if v['kind'] == 'real':
            continue
        ifs = v['ifaces'] or []
        lines.append(f"- {t}: {v['label']} ({v['model']}), cli={v['cli'] or 'none'}, ports: {_compact(ifs)}. {v['desc']}")
    return '\n'.join(lines)


def _compact(ifs):
    groups, out = {}, []
    for i in ifs:
        m = re.match(r'^(.*?)(\d+)$', i)
        if m:
            groups.setdefault(m.group(1), []).append(int(m.group(2)))
        else:
            out.append(i)
    for p, nums in groups.items():
        out.append(f'{p}{min(nums)}..{p}{max(nums)}' if len(nums) > 1 else f'{p}{nums[0]}')
    return ', '.join(out)


RULES = """Kamu adalah generator lab untuk NexLab, emulator jaringan berbasis browser (mirip PNETLab + Cisco Packet Tracer).
Tugas: ubah permintaan pengguna menjadi topologi + konfigurasi yang LANGSUNG BISA DIJALANKAN di simulator NexLab.

## Tipe perangkat yang tersedia (pakai kolom "type" persis seperti ini)
{catalog}

## Kemampuan CLI simulator IOS (router, firewall, switch, l3switch, olt)
hostname, enable secret, banner motd, service password-encryption, interface X / interface range, ip address A M, no shutdown,
description, sub-interface + encapsulation dot1Q N, switchport mode access|trunk, switchport access vlan N, switchport trunk allowed vlan,
switchport trunk native vlan, vlan N / name, ip routing (l3switch), no switchport (l3switch), interface VlanN (SVI), ip default-gateway,
ip route, router ospf N / network A W area N / passive-interface, router rip / version 2 / network, ip dhcp pool / network / default-router /
dns-server, ip dhcp excluded-address, ip helper-address, access-list 1-199 (standard/extended), ip access-list extended NAME,
ip access-group N in|out, line console 0 / line vty 0 4 / password / login [local], username U privilege 15 secret P,
ip domain-name, crypto key generate rsa, interface loopback N. JANGAN memakai perintah di luar daftar ini (NAT/BGP/EIGRP/HSRP/STP tuning tidak didukung).

## Perangkat akhir (pc, laptop, server, printer, ipphone, cctv, smartphone, tablet, iot)
Atur IP lewat field "host" (bukan CLI): {{"ip":"192.168.1.10","mask":"255.255.255.0","gw":"192.168.1.1","dns":"8.8.8.8"}} atau {{"dhcp":true}}.
Server bisa punya "services": {{"dhcp":{{"enabled":true,"start":"192.168.1.100","max":50,"gw":"192.168.1.1","dns":"192.168.1.2"}},
"dns":{{"enabled":true,"records":{{"web.lab":"192.168.1.2"}}}},"http":{{"enabled":true,"index":"<h1>Halo</h1>"}}}}.
Klien wireless (smartphone/tablet/iot/laptop Wireless0) dikabel ke port WirelessN milik "ap" dan diberi "wifi":{{"ssid":"..","key":".."}} yang sama dengan props AP.
Access point: "props":{{"ssid":"..","key":"..","security":"WPA2-PSK"}}.

## Aturan
- Nama node unik (maks 20 karakter, tanpa spasi), dipakai sebagai referensi di links/configs.
- Nama port HARUS nama lengkap persis dari daftar (mis. "GigabitEthernet0/0", "FastEthernet0/1"), satu port hanya untuk satu kabel.
- Koordinat: x 0..1400, y 0..900, jarak antar node minimal 140; susun bertingkat (internet/core di atas, akses di tengah, perangkat akhir di bawah).
- "configs": baris konfigurasi mode global (setelah "configure terminal"), JANGAN sertakan enable/configure terminal/end/write — NexLab menambahkannya.
- Setiap interface yang dipakai harus "no shutdown". Pastikan routing lengkap supaya semua ping yang diminta berhasil.
- "workbook": instruksi/penjelasan lab berbahasa Indonesia (markdown sederhana: # judul, - poin, `kode`) + "checks" untuk menilai lab.
  Tipe check: {{"type":"ping","src":"PC1","dst":"PC2"}} (dst boleh nama node atau IP), {{"type":"config","node":"R1","contains":"router ospf 1"}}, {{"type":"running","node":"R1"}}, {{"type":"link","a":"R1","b":"SW1"}}.
- "summary": ringkasan 1-3 kalimat bahasa Indonesia tentang apa yang dibuat.

## Format jawaban
Balas HANYA satu objek JSON (tanpa teks lain, tanpa markdown fence) dengan bentuk:
{{"name":"..","description":"..","nodes":[{{"name":"R1","type":"router","x":400,"y":120,"props":{{}},"host":{{}},"services":{{}},"wifi":{{}}}}],
"links":[{{"a":"R1","a_if":"GigabitEthernet0/0","b":"SW1","b_if":"GigabitEthernet0/1","style":"copper"}}],
"configs":{{"R1":["hostname R1","interface GigabitEthernet0/0"," ip address 192.168.1.1 255.255.255.0"," no shutdown"]}},
"remove":[],"notes":[{{"x":40,"y":20,"text":".."}}],
"workbook":{{"title":"..","text":"..","checks":[]}},"summary":".."}}
Field opsional boleh dihilangkan."""


def lab_context(rt):
    lines = []
    for n in rt.lab['nodes']:
        extra = ''
        if n['type'] in HOST:
            st = n.get('state') or {}
            extra = f" ip={st.get('ip') or ('dhcp' if st.get('dhcp') else '-')}/{st.get('mask') or ''} gw={st.get('gw') or '-'}"
        lines.append(f"- {n['name']} type={n['type']} x={round(n.get('x', 0))} y={round(n.get('y', 0))}{extra} power={'on' if rt.is_running(n['id']) else 'off'}")
    links = []
    for l in rt.lab['links']:
        a, b = rt.by_id[l['a']['node']], rt.by_id[l['b']['node']]
        links.append(f"- {a['name']} {l['a']['iface']} <-> {b['name']} {l['b']['iface']}")
    cfgs = []
    for n in rt.lab['nodes']:
        if TEMPLATES[n['type']]['cli'] == 'ios' and n.get('state'):
            txt = running_config(n['type'], n['state'])
            cfgs.append(f"### {n['name']}\n{txt[:2500]}")
    return ('Node:\n' + ('\n'.join(lines) or '(kosong)') + '\n\nKabel:\n' + ('\n'.join(links) or '(kosong)') +
            '\n\nRunning-config:\n' + ('\n\n'.join(cfgs) or '(tidak ada)'))


def build_prompt(user_prompt, rt, mode):
    p = RULES.format(catalog=_catalog_text())
    if mode == 'extend' and rt.lab['nodes']:
        p += ('\n\n## Lab saat ini (mode UBAH/TAMBAH)\nNode yang sudah ada dirujuk dengan namanya. Cantumkan di "nodes" hanya node BARU atau node '
              'yang posisinya/propsnya diubah. "links" hanya kabel baru. "configs" hanya baris tambahan. Node yang harus dihapus masukkan ke "remove".\n'
              + lab_context(rt))
    else:
        p += '\n\n## Mode: BUAT LAB BARU (lab kosong).'
    return p + '\n\n## Permintaan pengguna\n' + user_prompt.strip()


def build_ask_prompt(question, rt):
    return ('Kamu asisten jaringan untuk NexLab (emulator mirip Packet Tracer/PNETLab). Jawab dalam bahasa Indonesia, ringkas dan praktis, '
            'pakai markdown sederhana. Jika memberi perintah, tulis perintah CLI IOS persis. Fokus pada lab berikut.\n\n'
            + lab_context(rt) + '\n\n## Pertanyaan\n' + question.strip())


# ------------------------------------------------------------------ applying a plan
async def run_lines(rt, nid, lines, per_line=20):
    """Feed lines to a simulated device as if typed in its console (privileged mode). Returns (output, rejected_lines)."""
    buf, bad = [], []

    async def send(m):
        if m.get('t') in ('out', 'log', 'help'):
            buf.append(m.get('d') or '')
    sess = ConsoleSession(rt, nid, send)
    cli = sess.make_cli(nid)
    sess.stack = [cli]
    if cli.kind == 'ios':
        cli.mode = 'priv'
    try:
        for ln in lines:
            if not sess.stack:
                break
            k = len(buf)
            try:
                await asyncio.wait_for(sess.handle({'t': 'line', 'd': str(ln)[:300]}), per_line)
            except asyncio.TimeoutError:
                bad.append(str(ln).strip())
                continue
            chunk = ''.join(buf[k:])
            if re.search(r'% ?(Invalid|Incomplete|Unknown|Ambiguous|Unrecognized)', chunk):
                bad.append(str(ln).strip())
    finally:
        sess.close()
    return ''.join(buf).replace('\r\n', '\n'), bad


def _clean_name(s):
    return re.sub(r'[^A-Za-z0-9_.\-]', '', str(s or ''))[:20]


def _apply_host(n, st, host, services, wifi):
    if isinstance(host, dict):
        if host.get('dhcp'):
            st.update(dhcp=True, ip='', mask='', gw='')
        else:
            ip, mask, gw, dns = (str(host.get(k) or '').strip() for k in ('ip', 'mask', 'gw', 'dns'))
            if ip and valid_ip(ip) and (not mask or valid_mask(mask)):
                st.update(dhcp=False, ip=ip, mask=mask or '255.255.255.0', gw=gw if valid_ip(gw) else '', dns=dns if valid_ip(dns) else '')
    if n['type'] == 'server' and isinstance(services, dict):
        cur = st.setdefault('services', {})
        if isinstance(services.get('dhcp'), dict):
            cur['dhcp'] = {k: services['dhcp'].get(k, '') for k in ('enabled', 'start', 'max', 'gw', 'dns')}
        if isinstance(services.get('dns'), dict):
            recs = services['dns'].get('records') or {}
            cur['dns'] = {'enabled': bool(services['dns'].get('enabled', True)),
                          'records': {str(k)[:60]: str(v) for k, v in recs.items() if valid_ip(str(v))}}
        if isinstance(services.get('http'), dict):
            cur['http'] = {'enabled': bool(services['http'].get('enabled', True)), 'index': str(services['http'].get('index', ''))[:50000]}
    if isinstance(wifi, dict) and 'wifi' in st:
        st['wifi'] = {'ssid': str(wifi.get('ssid', ''))[:32], 'key': str(wifi.get('key', ''))[:63]}


def sanitize_workbook(wb):
    if not isinstance(wb, dict):
        return None
    checks = []
    for c in (wb.get('checks') or [])[:50]:
        if isinstance(c, dict) and c.get('type') in ('ping', 'config', 'running', 'link'):
            checks.append({k: str(v)[:200] for k, v in c.items() if k in ('type', 'src', 'dst', 'node', 'contains', 'a', 'b', 'label')})
    return {'title': str(wb.get('title') or '')[:120], 'text': str(wb.get('text') or '')[:50000], 'checks': checks}


async def apply_plan(rt, plan, mode, user):
    warnings = []
    if not isinstance(plan, dict):
        raise RuntimeError('Rencana dari Claude tidak valid')
    if mode == 'replace':
        nodes, links, notes = [], [], []
    else:
        nodes = [{k: n.get(k) for k in ('id', 'type', 'name', 'x', 'y', 'props', 'size', 'lpos')} for n in rt.lab['nodes']]
        links = copy.deepcopy(rt.lab['links'])
        notes = copy.deepcopy(rt.lab.get('notes') or [])
    by_name = {n['name']: n for n in nodes}
    for rm in plan.get('remove') or []:
        n = by_name.pop(str(rm), None)
        if n:
            nodes.remove(n)
            links = [l for l in links if n['id'] not in (l['a']['node'], l['b']['node'])]
    next_id = max([n['id'] for n in nodes] + [n['id'] for n in rt.lab['nodes']] + [0]) + 1
    extras = {}
    for i, pn in enumerate((plan.get('nodes') or [])[:80]):
        if not isinstance(pn, dict):
            continue
        name, t = _clean_name(pn.get('name')), pn.get('type')
        if not name:
            continue
        cur = by_name.get(name)
        if cur is None:
            if t not in TEMPLATES or TEMPLATES[t]['kind'] == 'real':
                warnings.append(f'Node {name}: tipe "{t}" tidak tersedia, dilewati')
                continue
            cur = {'id': next_id, 'type': t, 'name': name, 'x': 200 + (i % 6) * 160, 'y': 120 + (i // 6) * 150, 'props': {}}
            next_id += 1
            nodes.append(cur)
            by_name[name] = cur
        for k in ('x', 'y'):
            try:
                if pn.get(k) is not None:
                    cur[k] = max(-3000, min(5000, float(pn[k])))
            except (TypeError, ValueError):
                pass
        if isinstance(pn.get('props'), dict):
            cur['props'] = dict(cur.get('props') or {}, **{k: v for k, v in pn['props'].items() if k in PROP_DEFAULTS.get(cur['type'], {})})
        extras[name] = (pn.get('host'), pn.get('services'), pn.get('wifi'))
    used = {(l['a']['node'], l['a']['iface']) for l in links} | {(l['b']['node'], l['b']['iface']) for l in links}
    for j, pl in enumerate((plan.get('links') or [])[:200]):
        if not isinstance(pl, dict):
            continue
        a, b = by_name.get(_clean_name(pl.get('a'))), by_name.get(_clean_name(pl.get('b')))
        ai, bi = str(pl.get('a_if') or ''), str(pl.get('b_if') or '')
        if not a or not b:
            warnings.append(f'Kabel {pl.get("a")}–{pl.get("b")}: node tidak ditemukan')
            continue
        ia, ib = node_ifaces(a['type'], a.get('props') or {}), node_ifaces(b['type'], b.get('props') or {})
        if ai not in ia or bi not in ib:
            warnings.append(f'Kabel {a["name"]} {ai} – {b["name"]} {bi}: nama port tidak valid')
            continue
        if (a['id'], ai) in used or (b['id'], bi) in used:
            warnings.append(f'Kabel {a["name"]} {ai} – {b["name"]} {bi}: port sudah terpakai')
            continue
        used |= {(a['id'], ai), (b['id'], bi)}
        links.append({'id': f'AI{int(time.time())}{j}', 'a': {'node': a['id'], 'iface': ai}, 'b': {'node': b['id'], 'iface': bi},
                      'style': 'fiber' if pl.get('style') == 'fiber' else 'copper'})
    nid0 = max([n.get('id', 0) for n in notes if isinstance(n, dict)] + [0])
    for k, pn in enumerate((plan.get('notes') or [])[:10]):
        if isinstance(pn, dict) and pn.get('text'):
            notes.append({'id': nid0 + k + 1, 'x': float(pn.get('x') or 40), 'y': float(pn.get('y') or 20), 'text': str(pn['text'])[:2000]})
    rt.update_topology(nodes, links, notes)
    # power on simulated devices, then configure
    for n in rt.lab['nodes']:
        if kind_of(n['type']) == 'sim' and (mode == 'replace' or n['name'] in extras or n['name'] in (plan.get('configs') or {})):
            await rt.start_node(n['id'], user)
    name_id = {n['name']: n['id'] for n in rt.lab['nodes']}
    for name, (host, services, wifi) in extras.items():
        nid = name_id.get(name)
        if nid and rt.by_id[nid]['type'] in HOST:
            _apply_host(rt.by_id[nid], rt.state(nid), host, services, wifi)
    configured = 0
    for name, lines in (plan.get('configs') or {}).items():
        nid = name_id.get(_clean_name(name))
        if not nid or TEMPLATES[rt.by_id[nid]['type']]['cli'] != 'ios' or not isinstance(lines, list):
            if lines:
                warnings.append(f'Config untuk {name} dilewati (node tidak ada / bukan perangkat IOS)')
            continue
        body = [str(x) for x in lines[:400] if str(x).strip().lower() not in ('enable', 'en', 'conf t', 'configure terminal', 'end', 'write', 'write memory', 'wr')]
        _, bad = await run_lines(rt, nid, ['configure terminal'] + body + ['end', 'write memory'])
        configured += 1
        warnings += [f'{name}: "{b}" ditolak simulator' for b in bad[:8]]
    wb = sanitize_workbook(plan.get('workbook'))
    if wb and (wb['text'] or wb['checks']):
        rt.lab['workbook'] = wb
    rt.mark_dirty()
    for nid in name_id.values():
        if rt.by_id[nid]['type'] in HOST and rt.is_running(nid):
            rt.dhcp_tick()
            break
    return {'nodes': len(rt.lab['nodes']), 'links': len(rt.lab['links']), 'configured': configured, 'warnings': warnings[:40],
            'summary': str(plan.get('summary') or '')[:1000], 'name': str(plan.get('name') or '')[:60],
            'description': str(plan.get('description') or '')[:300]}
