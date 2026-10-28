"""HTTP + WebSocket server (aiohttp)."""
import asyncio
import copy
import json
import os
import re
import sys
import time

from aiohttp import web, WSMsgType

from .db import DB, hash_pw, check_pw
from .runtime import RuntimeManager, ConsoleSession, kind_of
from .real import RealManager, remote_console
from .templates import catalog, TEMPLATES
from .demo import TEMPLATE_LABS
from .state import running_config
from .net import HOST, HUB
from . import sysinfo
from . import ai

BASE = getattr(sys, '_MEIPASS', None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(BASE, 'static')
COOKIE = 'nexlab_session'
VERSION = '1.2.0'

_fails = {}


def client_ip(req):
    return req.headers.get('X-Forwarded-For', req.remote or '').split(',')[0].strip()


def jerr(msg, status=400):
    return web.json_response({'error': msg}, status=status)


def pub_user(u):
    return {k: u[k] for k in ('id', 'username', 'fullname', 'role', 'created', 'last_login', 'active')}


@web.middleware
async def guard(req, handler):
    path = req.path
    if path.startswith('/api/'):
        if req.method in ('POST', 'PUT', 'DELETE') and req.headers.get('X-NexLab') != '1':
            return jerr('Missing CSRF header', 403)
        open_paths = ('/api/login', '/api/register', '/api/public')
        user = req.app['db'].session_user(req.cookies.get(COOKIE))
        req['user'] = user
        if path not in open_paths and not user:
            return jerr('Not logged in', 401)
        if path.startswith('/api/admin') and (not user or user['role'] != 'admin'):
            return jerr('Admin only', 403)
    resp = await handler(req)
    resp.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    return resp


# ------------------------------------------------------------------ auth
async def public(req):
    db = req.app['db']
    n = db.q('SELECT COUNT(*) c FROM users', one=True)['c']
    return web.json_response({'register': db.setting('allow_register', '1') == '1' or n == 0,
                              'first_user': n == 0, 'version': VERSION,
                              'title': db.setting('title', 'NexLab')})


async def register(req):
    db = req.app['db']
    d = await req.json()
    u = str(d.get('username', '')).strip().lower()
    pw = str(d.get('password', ''))
    full = str(d.get('fullname', '')).strip()[:60]
    n = db.q('SELECT COUNT(*) c FROM users', one=True)['c']
    if n and db.setting('allow_register', '1') != '1':
        return jerr('Registrasi dinonaktifkan oleh admin', 403)
    if not re.match(r'^[a-z0-9_.\-]{3,32}$', u):
        return jerr('Username 3-32 karakter (huruf kecil, angka, . _ -)')
    if len(pw) < 6:
        return jerr('Password minimal 6 karakter')
    if db.q('SELECT id FROM users WHERE username=?', (u,), one=True):
        return jerr('Username sudah dipakai')
    role = 'admin' if n == 0 else 'user'
    db.x('INSERT INTO users(username,fullname,pw,role,created) VALUES(?,?,?,?,?)', (u, full, hash_pw(pw), role, time.time()))
    return web.json_response({'ok': True, 'role': role})


async def login(req):
    db = req.app['db']
    ip = client_ip(req)
    f = _fails.get(ip, [0, 0])
    if f[0] >= 8 and time.time() - f[1] < 300:
        return jerr('Terlalu banyak percobaan. Coba lagi 5 menit lagi.', 429)
    d = await req.json()
    u = db.q('SELECT * FROM users WHERE username=?', (str(d.get('username', '')).strip().lower(),), one=True)
    if not u or not check_pw(str(d.get('password', '')), u['pw']):
        _fails[ip] = [f[0] + 1, time.time()]
        await asyncio.sleep(0.5)
        return jerr('Username atau password salah', 401)
    if not u['active']:
        return jerr('Akun dinonaktifkan', 403)
    _fails.pop(ip, None)
    tok = db.new_session(u['id'], ip, 30 if d.get('remember') else 1)
    db.x('UPDATE users SET last_login=? WHERE id=?', (time.time(), u['id']))
    resp = web.json_response({'ok': True, 'user': pub_user(u)})
    resp.set_cookie(COOKIE, tok, httponly=True, samesite='Lax', secure=req.secure,
                    max_age=(30 if d.get('remember') else 1) * 86400)
    return resp


async def logout(req):
    req.app['db'].x('DELETE FROM sessions WHERE token=?', (req.cookies.get(COOKIE),))
    resp = web.json_response({'ok': True})
    resp.del_cookie(COOKIE)
    return resp


async def me(req):
    return web.json_response({'user': pub_user(req['user'])})


async def change_password(req):
    db = req.app['db']
    d = await req.json()
    u = req['user']
    if not check_pw(str(d.get('old', '')), u['pw']):
        return jerr('Password lama salah')
    if len(str(d.get('new', ''))) < 6:
        return jerr('Password baru minimal 6 karakter')
    db.x('UPDATE users SET pw=? WHERE id=?', (hash_pw(d['new']), u['id']))
    return web.json_response({'ok': True})


# ------------------------------------------------------------------ admin
async def admin_users(req):
    rows = req.app['db'].q('SELECT * FROM users ORDER BY id')
    labs = {r['owner']: r['c'] for r in req.app['db'].q('SELECT owner, COUNT(*) c FROM labs GROUP BY owner')}
    return web.json_response({'users': [dict(pub_user(r), labs=labs.get(r['id'], 0)) for r in rows]})


async def admin_user_update(req):
    db = req.app['db']
    uid = int(req.match_info['uid'])
    d = await req.json()
    if uid == req['user']['id'] and (d.get('role') == 'user' or d.get('active') == 0):
        return jerr('Tidak bisa menurunkan/menonaktifkan akun sendiri')
    if 'role' in d and d['role'] in ('admin', 'user'):
        db.x('UPDATE users SET role=? WHERE id=?', (d['role'], uid))
    if 'active' in d:
        db.x('UPDATE users SET active=? WHERE id=?', (1 if d['active'] else 0, uid))
    if d.get('password'):
        if len(d['password']) < 6:
            return jerr('Password minimal 6 karakter')
        db.x('UPDATE users SET pw=? WHERE id=?', (hash_pw(d['password']), uid))
    return web.json_response({'ok': True})


async def admin_user_delete(req):
    uid = int(req.match_info['uid'])
    if uid == req['user']['id']:
        return jerr('Tidak bisa menghapus akun sendiri')
    db = req.app['db']
    db.x('DELETE FROM users WHERE id=?', (uid,))
    db.x('DELETE FROM sessions WHERE user_id=?', (uid,))
    return web.json_response({'ok': True})


async def admin_settings(req):
    db = req.app['db']
    if req.method == 'POST':
        d = await req.json()
        if 'allow_register' in d:
            db.set_setting('allow_register', '1' if d['allow_register'] else '0')
        if 'title' in d:
            db.set_setting('title', str(d['title'])[:30])
        if 'allow_ai_users' in d:
            db.set_setting('allow_ai_users', '1' if d['allow_ai_users'] else '0')
    return web.json_response({'allow_register': db.setting('allow_register', '1') == '1',
                              'allow_ai_users': db.setting('allow_ai_users', '0') == '1',
                              'title': db.setting('title', 'NexLab')})


# ------------------------------------------------------------------ system
def lan_addresses():
    return sysinfo.lan_addresses()


async def system(req):
    app = req.app
    total, avail = sysinfo.memory_mb()
    load = sysinfo.load_avg()
    rt_nodes = sum(1 for rt in app['mgr'].labs.values() for n in rt.lab['nodes'] if rt.is_running(n['id']))
    rss = sysinfo.process_rss_mb()
    return web.json_response({
        'os': sysinfo.os_label(), 'os_id': sysinfo.OS,
        'version': VERSION, 'uptime': int(time.time() - app['started']),
        'cpus': os.cpu_count(), 'load': load,
        'mem_total': total, 'mem_avail': avail,
        'app_rss_mb': rss, 'running_nodes': rt_nodes, 'port': app['port'],
        'addresses': lan_addresses(), 'caps': app['real'].caps(),
    })


async def templates(req):
    return web.json_response({'templates': catalog(),
                              'labs': [{'id': k, 'name': v[0]} for k, v in TEMPLATE_LABS.items()]})


# ------------------------------------------------------------------ labs
def lab_access(req, lab_id):
    row = req.app['db'].q('SELECT * FROM labs WHERE id=?', (lab_id,), one=True)
    if not row:
        raise web.HTTPNotFound(text='{"error":"Lab tidak ditemukan"}', content_type='application/json')
    u = req['user']
    if row['owner'] != u['id'] and u['role'] != 'admin':
        raise web.HTTPForbidden(text='{"error":"Bukan lab Anda"}', content_type='application/json')
    return row


async def labs_list(req):
    u = req['user']
    db = req.app['db']
    if u['role'] == 'admin' and req.query.get('all'):
        rows = db.q('SELECT l.*, u.username FROM labs l LEFT JOIN users u ON u.id=l.owner ORDER BY updated DESC')
    else:
        rows = db.q('SELECT l.*, u.username FROM labs l LEFT JOIN users u ON u.id=l.owner WHERE owner=? ORDER BY updated DESC', (u['id'],))
    req.app['mgr'].flush()
    out = []
    for r in rows:
        rt = req.app['mgr'].labs.get(r['id'])
        data = rt.lab if rt else json.loads(r['data'] or '{}')
        nodes = data.get('nodes', [])
        running = sum(1 for n in nodes if (rt.is_running(n['id']) if rt else n.get('power') == 'on') and n['type'] not in HUB)
        types = {}
        for n in nodes:
            types[n['type']] = types.get(n['type'], 0) + 1
        idx = {n['id']: i for i, n in enumerate(nodes)}
        thumb = {'n': [[round(n.get('x', 0)), round(n.get('y', 0)), n['type']] for n in nodes[:80]],
                 'l': [[idx[l['a']['node']], idx[l['b']['node']]] for l in data.get('links', [])
                       if l['a']['node'] in idx and l['b']['node'] in idx and idx[l['a']['node']] < 80 and idx[l['b']['node']] < 80]}
        out.append({'id': r['id'], 'name': r['name'], 'description': r['description'], 'owner': r['username'], 'thumb': thumb,
                    'created': r['created'], 'updated': r['updated'], 'nodes': len(nodes),
                    'links': len(data.get('links', [])), 'running': running, 'types': types})
    return web.json_response({'labs': out})


async def lab_create(req):
    d = await req.json()
    name = str(d.get('name') or 'Lab baru').strip()[:60]
    desc = str(d.get('description') or '')[:300]
    if d.get('data'):
        data = d['data']
        if not isinstance(data, dict) or not isinstance(data.get('nodes'), list):
            return jerr('File lab tidak valid')
    else:
        tpl = TEMPLATE_LABS.get(d.get('template') or 'blank', TEMPLATE_LABS['blank'])
        data = tpl[1]()
    now = time.time()
    lid = req.app['db'].x('INSERT INTO labs(owner,name,description,data,created,updated) VALUES(?,?,?,?,?,?)',
                          (req['user']['id'], name, desc, json.dumps({'nodes': [], 'links': []}), now, now))
    rt = req.app['mgr'].get(lid)
    for n in data.get('nodes', []):
        n.pop('power', None) if d.get('data') else None
    rt.update_topology(data.get('nodes', []), data.get('links', []), data.get('notes', []))
    if isinstance(data.get('map3d'), dict):
        rt.lab['map3d'] = data['map3d']
    # keep state/startup/power of template nodes
    for n in data.get('nodes', []):
        if int(n['id']) in rt.by_id:
            tgt = rt.by_id[int(n['id'])]
            if n.get('state'):
                tgt['state'] = n['state']
            if n.get('startup'):
                tgt['startup'] = n['startup']
            if n.get('power') == 'on' and kind_of(tgt['type']) == 'sim':
                tgt['power'] = 'on'
                rt.boot[tgt['id']] = time.time()
    req.app['mgr'].flush()
    return web.json_response({'id': lid})


async def lab_get(req):
    lid = int(req.match_info['lid'])
    row = lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    lab = rt.export()
    lab['configsets'] = [{'name': k, 'saved': v['saved'], 'nodes': len(v['nodes'])} for k, v in (lab.get('configsets') or {}).items()]
    for n in lab['nodes']:
        n.pop('startup', None)
        st = n.pop('state', None) or {}
        n['hostname'] = st.get('hostname')
        if n['type'] in HOST:
            n['host'] = {k: st.get(k) for k in ('ip', 'mask', 'gw', 'dns', 'dhcp', 'wifi', 'scripts')}
            if n['type'] == 'server':
                n['host']['services'] = st.get('services')
    return web.json_response({'id': lid, 'name': row['name'], 'description': row['description'], 'lab': lab,
                              'status': rt.status()})


async def lab_meta(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    d = await req.json()
    if 'name' in d:
        req.app['db'].x('UPDATE labs SET name=? WHERE id=?', (str(d['name'])[:60], lid))
    if 'description' in d:
        req.app['db'].x('UPDATE labs SET description=? WHERE id=?', (str(d['description'])[:300], lid))
    return web.json_response({'ok': True})


async def lab_topology(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    d = await req.json()
    rt = req.app['mgr'].get(lid)
    removed_real = [rt.by_id[n] for n in rt.by_id if n not in {int(x['id']) for x in d.get('nodes', [])}
                    and kind_of(rt.by_id[n]['type']) == 'real']
    for n in removed_real:
        await req.app['real'].stop(rt, n)
    rt.update_topology(d.get('nodes', []), d.get('links', []), d.get('notes'))
    await req.app['real'].sync_links(rt)
    return web.json_response({'ok': True, 'status': rt.status()})


async def lab_delete(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    if rt:
        await req.app['real'].stop_lab(rt)
    req.app['mgr'].drop(lid)
    req.app['db'].x('DELETE FROM labs WHERE id=?', (lid,))
    return web.json_response({'ok': True})


async def lab_export(req):
    lid = int(req.match_info['lid'])
    row = lab_access(req, lid)
    req.app['mgr'].flush()
    rt = req.app['mgr'].get(lid)
    data = rt.export()
    body = json.dumps({'nexlab': VERSION, 'name': row['name'], 'description': row['description'], 'data': data}, indent=1)
    fname = re.sub(r'[^A-Za-z0-9_\-]+', '_', row['name']) + '.nexlab.json'
    return web.Response(body=body, content_type='application/json',
                        headers={'Content-Disposition': f'attachment; filename="{fname}"'})


async def lab_status(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    return web.json_response(req.app['mgr'].get(lid).status())


async def lab_power(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    action = req.match_info['action']
    d = await req.json() if req.can_read_body else {}
    ids = d.get('nodes')
    targets = [int(i) for i in ids] if ids else [n['id'] for n in rt.lab['nodes']]
    errors = []
    for nid in targets:
        if nid not in rt.by_id:
            continue
        n = rt.by_id[nid]
        if kind_of(n['type']) in ('cloud', 'remote'):
            continue
        if action == 'start':
            ok, msg = await rt.start_node(nid, req['user'])
            if not ok:
                errors.append(f"{n['name']}: {msg}")
        elif action == 'stop':
            await rt.stop_node(nid)
        elif action == 'wipe':
            await rt.wipe_node(nid)
    req.app['mgr'].flush()
    return web.json_response({'ok': not errors, 'errors': errors, 'status': rt.status()})


async def node_config(req):
    lid = int(req.match_info['lid'])
    nid = int(req.match_info['nid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    n = rt.by_id.get(nid)
    if not n or kind_of(n['type']) != 'sim':
        return jerr('Node ini tidak punya konfigurasi simulasi')
    which = req.query.get('which', 'running')
    st = rt.state(nid) if which == 'running' else n.get('startup')
    if not st:
        return web.json_response({'text': '! startup-config kosong (gunakan "write memory")'})
    return web.json_response({'text': running_config(n['type'], st)})


async def node_host(req):
    """Set PC/Server IP config & services from the GUI (like Packet Tracer Desktop tab)."""
    from .state import valid_ip, valid_mask
    lid = int(req.match_info['lid'])
    nid = int(req.match_info['nid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    n = rt.by_id.get(nid)
    if not n or n['type'] not in HOST:
        return jerr('Bukan end device')
    d = await req.json()
    s = rt.state(nid)
    if 'hostname' in d and d['hostname']:
        s['hostname'] = str(d['hostname'])[:30]
    if d.get('dhcp'):
        s.update(dhcp=True, ip='', mask='', gw='')
        if rt.is_running(nid):
            res = rt.net().dhcp_offer(nid)
            if res:
                s.update(ip=res['ip'], mask=res['mask'], gw=res['gw'], dns=res['dns'])
    elif any(k in d for k in ('ip', 'mask', 'gw', 'dns')):
        for k in ('ip', 'gw', 'dns'):
            v = str(d.get(k, s.get(k) or '')).strip()
            if v and not valid_ip(v):
                return jerr(f'{k.upper()} tidak valid')
        m = str(d.get('mask', s.get('mask') or '')).strip()
        if m and not valid_mask(m):
            return jerr('Subnet mask tidak valid')
        s.update(dhcp=False, ip=str(d.get('ip', '')).strip(), mask=m, gw=str(d.get('gw', '')).strip(),
                 dns=str(d.get('dns', '')).strip())
    if isinstance(d.get('wifi'), dict) and 'wifi' in s:
        s['wifi'] = {'ssid': str(d['wifi'].get('ssid', ''))[:32], 'key': str(d['wifi'].get('key', ''))[:63]}
    if isinstance(d.get('scripts'), dict):
        s['scripts'] = {re.sub(r'[^A-Za-z0-9_\-]', '', str(k))[:30]: str(v)[:20000]
                        for k, v in list(d['scripts'].items())[:30] if re.sub(r'[^A-Za-z0-9_\-]', '', str(k))}
    if n['type'] == 'server' and isinstance(d.get('services'), dict):
        sv = d['services']
        cur = s.setdefault('services', {})
        if isinstance(sv.get('dhcp'), dict):
            cur['dhcp'] = {k: sv['dhcp'].get(k, '') for k in ('enabled', 'start', 'max', 'gw', 'dns')}
        if isinstance(sv.get('http'), dict):
            cur['http'] = {'enabled': bool(sv['http'].get('enabled')), 'index': str(sv['http'].get('index', ''))[:50000]}
        if isinstance(sv.get('dns'), dict):
            recs = sv['dns'].get('records') or {}
            cur['dns'] = {'enabled': bool(sv['dns'].get('enabled')),
                          'records': {str(k)[:60]: str(v) for k, v in recs.items() if valid_ip(str(v))}}
    rt.mark_dirty()
    return web.json_response({'ok': True, 'host': {k: s.get(k) for k in ('ip', 'mask', 'gw', 'dns', 'dhcp', 'wifi', 'scripts')}})


async def node_ping(req):
    """Quick connectivity check from the inspector (like PT 'simple PDU')."""
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    d = await req.json()
    src, dst = int(d['src']), str(d['dst'])
    net = rt.net()
    if dst.isdigit() and int(dst) in rt.by_id:
        e = net.node_eps(int(dst))
        if not e:
            return web.json_response({'ok': False, 'why': 'tujuan tidak punya IP aktif'})
        e.sort(key=lambda x: x['ifn'].startswith('Loopback'))
        dst = e[0]['ip']
    res = net.ping(src, dst)
    path = [src] + [h['nid'] for h in res.get('hops', [])]
    return web.json_response({'ok': res['ok'], 'why': res.get('why'), 'dst': dst, 'path': path,
                              'at': res.get('at')})


async def node_script(req):
    """Run a script on a PC/Server (simulation) and return its output."""
    lid = int(req.match_info['lid'])
    nid = int(req.match_info['nid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    n = rt.by_id.get(nid)
    if not n or n['type'] not in HOST:
        return jerr('Script hanya untuk PC/Server')
    if not rt.is_running(nid):
        return jerr('Nyalakan node terlebih dahulu')
    d = await req.json()
    text = d.get('text') or rt.state(nid).get('scripts', {}).get(d.get('name', ''), '')
    buf = []

    async def send(m):
        if m['t'] in ('out', 'log'):
            buf.append(m['d'])
    sess = ConsoleSession(rt, nid, send)
    cli = sess.make_cli(nid)
    sess.stack = [cli]
    try:
        await asyncio.wait_for(cli.run_script(str(text)[:20000]), 120)
    except asyncio.TimeoutError:
        buf.append('\r\n[script dihentikan: lebih dari 120 detik]\r\n')
    finally:
        sess.close()
    return web.json_response({'output': ''.join(buf).replace('\r\n', '\n')})


async def lab_map3d(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    raw = await req.read()
    if len(raw) > 4 * 1024 * 1024:
        return jerr('Data peta 3D terlalu besar')
    d = json.loads(raw or b'{}')
    m = d.get('map3d')
    if not isinstance(m, dict):
        return jerr('Format peta 3D tidak valid')
    rt = req.app['mgr'].get(lid)
    rt.lab['map3d'] = {k: m.get(k, []) for k in ('buildings', 'objects', 'cables')}
    rt.lab['map3d']['settings'] = m.get('settings', {})
    rt.mark_dirty()
    return web.json_response({'ok': True})


# ------------------------------------------------------------------ PNETLab / Packet Tracer extras
async def lab_extra(req):
    """Lab-level extras: workbook (instructions + checks) and lab timer."""
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    d = await req.json()
    rt = req.app['mgr'].get(lid)
    if 'workbook' in d:
        rt.lab['workbook'] = ai.sanitize_workbook(d['workbook']) if d['workbook'] else None
    if 'timer' in d:
        t = d['timer'] if isinstance(d['timer'], dict) else {}
        rt.lab['timer'] = {'minutes': max(0, min(1440, int(t.get('minutes') or 0))), 'started': float(t.get('started') or 0)} if t else None
    rt.mark_dirty()
    return web.json_response({'ok': True})


async def node_pdu(req):
    """Simple/complex PDU for simulation mode: forward and return path with per-hop IPs."""
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    d = await req.json()
    src, dst = int(d['src']), str(d['dst'])
    proto = d.get('proto') if d.get('proto') in ('icmp', 'tcp', 'udp') else 'icmp'
    port = int(d['port']) if str(d.get('port') or '').isdigit() else None
    if src not in rt.by_id:
        return jerr('Node sumber tidak ada')
    if not rt.is_running(src):
        return web.json_response({'ok': False, 'why': 'off', 'at': src, 'fwd': [src], 'back': [], 'dst': dst})
    net = rt.net()
    if dst.isdigit() and int(dst) in rt.by_id:
        e = net.node_eps(int(dst))
        if not e:
            return web.json_response({'ok': False, 'why': 'tujuan tidak punya IP aktif', 'at': src, 'fwd': [src], 'back': [], 'dst': ''})
        e.sort(key=lambda x: x['ifn'].startswith('Loopback'))
        dst = e[0]['ip']
    f = net.forward(src, dst, proto, port)
    res = {'ok': f['ok'], 'why': f.get('why'), 'at': f.get('at'), 'dst': dst, 'src_ip': f.get('src_ip'), 'proto': proto, 'port': port,
           'fwd': [src] + [h['nid'] for h in f.get('hops', [])], 'fwd_ips': [h['ip'] for h in f.get('hops', [])], 'back': []}
    if f['ok'] and f.get('src_ip'):
        b = net.forward(f['dst_node'], f['src_ip'], proto, None, dst, acl=(proto == 'icmp'))
        res['back'] = [f['dst_node']] + [h['nid'] for h in b.get('hops', [])]
        if not b['ok'] or b.get('dst_node') != src:
            res.update(ok=False, why='noreturn', at=b.get('at'))
    return web.json_response(res)


async def node_exec(req):
    """Run commands on a simulated device (Inspect tool, config import). Privileged mode for IOS."""
    lid = int(req.match_info['lid'])
    nid = int(req.match_info['nid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    n = rt.by_id.get(nid)
    if not n or kind_of(n['type']) != 'sim':
        return jerr('Hanya untuk perangkat simulasi')
    if not rt.is_running(nid):
        return jerr('Nyalakan node terlebih dahulu')
    d = await req.json()
    cmds = [str(c)[:300] for c in (d.get('cmds') or [])][:600]
    out, bad = await ai.run_lines(rt, nid, cmds)
    req.app['mgr'].flush()
    return web.json_response({'output': out, 'rejected': bad})


async def lab_check(req):
    """Score the lab against its workbook checks (Activity Wizard style)."""
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    checks = ((rt.lab.get('workbook') or {}).get('checks') or [])
    names = {n['name']: n for n in rt.lab['nodes']}
    net = rt.net()
    out = []
    for c in checks:
        t, ok, info = c.get('type'), False, ''
        try:
            if t == 'ping':
                s, dst = names.get(c.get('src')), str(c.get('dst') or '')
                if dst in names:
                    e = net.node_eps(names[dst]['id'])
                    e.sort(key=lambda x: x['ifn'].startswith('Loopback'))
                    dst = e[0]['ip'] if e else ''
                if s and dst and rt.is_running(s['id']):
                    r = net.ping(s['id'], dst)
                    ok, info = r['ok'], '' if r['ok'] else (r.get('why') or '')
                else:
                    info = 'node mati / tujuan tanpa IP'
                label = c.get('label') or f"Ping {c.get('src')} → {c.get('dst')}"
            elif t == 'config':
                n = names.get(c.get('node'))
                txt = running_config(n['type'], rt.state(n['id'])) if n and kind_of(n['type']) == 'sim' else ''
                ok = bool(c.get('contains')) and str(c['contains']).lower() in txt.lower()
                label = c.get('label') or f"{c.get('node')}: config berisi \"{c.get('contains')}\""
            elif t == 'running':
                n = names.get(c.get('node'))
                ok = bool(n and rt.is_running(n['id']))
                label = c.get('label') or f"{c.get('node')} menyala"
            elif t == 'link':
                a, b = names.get(c.get('a')), names.get(c.get('b'))
                ok = bool(a and b and any({l['a']['node'], l['b']['node']} == {a['id'], b['id']} for l in rt.lab['links']))
                label = c.get('label') or f"Kabel {c.get('a')} ↔ {c.get('b')}"
            else:
                continue
        except Exception as e:  # a broken check must not break scoring
            label, info = c.get('label') or str(t), str(e)
        out.append({'label': label, 'ok': ok, 'info': info})
    score = round(100 * sum(1 for r in out if r['ok']) / len(out)) if out else 0
    return web.json_response({'results': out, 'score': score})


async def lab_configsets(req):
    """PNETLab-style multiple startup-config sets per lab."""
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    d = await req.json()
    sets = rt.lab.setdefault('configsets', {})
    name = re.sub(r'[^A-Za-z0-9 _\-]', '', str(d.get('name') or ''))[:30].strip()
    act = d.get('action')
    if act == 'save':
        if not name:
            return jerr('Nama config set wajib diisi')
        if name not in sets and len(sets) >= 12:
            return jerr('Maksimal 12 config set per lab')
        sets[name] = {'saved': time.time(), 'nodes': {str(n['id']): copy.deepcopy(rt.state(n['id']))
                                                     for n in rt.lab['nodes'] if kind_of(n['type']) == 'sim'}}
    elif act == 'load':
        cs = sets.get(name)
        if not cs:
            return jerr('Config set tidak ditemukan')
        for nid, st in cs['nodes'].items():
            n = rt.by_id.get(int(nid))
            if n and kind_of(n['type']) == 'sim':
                n['state'] = copy.deepcopy(st)
                n['startup'] = copy.deepcopy(st)
                rt.arp.pop(n['id'], None)
    elif act == 'delete':
        sets.pop(name, None)
    rt.mark_dirty()
    req.app['mgr'].flush()
    return web.json_response({'ok': True, 'sets': [{'name': k, 'saved': v['saved'], 'nodes': len(v['nodes'])} for k, v in sets.items()]})


async def lab_configs_export(req):
    lid = int(req.match_info['lid'])
    row = lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    parts = []
    for n in rt.lab['nodes']:
        if kind_of(n['type']) == 'sim' and n['type'] not in HOST:
            parts.append(f"!==================== {n['name']} ({n['type']})\n" + running_config(n['type'], rt.state(n['id'])))
    fname = re.sub(r'[^A-Za-z0-9_\-]+', '_', row['name']) + '-configs.txt'
    return web.Response(text='\n\n'.join(parts) or '! tidak ada perangkat IOS', content_type='text/plain',
                        headers={'Content-Disposition': f'attachment; filename="{fname}"'})


async def admin_running(req):
    db = req.app['db']
    out = []
    for lid, rt in list(req.app['mgr'].labs.items()):
        act = [n for n in rt.lab['nodes'] if kind_of(n['type']) not in ('cloud', 'remote')]
        on = sum(1 for n in act if rt.is_running(n['id']))
        if not on:
            continue
        row = db.q('SELECT l.name, u.username FROM labs l LEFT JOIN users u ON u.id=l.owner WHERE l.id=?', (lid,), one=True)
        if row:
            out.append({'id': lid, 'name': row['name'], 'owner': row['username'], 'running': on, 'nodes': len(act)})
    return web.json_response({'labs': out})


# ------------------------------------------------------------------ Claude CLI
def ai_allowed(req):
    u = req['user']
    return u['role'] == 'admin' or req.app['db'].setting('allow_ai_users', '0') == '1'


async def ai_status(req):
    st = dict(await ai.status(force=bool(req.query.get('force'))))
    if req['user']['role'] != 'admin':
        st.pop('email', None)
        st.pop('path', None)
        st.pop('configDir', None)
    st['allowed'] = ai_allowed(req)
    st['allow_users'] = req.app['db'].setting('allow_ai_users', '0') == '1'
    return web.json_response(st)


async def ai_login(req):
    return web.json_response(await ai.start_login())


async def lab_ai(req):
    lid = int(req.match_info['lid'])
    row = lab_access(req, lid)
    if not ai_allowed(req):
        return jerr('Fitur Claude hanya untuk admin (atur di Status sistem)', 403)
    d = await req.json()
    prompt = str(d.get('prompt') or '').strip()[:6000]
    if len(prompt) < 5:
        return jerr('Tulis permintaan lab terlebih dahulu')
    mode = 'extend' if d.get('mode') == 'extend' else 'replace'
    rt = req.app['mgr'].get(lid)
    try:
        text, meta = await ai.ask_claude(ai.build_prompt(prompt, rt, mode), str(d.get('model') or ''))
        plan = ai.extract_json(text)
        if mode == 'replace':
            for n in [n for n in rt.lab['nodes'] if kind_of(n['type']) == 'real']:
                await req.app['real'].stop(rt, n)
        res = await ai.apply_plan(rt, plan, mode, req['user'])
    except RuntimeError as e:
        return jerr(str(e), 502)
    await req.app['real'].sync_links(rt)
    if d.get('rename') and res['name']:
        req.app['db'].x('UPDATE labs SET name=?, description=? WHERE id=?', (res['name'], res['description'] or row['description'], lid))
    req.app['mgr'].flush()
    res.update(meta)
    return web.json_response(res)


async def lab_ai_ask(req):
    lid = int(req.match_info['lid'])
    lab_access(req, lid)
    if not ai_allowed(req):
        return jerr('Fitur Claude hanya untuk admin (atur di Status sistem)', 403)
    d = await req.json()
    q = str(d.get('question') or '').strip()[:4000]
    if len(q) < 3:
        return jerr('Tulis pertanyaan terlebih dahulu')
    try:
        text, meta = await ai.ask_claude(ai.build_ask_prompt(q, req.app['mgr'].get(lid)), str(d.get('model') or ''))
    except RuntimeError as e:
        return jerr(str(e), 502)
    return web.json_response(dict(meta, answer=text))


# ------------------------------------------------------------------ websockets
async def ws_console(req):
    db = req.app['db']
    user = db.session_user(req.cookies.get(COOKIE))
    if not user:
        return web.Response(status=401)
    req['user'] = user
    lid = int(req.match_info['lid'])
    nid = int(req.match_info['nid'])
    lab_access(req, lid)
    rt = req.app['mgr'].get(lid)
    if nid not in rt.by_id:
        return web.Response(status=404)
    node = rt.by_id[nid]
    kind = kind_of(node['type'])
    ws = web.WebSocketResponse(heartbeat=25, max_msg_size=1 << 20)
    await ws.prepare(req)

    async def send(obj):
        if not ws.closed:
            await ws.send_str(json.dumps(obj))

    if kind == 'sim':
        await send({'t': 'mode', 'd': 'sim'})
        sess = ConsoleSession(rt, nid, send)
        try:
            await sess.start()
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if not sess.stack and data.get('t') == 'line':
                    if rt.is_running(nid):
                        await sess.start()
                    else:
                        await sess.out('\r\n%% Device is powered off. Start the node first.\r\n')
                    continue
                await sess.handle(data)
        finally:
            sess.close()
        return ws

    await send({'t': 'mode', 'd': 'raw'})
    if kind == 'real':
        hub = req.app['real'].hub(lid, nid)
        if not hub:
            await send({'t': 'out', 'd': '\r\n[Node belum dijalankan. Klik Start terlebih dahulu.]\r\n'})
            await ws.close()
            return ws

        async def push(text):
            await send({'t': 'out', 'd': text})
        if hub.buffer:
            await push(hub.buffer)
        hub.clients.add(push)
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                data = json.loads(msg.data)
                if data.get('t') == 'data' and hub.write:
                    hub.write(data['d'])
                elif data.get('t') == 'resize' and hub.resize:
                    hub.resize(int(data.get('cols', 80)), int(data.get('rows', 24)))
        finally:
            hub.clients.discard(push)
        return ws

    if kind == 'remote':
        q = asyncio.Queue()

        async def push(text):
            await send({'t': 'out', 'd': text})
        task = asyncio.ensure_future(remote_console(node['props'], push, q))
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        q.put_nowait(json.loads(msg.data))
                    except ValueError:
                        pass
                if task.done():
                    break
        finally:
            q.put_nowait(None)
            await asyncio.sleep(0)
            if not task.done():
                task.cancel()
        return ws
    await send({'t': 'out', 'd': '\r\n[Node ini tidak memiliki console]\r\n'})
    await ws.close()
    return ws


# ------------------------------------------------------------------ static
async def index(req):
    return web.FileResponse(os.path.join(STATIC, 'index.html'), headers={'Cache-Control': 'no-cache'})


def build_app(data_dir, port=8080):
    app = web.Application(middlewares=[guard], client_max_size=20 * 1024 * 1024)
    app['db'] = DB(os.path.join(data_dir, 'nexlab.db'))
    app['real'] = RealManager(data_dir)
    app['mgr'] = RuntimeManager(app['db'], app['real'])
    app['started'] = time.time()
    app['port'] = port
    r = app.router
    r.add_get('/', index)
    r.add_get('/api/public', public)
    r.add_post('/api/register', register)
    r.add_post('/api/login', login)
    r.add_post('/api/logout', logout)
    r.add_get('/api/me', me)
    r.add_post('/api/me/password', change_password)
    r.add_get('/api/system', system)
    r.add_get('/api/templates', templates)
    r.add_get('/api/labs', labs_list)
    r.add_post('/api/labs', lab_create)
    r.add_get('/api/labs/{lid}', lab_get)
    r.add_post('/api/labs/{lid}/meta', lab_meta)
    r.add_put('/api/labs/{lid}/topology', lab_topology)
    r.add_delete('/api/labs/{lid}', lab_delete)
    r.add_get('/api/labs/{lid}/export', lab_export)
    r.add_get('/api/labs/{lid}/status', lab_status)
    r.add_post('/api/labs/{lid}/power/{action:start|stop|wipe}', lab_power)
    r.add_get('/api/labs/{lid}/nodes/{nid}/config', node_config)
    r.add_post('/api/labs/{lid}/nodes/{nid}/host', node_host)
    r.add_post('/api/labs/{lid}/ping', node_ping)
    r.add_post('/api/labs/{lid}/nodes/{nid}/script', node_script)
    r.add_put('/api/labs/{lid}/map3d', lab_map3d)
    r.add_get('/api/admin/users', admin_users)
    r.add_post('/api/admin/users/{uid}', admin_user_update)
    r.add_delete('/api/admin/users/{uid}', admin_user_delete)
    r.add_get('/api/admin/settings', admin_settings)
    r.add_post('/api/admin/settings', admin_settings)
    r.add_put('/api/labs/{lid}/extra', lab_extra)
    r.add_post('/api/labs/{lid}/pdu', node_pdu)
    r.add_post('/api/labs/{lid}/nodes/{nid}/exec', node_exec)
    r.add_post('/api/labs/{lid}/check', lab_check)
    r.add_post('/api/labs/{lid}/configsets', lab_configsets)
    r.add_get('/api/labs/{lid}/configs', lab_configs_export)
    r.add_post('/api/labs/{lid}/ai', lab_ai)
    r.add_post('/api/labs/{lid}/ai/ask', lab_ai_ask)
    r.add_get('/api/ai/status', ai_status)
    r.add_post('/api/admin/ai/login', ai_login)
    r.add_get('/api/admin/running', admin_running)
    r.add_get('/ws/console/{lid}/{nid}', ws_console)
    r.add_static('/static/', STATIC, append_version=False)

    async def on_start(app):
        app['loop_task'] = asyncio.ensure_future(app['mgr'].loop())

    async def on_stop(app):
        app['loop_task'].cancel()
        app['mgr'].flush()
        await app['real'].shutdown()
    app.on_startup.append(on_start)
    app.on_cleanup.append(on_stop)
    return app
