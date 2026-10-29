/* Topology editor (PNETLab-style workspace) */
const PREFIX = { router: 'R', firewall: 'FW', switch: 'SW', l3switch: 'MLS', pc: 'PC', laptop: 'Laptop', server: 'Server', cloud: 'Cloud', qemu: 'VM', netns: 'Linux', remote: 'HW', hub: 'Hub', ap: 'AP', olt: 'OLT', odp: 'ODP', ont: 'ONT', printer: 'Printer', ipphone: 'Phone', cctv: 'CCTV', smartphone: 'HP', tablet: 'Tab', iot: 'IoT' };
const SHORTS = [['TenGigabitEthernet', 'Te'], ['GigabitEthernet', 'Gi'], ['FastEthernet', 'Fa'], ['Ethernet', 'Et'], ['Loopback', 'Lo']];
const shortIf = n => { for (const [f, s] of SHORTS) if (n.startsWith(f)) return s + n.slice(f.length); return n; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CAT_ORDER = ['Routers', 'Switches', 'Security', 'End Devices', 'Wireless', 'Fiber / FTTH', 'Connections', 'Real / Virtual'];
const CAT_NAME = { 'Routers': 'Router', 'Switches': 'Switch', 'Security': 'Keamanan', 'End Devices': 'Perangkat akhir', 'Wireless': 'Wireless', 'Fiber / FTTH': 'Fiber / FTTH', 'Connections': 'Koneksi', 'Real / Virtual': 'Perangkat real' };

function clientIfaces(tpl, props) {
  if (tpl.type === 'qemu') return Array.from({ length: Math.max(1, Math.min(16, +props.nics || 4)) }, (_, i) => 'e' + i);
  if (tpl.type === 'remote') { const p = String(props.ports || '').split(',').map(s => s.trim()).filter(Boolean); return p.length ? p : ['port1']; }
  return null; // server decides (fixed list)
}

class Editor {
  constructor(root, labId) {
    this.root = root; this.id = +labId;
    this.view = { x: 60, y: 40, k: 1 };
    this.sel = null; this.tool = null; this.pending = null; this.drag = null; this.insOpen = false; this.mode = 'topo';
    this.sim = { on: false, pdus: [], events: [], idx: -1, playing: false, filter: {}, seq: 0, speed: 900, clock: 0, pick: null };
    this.undoStack = [];
    this.saveT = null; this.alive = true;
    this.load();
  }
  destroy() { this.map3d && this.map3d.destroy(); this.alive = false; this.sim.playing = false; clearInterval(this.poll); clearInterval(this.timerT); removeEventListener('keydown', this.keyH); removeEventListener('mousemove', this.mvH); removeEventListener('mouseup', this.upH); this.closePop(); }

  async load() {
    const [d] = await Promise.all([App.api('GET', `/api/labs/${this.id}`), App.loadTemplates(), App.loadSystem()]);
    if (!d || !this.alive) return;
    this.name = d.name; this.desc = d.description || ''; this.lab = d.lab; this.status = d.status;
    this.tpl = Object.fromEntries(App.templates.map(t => [t.type, t]));
    this.renderShell();
    this.drawAll();
    this.fitView();
    this.poll = setInterval(() => this.refreshStatus(), 2000);
    this.resetUndo();
    this.timerT = setInterval(() => this.tickTimer(), 1000); this.tickTimer();
    try { if (localStorage.getItem('nx-theme') === 'dark') this.toggleTheme(); } catch (e) {}
    this.keyH = e => this.onKey(e);
    addEventListener('keydown', this.keyH);
  }

  // ---------------------------------------------------------------- layout
  renderShell() {
    const item = (id, label, ic, k) => `<button class="sb-item" data-sb="${id}" title="${esc(label)}">${UI[ic]}<span>${esc(label)}</span>${k ? `<span class="k">${k}</span>` : ''}</button>`;
    this.root.innerHTML = `
    <div id="editor">
      <nav class="sidebar" aria-label="Menu lab">
        <div class="sb-logo"><svg class="brand-mark" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="6" fill="#1F6FB5"/><circle cx="10" cy="11" r="3.2" fill="#fff"/><circle cx="22" cy="11" r="3.2" fill="#fff"/><circle cx="16" cy="22" r="3.2" fill="#fff"/><path d="M10 11L22 11L16 22Z" fill="none" stroke="#fff" stroke-width="1.2"/></svg><span>${esc(App.pub?.title || 'NexLab')}</span></div>
        ${item('addobj', 'Tambah objek', 'addobj')}
        ${item('nodes', 'Node', 'nodes')}
        ${item('links', 'Koneksi', 'links')}
        ${item('configs', 'Startup-config', 'file')}
        ${item('workbook', 'Workbook / tugas', 'book')}
        ${item('ai', 'Claude AI', 'spark')}
        ${item('v3d', 'Peta 3D', 'cube')}
        ${item('more', 'Aksi lainnya', 'more')}
        <div class="sb-sep"></div>
        ${item('sim', 'Mode simulasi', 'sim', 'Shift+S')}
        ${item('refresh', 'Refresh topologi', 'refresh')}
        ${item('fit', 'Pas layar', 'fit')}
        ${item('status', 'Status', 'gauge')}
        ${item('details', 'Detail lab', 'info')}
        ${item('theme', 'Mode gelap', 'moon')}
        ${item('guide', 'Panduan', 'help', 'F1')}
        <div class="sb-spacer"></div>
        ${item('close', 'Tutup lab', 'door')}
        ${item('logout', 'Logout', 'logout')}
      </nav>
      <div class="canvas-wrap" id="cwrap">
        <svg id="canvas" tabindex="0" aria-label="Kanvas topologi">
          <g id="vp"><rect x="-6000" y="-6000" width="12000" height="12000" fill="#fff"/>
            <g id="gNotes"></g><g id="gLinks"></g><g id="gNodes"></g><g id="gTemp"></g></g>
        </svg>
        <div class="ed-top"><div class="ed-name" id="edName"></div><div class="ed-timer hidden" id="edTimer"></div></div>
        <div class="ptbar" id="ptbar" role="toolbar" aria-label="Alat">
          ${[['select', 'pointer', 'Select (Esc)'], ['inspect', 'search', 'Inspect (I)'], ['delete', 'trash', 'Delete (D)'], '-', ['shape:text', 'note', 'Teks / note (N)'], ['shape:rect', 'rect', 'Persegi'], ['shape:ellipse', 'ellipse', 'Elips'], ['shape:line', 'line', 'Garis'], ['shape:image', 'image', 'Gambar'], '-', ['pdu', 'mail', 'PDU sederhana (P)'], ['cpdu', 'mailplus', 'PDU kompleks']]
            .map(t => t === '-' ? '<i class="pt-sep"></i>' : `<button class="btn" data-tool="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${UI[t[1]]}</button>`).join('')}
        </div>
        <div class="modebar"><button class="btn sm on" data-mode="rt" title="Realtime (Shift+R)">${UI.clock} Realtime</button><button class="btn sm" data-mode="sim" title="Simulasi (Shift+S)">${UI.sim} Simulasi</button></div>
        <div class="hint hidden" id="hint"></div>
        <div class="zoomctl"><button class="btn" id="zIn" title="Perbesar">+</button><div class="zv" id="zVal">100%</div><button class="btn" id="zOut" title="Perkecil">−</button><button class="btn" id="zFit" title="Pas layar">${UI.fit}</button></div>
        <footer class="statusbar" id="sbar"></footer>
      </div>
      <aside class="inspector hidden" id="insp"><div class="ins-head"><span id="inspTitle"></span><span class="grow"></span><button class="btn ghost xs" id="inspClose" title="Tutup">${UI.close}</button></div><div class="ins-body" id="inspBody"></div></aside>
      <section id="map3dHost" class="hidden"></section>
    </div>`;
    this.svg = this.root.querySelector('#canvas');
    this.vp = this.root.querySelector('#vp');
    const $ = s => this.root.querySelector(s);
    this.showName();
    const act = {
      addobj: b => this.addObjMenu(b), nodes: () => this.nodesModal(), links: () => this.linksModal(), configs: () => this.configsModal(),
      workbook: () => this.workbookPanel(!this.root.querySelector('#wbPanel')), ai: () => this.aiModal(), sim: () => this.setSimMode(!this.sim.on),
      theme: () => this.toggleTheme(),
      v3d: () => this.setView(this.mode === '3d' ? 'topo' : '3d'), more: b => this.moreMenu(b),
      refresh: async () => { await this.reloadLab(); App.toast('Topologi dimuat ulang'); },
      fit: () => { if (this.mode === '3d') this.setView('topo'); this.fitView(); },
      status: () => this.statusModal(), details: () => this.labDetails(), guide: () => Guide.toggle(),
      close: () => { location.hash = '#/labs'; }, logout: () => App.logout(),
    };
    this.root.querySelectorAll('[data-sb]').forEach(b => b.onclick = () => { b.blur(); act[b.dataset.sb](b); });
    this.root.querySelectorAll('#ptbar [data-tool]').forEach(b => b.onclick = () => {
      const t = b.dataset.tool;
      if (t === 'cpdu') return this.complexPduModal();
      this.setTool(t === 'select' || this.tool === t ? null : t);
    });
    this.root.querySelectorAll('.modebar [data-mode]').forEach(b => b.onclick = () => this.setSimMode(b.dataset.mode === 'sim'));
    $('#zIn').onclick = () => this.zoomAt(1.2);
    $('#zOut').onclick = () => this.zoomAt(1 / 1.2);
    $('#zFit').onclick = () => this.fitView();
    $('#inspClose').onclick = () => { this.insOpen = false; this.inspect(); };
    const s = this.svg;
    s.addEventListener('mousedown', e => this.onDown(e));
    addEventListener('mousemove', this.mvH = e => this.onMove(e));
    addEventListener('mouseup', this.upH = e => this.onUp(e));
    s.addEventListener('dblclick', e => this.onDbl(e));
    s.addEventListener('contextmenu', e => this.onCtx(e));
    s.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e); }, { passive: false });
    this.inspect();
  }
  showName() {
    const el = this.root.querySelector('#edName');
    if (el) el.innerHTML = `${UI.lab}<span>${esc(this.name)}</span>`;
    document.title = `${this.name} — ${App.pub?.title || 'NexLab'}`;
  }

  async setView(v) {
    this.mode = v;
    const b = this.root.querySelector('[data-sb=v3d]');
    b.classList.toggle('on', v === '3d'); b.querySelector('span').textContent = v === '3d' ? 'Kembali ke topologi' : 'Peta 3D';
    const host = this.root.querySelector('#map3dHost');
    this.root.querySelector('#editor').classList.toggle('mode3d', v === '3d');
    if (v === '3d') {
      host.classList.remove('hidden');
      if (!this.map3d) {
        host.innerHTML = '<p class="muted" style="padding:20px">Memuat modul 3D…</p>';
        const mod = await import('/static/js/map3d.js');
        this.map3d = new mod.Map3D(host, this);
      } else this.map3d.resume();
    } else {
      host.classList.add('hidden');
      this.map3d && this.map3d.pause();
    }
  }

  // ---------------------------------------------------------------- drawing
  nodeById(id) { return this.lab.nodes.find(n => n.id === id); }
  running(id) { return !!this.status?.nodes?.[id]?.running; }
  applyView() { this.vp.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`); this.statusbar(); }
  drawAll() { this.drawNotes(); this.drawLinks(); this.drawNodes(); this.applyView(); this.statusbar(); }
  drawNodes() {
    const g = this.root.querySelector('#gNodes');
    g.innerHTML = this.lab.nodes.map(n => {
      const k = this.tpl[n.type]?.kind;
      const lit = k === 'cloud' || k === 'remote' || this.running(n.id);
      const st = this.status?.nodes?.[n.id] || {};
      const sub = st.ip || (n.host && n.host.ip) || '';
      const sel = this.sel?.kind === 'node' && this.sel.id === n.id;
      const R = Math.round(26 * (n.size || 1)), lp = n.lpos || 'bottom';
      const L = { bottom: [0, R + 18, R + 31, 'middle'], top: [0, -R - 20, -R - 7, 'middle'], left: [-R - 8, 0, 13, 'end'], right: [R + 8, 0, 13, 'start'] }[lp] || [0, R + 18, R + 31, 'middle'];
      return `<g class="node ${lit ? 'run' : ''} ${sel ? 'sel' : ''}" data-id="${n.id}" transform="translate(${n.x},${n.y})">
        <rect class="selbox" x="${-R - 7}" y="${-R - 7}" width="${2 * R + 14}" height="${2 * R + 14}" rx="3"/><rect class="hitbox" x="${-R - 2}" y="${-R - 2}" width="${2 * R + 4}" height="${2 * R + 4}"/>
        <g class="ico">${deviceIcon(n.type, 2 * R).replace('<svg ', `<svg x="${-R}" y="${-R}" `)}</g>
        <g class="plug" transform="translate(${R},${-R})"><title>Tarik ke node lain untuk membuat koneksi</title><circle r="8.5"/><path d="M-2.5 -5v3M2.5 -5v3M-4 -2h8v1.5a4 4 0 0 1-8 0zM0 3.5v3"/></g>
        <text class="label" x="${L[0]}" y="${L[1]}" style="text-anchor:${L[3]}">${esc(n.name)}</text><text class="sub" x="${L[0]}" y="${L[2]}" style="text-anchor:${L[3]}">${esc(sub)}</text></g>`;
    }).join('');
  }
  linkGeom(l) {
    const a = this.nodeById(l.a.node), b = this.nodeById(l.b.node);
    if (!a || !b) return null;
    const pair = this.lab.links.filter(x => (x.a.node === l.a.node && x.b.node === l.b.node) || (x.a.node === l.b.node && x.b.node === l.a.node));
    const idx = pair.indexOf(l), off = (idx - (pair.length - 1) / 2) * 14;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const sign = l.a.node < l.b.node ? 1 : -1;
    const ax = a.x + px * off * sign, ay = a.y + py * off * sign, bx = b.x + px * off * sign, by = b.y + py * off * sign;
    return { ax, ay, bx, by, ux, uy, px, py, len };
  }
  drawLinks() {
    const g = this.root.querySelector('#gLinks');
    g.innerHTML = this.lab.links.map(l => {
      const G = this.linkGeom(l); if (!G) return '';
      const st = this.status?.links?.[l.id] || {};
      const d0 = Math.min(36, G.len / 3);
      const dA = G.uy > 0.7 ? Math.min(66, G.len / 3) : d0, dB = -G.uy > 0.7 ? Math.min(66, G.len / 3) : d0;
      const tA = Math.max(dA + 20, Math.min(86, G.len / 2 - 18)), tB = Math.max(dB + 20, Math.min(86, G.len / 2 - 18));
      const sel = this.sel?.kind === 'link' && this.sel.id === l.id;
      const lab = (x, y, s) => { const t = shortIf(s), w = t.length * 6.3 + 8; return `<g class="ifl" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="-7.5" width="${w.toFixed(1)}" height="15" rx="2"/><text y="3.5">${esc(t)}</text></g>`; };
      const wl = l.a.iface.startsWith('Wireless') || l.b.iface.startsWith('Wireless');
      const fo = l.style === 'fiber' || /^(GPON|PON|IN|OUT)/.test(l.a.iface) || /^(GPON|PON|IN|OUT)/.test(l.b.iface);
      return `<g class="link ${wl ? 'wireless' : fo ? 'fiber' : ''} ${st.mixed ? 'mixed' : ''} ${sel ? 'sel' : ''}" data-id="${esc(l.id)}">
        <line class="hit" x1="${G.ax}" y1="${G.ay}" x2="${G.bx}" y2="${G.by}"/>
        <line class="wire" x1="${G.ax}" y1="${G.ay}" x2="${G.bx}" y2="${G.by}" style="${l.color ? `stroke:${l.color};` : ''}${l.width ? `stroke-width:${l.width};` : ''}${l.dash ? `stroke-dasharray:${l.dash === 'dotted' ? '2 5' : '9 6'};` : ''}"/>
        <circle class="end st-${st.a || 'off'}" cx="${G.ax + G.ux * dA}" cy="${G.ay + G.uy * dA}" r="4"/>
        <circle class="end st-${st.b || 'off'}" cx="${G.bx - G.ux * dB}" cy="${G.by - G.uy * dB}" r="4"/>
        ${lab(G.ax + G.ux * tA, G.ay + G.uy * tA, l.a.iface)}
        ${lab(G.bx - G.ux * tB, G.by - G.uy * tB, l.b.iface)}
        ${st.mixed ? `<title>Link simulasi ↔ perangkat real: hanya dokumentasi, paket tidak lewat</title>` : ''}</g>`;
    }).join('');
  }
  drawNotes() {
    const g = this.root.querySelector('#gNotes');
    g.innerHTML = (this.lab.notes || []).map(n => {
      if (n.kind && n.kind !== 'note') return this.shapeSvg(n, this.sel?.kind === 'note' && this.sel.id === n.id);
      const lines = String(n.text || '').split('\n');
      const w = Math.max(80, Math.max(...lines.map(s => s.length)) * 7.2 + 24), h = lines.length * 17 + 18;
      const sel = this.sel?.kind === 'note' && this.sel.id === n.id;
      return `<g class="note sticky ${sel ? 'sel' : ''}" data-id="${n.id}" transform="translate(${n.x},${n.y})"><rect width="${w}" height="${h}" rx="2"/>
        <text x="12" y="22">${lines.map((s, i) => `<tspan x="12" dy="${i ? 17 : 0}">${esc(s)}</tspan>`).join('')}</text></g>`;
    }).join('');
  }
  statusbar() {
    const sb = this.root.querySelector('#sbar'); if (!sb || !this.lab) return;
    const zv = this.root.querySelector('#zVal'); if (zv) zv.textContent = Math.round(this.view.k * 100) + '%';
    const act = n => this.tpl[n.type]?.kind !== 'cloud';
    const on = this.lab.nodes.filter(n => act(n) && this.running(n.id)).length;
    const caps = App.sys?.caps || {};
    sb.innerHTML = `<span><span class="led ${on ? 'on' : ''}"></span> ${on}/${this.lab.nodes.filter(act).length} node menyala</span>
      <span>${this.lab.links.length} kabel</span>
      <span>Server ${esc({ linux: 'Linux', windows: 'Windows', macos: 'macOS' }[caps.os] || '')} · VM ${caps.avail?.qemu ? `<span class="yes">siap</span> (${esc(caps.netmode === 'tap' ? 'bridge' : 'socket')})` : 'belum (QEMU tidak ada)'}</span>
      ${(this.status?.restart || []).length ? `<span class="warn">Kabel VM berubah: matikan & nyalakan ulang ${esc(this.status.restart.map(i => this.nodeById(i)?.name).join(', '))}</span>` : ''}
      <span>2× klik node = console · klik kanan = menu</span>`;
  }

  // ---------------------------------------------------------------- view
  world(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k };
  }
  center() {
    const r = this.svg.getBoundingClientRect();
    return { x: (r.width / 2 - this.view.x) / this.view.k, y: (r.height / 2 - this.view.y) / this.view.k };
  }
  zoomAt(f, e) {
    const r = this.svg.getBoundingClientRect();
    const cx = e ? e.clientX - r.left : r.width / 2, cy = e ? e.clientY - r.top : r.height / 2;
    const k = Math.min(3, Math.max(0.25, this.view.k * f));
    this.view.x = cx - (cx - this.view.x) * (k / this.view.k);
    this.view.y = cy - (cy - this.view.y) * (k / this.view.k);
    this.view.k = k; this.applyView();
  }
  fitView() {
    const pts = [...this.lab.nodes.map(n => [n.x, n.y]), ...(this.lab.notes || []).map(n => [n.x + 100, n.y + 30])];
    const r = this.svg.getBoundingClientRect();
    if (!pts.length || !r.width) { this.view = { x: r.width / 2, y: r.height / 2, k: 1 }; return this.applyView(); }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minx = Math.min(...xs) - 90, maxx = Math.max(...xs) + 90, miny = Math.min(...ys) - 80, maxy = Math.max(...ys) + 100;
    const k = Math.min(1.4, Math.max(0.3, Math.min(r.width / (maxx - minx), r.height / (maxy - miny))));
    this.view = { k, x: (r.width - (maxx - minx) * k) / 2 - minx * k, y: (r.height - (maxy - miny) * k) / 2 - miny * k };
    this.applyView();
  }
  setTool(t) {
    this.tool = t; this.pending = null; this.sim.pick = null;
    this.root.querySelector('#gTemp').querySelectorAll(':scope > :not(.env)').forEach(x => x.remove());
    this.root.querySelectorAll('#ptbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === (t || 'select')));
    this.svg.classList.toggle('tooling', !!t && t !== 'cable' && !t.startsWith('add:'));
    this.svg.classList.toggle('placing', !!t && t.startsWith('add:'));
    this.svg.classList.toggle('linking', t === 'cable');
    const h = this.root.querySelector('#hint');
    if (t === 'cable') { h.textContent = 'Mode kabel: klik perangkat pertama lalu pilih port. Esc untuk batal'; h.classList.remove('hidden'); }
    else if (t && t.startsWith('add:')) { h.textContent = `Klik di kanvas untuk menaruh ${this.tpl[t.slice(4)].label}. Esc untuk batal`; h.classList.remove('hidden'); }
    else if (t) {
      const msg = { inspect: 'Inspect: klik perangkat untuk melihat tabel routing/ARP/MAC', delete: 'Delete: klik objek yang akan dihapus', pdu: 'PDU sederhana: klik perangkat sumber lalu tujuan',
        'shape:text': 'Klik di kanvas untuk menaruh teks', 'shape:rect': 'Tarik di kanvas untuk menggambar persegi', 'shape:ellipse': 'Tarik di kanvas untuk menggambar elips',
        'shape:line': 'Tarik di kanvas untuk menggambar garis', 'shape:image': 'Klik di kanvas untuk menaruh gambar' }[t];
      if (msg) { h.textContent = msg + '. Esc untuk batal'; h.classList.remove('hidden'); } else h.classList.add('hidden');
    }
    else h.classList.add('hidden');
  }

  // ---------------------------------------------------------------- mouse
  onDown(e) {
    if (e.button !== 0) return;
    this.closePop();
    const nodeEl = e.target.closest('.node'), linkEl = e.target.closest('.link'), noteEl = e.target.closest('.note');
    const p = this.world(e), T = this.tool || '';
    if (e.target.classList.contains('rsz') && noteEl) {
      const n = this.lab.notes.find(x => x.id === +noteEl.dataset.id);
      this.drag = { kind: 'resize', obj: n, sx: p.x, sy: p.y, w: n.w, h: n.h, moved: false }; return;
    }
    if (T.startsWith('shape:')) {
      const kind = T.slice(6);
      if (kind === 'image') { this.setTool(null); return this.pickImage(p); }
      if (kind === 'text') { this.setTool(null); const n = this.addShape('text', p); return this.select('note', n.id, true); }
      const n = this.addShape(kind, p, { w: 0, h: 0 });
      this.drag = { kind: 'create', obj: n, sx: p.x, sy: p.y, moved: false }; return;
    }
    if (T === 'inspect') { if (nodeEl) this.inspectMenu(this.nodeById(+nodeEl.dataset.id), e); return; }
    if (T === 'pdu') { if (nodeEl) this.pduPick(this.nodeById(+nodeEl.dataset.id)); return; }
    if (T === 'delete') {
      const el = nodeEl || linkEl || noteEl;
      if (el) { const kind = nodeEl ? 'node' : linkEl ? 'link' : 'note'; this.select(kind, kind === 'link' ? el.dataset.id : +el.dataset.id); this.deleteSel(); }
      return;
    }
    if (nodeEl) {
      const n = this.nodeById(+nodeEl.dataset.id);
      if (this.tool === 'cable') return this.pickPort(n, e);
      if (e.target.closest('.plug')) { e.preventDefault(); this.drag = { kind: 'plug', from: n, moved: false }; return; }
      this.select('node', n.id);
      this.drag = { kind: 'node', obj: n, ox: n.x - p.x, oy: n.y - p.y, moved: false };
      return;
    }
    if (noteEl) {
      const n = this.lab.notes.find(x => x.id === +noteEl.dataset.id);
      this.select('note', n.id);
      this.drag = { kind: 'note', obj: n, ox: n.x - p.x, oy: n.y - p.y, moved: false };
      return;
    }
    if (linkEl && this.tool !== 'cable') return this.select('link', linkEl.dataset.id);
    if (this.tool && this.tool.startsWith('add:')) { this.addNode(this.tool.slice(4), p.x, p.y); if (!e.shiftKey) this.setTool(null); return; }
    if (this.tool === 'cable' && this.pending) { this.setTool('cable'); return; }
    this.select(null);
    this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
    this.svg.classList.add('panning');
  }
  onMove(e) {
    const d = this.drag;
    if (d && (d.kind === 'resize' || d.kind === 'create')) {
      const p = this.world(e), n = d.obj; d.moved = true;
      if (d.kind === 'resize') { n.w = Math.round(d.w + p.x - d.sx); n.h = Math.round(d.h + p.y - d.sy); if (n.kind !== 'line') { n.w = Math.max(10, n.w); n.h = Math.max(10, n.h); } }
      else if (n.kind === 'line') { n.w = Math.round(p.x - d.sx); n.h = Math.round(p.y - d.sy); }
      else { n.x = Math.round(Math.min(d.sx, p.x)); n.y = Math.round(Math.min(d.sy, p.y)); n.w = Math.round(Math.abs(p.x - d.sx)); n.h = Math.round(Math.abs(p.y - d.sy)); }
      this.drawNotes(); return;
    }
    if (d && d.kind === 'plug') {
      const p = this.world(e); d.moved = true;
      this.root.querySelector('#gTemp').innerHTML = `<line x1="${d.from.x}" y1="${d.from.y}" x2="${p.x}" y2="${p.y}" stroke="#F39C12" stroke-width="2.2" stroke-dasharray="6 4"/>`;
      return;
    }
    if (this.pending) {
      const a = this.nodeById(this.pending.node), p = this.world(e);
      this.root.querySelector('#gTemp').innerHTML = `<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" stroke="#F39C12" stroke-width="2.2" stroke-dasharray="6 4"/>`;
    }
    if (!d) return;
    if (d.kind === 'pan') { this.view.x = d.vx + e.clientX - d.sx; this.view.y = d.vy + e.clientY - d.sy; this.applyView(); return; }
    const p = this.world(e);
    const snap = v => e.altKey ? v : Math.round(v / 12) * 12;
    d.obj.x = snap(p.x + d.ox); d.obj.y = snap(p.y + d.oy); d.moved = true;
    if (d.kind === 'node') {
      this.root.querySelector(`.node[data-id="${d.obj.id}"]`)?.setAttribute('transform', `translate(${d.obj.x},${d.obj.y})`);
      this.drawLinks();
    } else this.drawNotes();
  }
  onUp(e) {
    const d = this.drag;
    if (d && (d.kind === 'resize' || d.kind === 'create')) {
      this.drag = null;
      const n = d.obj;
      if (d.kind === 'create') {
        if (Math.hypot(n.w, n.h) < 8) Object.assign(n, n.kind === 'line' ? { w: 160, h: 0 } : { w: n.kind === 'rect' ? 200 : 180, h: 120 });
        if (!e.shiftKey) this.setTool(null);
        this.drawNotes(); this.save(); return this.edit('note', n.id);
      }
      this.save(); this.inspect(); return;
    }
    if (d && d.kind === 'plug') {
      this.drag = null; this.root.querySelector('#gTemp').innerHTML = '';
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.node');
      const b = el && this.root.contains(el) && this.nodeById(+el.dataset.id);
      if (b && b.id !== d.from.id) this.connectModal(d.from, b);
      else if (!d.moved) { this.setTool('cable'); this.pickPort(d.from, e); }
      else App.toast('Lepaskan di atas node tujuan untuk membuat koneksi');
      return;
    }
    if (d && d.moved) this.save();
    this.drag = null; this.svg && this.svg.classList.remove('panning');
  }
  onDbl(e) {
    const nodeEl = e.target.closest('.node'), noteEl = e.target.closest('.note'), linkEl = e.target.closest('.link');
    if (nodeEl) this.openConsole(this.nodeById(+nodeEl.dataset.id));
    else if (noteEl) this.select('note', +noteEl.dataset.id, true);
    else if (linkEl) this.edit('link', linkEl.dataset.id);
  }
  onCtx(e) {
    e.preventDefault();
    const nodeEl = e.target.closest('.node'), linkEl = e.target.closest('.link'), noteEl = e.target.closest('.note');
    if (nodeEl) { const n = this.nodeById(+nodeEl.dataset.id); this.select('node', n.id); return this.nodeMenu(n, e.clientX, e.clientY); }
    if (linkEl) {
      const id = linkEl.dataset.id; this.select('link', id);
      return this.menu(e.clientX, e.clientY, ['Koneksi', ['Edit', () => this.edit('link', id), '2×klik', false, 'edit'], ['Hapus koneksi', () => this.deleteSel(), 'Del', false, 'trash']]);
    }
    if (noteEl) {
      const id = +noteEl.dataset.id; this.select('note', id);
      return this.menu(e.clientX, e.clientY, ['Teks', ['Edit', () => this.select('note', id, true), '2×klik', false, 'edit'], ['Hapus', () => this.deleteSel(), 'Del', false, 'trash']]);
    }
    const p = this.world(e);
    this.menu(e.clientX, e.clientY, ['Tambah objek baru',
      ['Node…', () => this.addNodeModal(p), '', false, 'nodes'],
      ['Teks / catatan', () => this.addNote(p.x, p.y), '', false, 'note'],
      ['Mode kabel', () => this.setTool('cable'), 'C', false, 'cable'],
      '-', ['Nyalakan semua node', () => this.power('start'), '', false, 'play'], ['Matikan semua node', () => this.power('stop'), '', false, 'stop'],
      '-', ['Pas layar', () => this.fitView(), '', false, 'fit'], ['Refresh topologi', () => this.reloadLab(), '', false, 'refresh']]);
  }
  onKey(e) {
    if (e.key === 'F1') { e.preventDefault(); return Guide.toggle(); }
    if (e.target.closest('input,textarea,select,.cwin,.guide,.modal')) return;
    if (this.mode === '3d') return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); return this.undo(); }
    if (mod || e.altKey) return;
    if (e.shiftKey && (k === 'S' || k === 'R')) return this.setSimMode(k === 'S');
    if (k === 'Escape') { if (!this.tool && this.insOpen) { this.insOpen = false; this.inspect(); } this.setTool(null); this.closePop(); }
    else if (k === 'Delete' || k === 'Backspace') { if (this.sel) { e.preventDefault(); this.deleteSel(); } }
    else if (k === 'c' || k === 'C') this.setTool(this.tool === 'cable' ? null : 'cable');
    else if (k === 'n' || k === 'N') this.setTool('shape:text');
    else if (k === 'i' || k === 'I') this.setTool(this.tool === 'inspect' ? null : 'inspect');
    else if (k === 'd' || k === 'D') this.setTool(this.tool === 'delete' ? null : 'delete');
    else if (k === 'p' || k === 'P') this.setTool('pdu');
    else if (k === ' ' && this.sim.on) { e.preventDefault(); this.sim.playing ? this.simPause() : this.simPlay(); }
    else if (k === '+' || k === '=') this.zoomAt(1.2);
    else if (k === '-') this.zoomAt(1 / 1.2);
    else if (k === 'f' || k === 'F') this.fitView();
    else if (k === '?') this.shortcutsModal();
  }

  // ---------------------------------------------------------------- popups & sidebar
  closePop() { App.closePop(); }
  menu(x, y, items) { return App.menu(x, y, items); }
  sideMenu(b, items) {
    // keep the sidebar expanded while its flyout is open
    const sb = this.root.querySelector('.sidebar'), m = this.menu(226, b.getBoundingClientRect().top, items);
    sb.classList.add('open');
    const iv = setInterval(() => { if (!m.isConnected) { sb.classList.remove('open'); clearInterval(iv); } }, 150);
  }
  addObjMenu(b) {
    this.sideMenu(b, ['Tambah objek baru',
      ['Node', () => this.addNodeModal(), '', false, 'nodes'],
      ['Kabel / koneksi', () => this.setTool('cable'), 'C', false, 'cable'],
      ['Catatan (sticky)', () => this.addNote(), '', false, 'note'],
      '-', ['Teks bebas', () => this.setTool('shape:text'), 'N', false, 'note'],
      ['Persegi', () => this.setTool('shape:rect'), '', false, 'rect'],
      ['Elips', () => this.setTool('shape:ellipse'), '', false, 'ellipse'],
      ['Garis', () => this.setTool('shape:line'), '', false, 'line'],
      ['Gambar / background', () => this.pickImage(), '', false, 'image']]);
  }
  moreMenu(b) {
    this.sideMenu(b, ['Aksi lainnya',
      ['Nyalakan semua node', () => this.power('start'), '', false, 'play'],
      ['Matikan semua node', () => this.power('stop'), '', false, 'stop'],
      ['Wipe semua node', () => this.power('wipe'), '', false, 'wipe'],
      ['Console ke semua node', () => this.lab.nodes.filter(n => this.running(n.id) && this.tpl[n.type]?.kind !== 'cloud').forEach(n => Consoles.open(this.id, n)), '', false, 'term'],
      '-', ['Ekspor lab', () => { location.href = `/api/labs/${this.id}/export`; }, '', false, 'down'],
      ['Ekspor semua config (.txt)', () => { location.href = `/api/labs/${this.id}/configs`; }, '', false, 'file'],
      ['Timer lab', () => this.workbookPanel(true), '', false, 'clock'],
      ['Undo', () => this.undo(), 'Ctrl+Z', false, 'wipe'],
      ['Pintasan keyboard', () => this.shortcutsModal(), '?', false, 'help'],
      ['Edit lab', () => this.labDetails(), '', false, 'edit']]);
  }
  nodeMenu(n, x, y) {
    const run = this.running(n.id), k = this.tpl[n.type].kind;
    this.menu(x, y, [n.name,
      ['Start', () => this.power('start', [n.id]), '', run || k === 'cloud' || k === 'remote', 'play'],
      ['Stop', () => this.power('stop', [n.id]), '', !run || k === 'cloud' || k === 'remote', 'stop'],
      ['Wipe', () => this.power('wipe', [n.id]), '', k === 'cloud' || k === 'remote', 'wipe'],
      ['Console', () => this.openConsole(n), '2×klik', k === 'cloud', 'term'],
      ['Lihat running-config', () => this.showConfig(n), '', k !== 'sim', 'file'],
      '-',
      ['Hubungkan kabel dari sini', () => { this.setTool('cable'); this.pickPort(n, { clientX: x, clientY: y }); }, '', false, 'cable'],
      ['Edit', () => this.edit('node', n.id), '', false, 'edit'],
      ['Hapus', () => this.deleteSel(), 'Del', false, 'trash']]);
  }
  pickPort(n, e) {
    const used = {};
    this.lab.links.forEach(l => { used[l.a.node + '|' + l.a.iface] = l.b; used[l.b.node + '|' + l.b.iface] = l.a; });
    if (this.pending && this.pending.node === n.id) return;
    const items = [`${n.name} — pilih port`];
    (n.ifaces || []).forEach(i => {
      const u = used[n.id + '|' + i];
      items.push([i, () => this.portChosen(n, i), u ? '→ ' + (this.nodeById(u.node)?.name || '') : '', !!u]);
    });
    if (items.length === 1) items.push(['Tidak ada port', () => {}, '', true]);
    this.menu(e.clientX, e.clientY, items);
  }
  guessStyle(a, ia, b, ib) {
    const ta = this.tpl[a.type], tb = this.tpl[b.type];
    return ia.includes('Gigabit') && ib.includes('Gigabit') && ta.category === 'Switches' && tb.category === 'Switches' ? 'fiber' : 'copper';
  }
  makeLink(a, ia, b, ib, style) {
    this.lab.links.push({ id: 'L' + Date.now().toString(36), a: { node: a.id, iface: ia }, b: { node: b.id, iface: ib }, style: style || this.guessStyle(a, ia, b, ib) });
    this.drawLinks(); this.save();
  }
  portChosen(n, iface) {
    if (!this.pending) {
      this.pending = { node: n.id, iface };
      const h = this.root.querySelector('#hint'); h.textContent = `${n.name} ${shortIf(iface)} → klik perangkat tujuan`; h.classList.remove('hidden');
      return;
    }
    const a = this.pending;
    this.pending = null;
    this.setTool('cable');
    this.makeLink(this.nodeById(a.node), a.iface, n, iface);
  }
  connectModal(a, b) {
    const used = {};
    this.lab.links.forEach(l => { used[l.a.node + '|' + l.a.iface] = l.b; used[l.b.node + '|' + l.b.iface] = l.a; });
    const free = n => (n.ifaces || []).filter(i => !used[n.id + '|' + i]);
    if (!free(a).length || !free(b).length) return App.toast(`Tidak ada port kosong di ${!free(a).length ? a.name : b.name}`, true);
    const opts = n => (n.ifaces || []).map(i => { const u = used[n.id + '|' + i]; return `<option value="${esc(i)}" ${u ? 'disabled' : ''}>${esc(i)}${u ? ' → ' + esc(this.nodeById(u.node)?.name || '') : ''}</option>`; }).join('');
    App.modal(`<h3>Tambah koneksi antara ${esc(a.name)} dan ${esc(b.name)}</h3>
      <div class="conn"><div class="side">${deviceIcon(a.type, 44)}<b>${esc(a.name)}</b><select class="input" id="cA" aria-label="Port ${esc(a.name)}">${opts(a)}</select></div>
        <div class="side">${deviceIcon(b.type, 44)}<b>${esc(b.name)}</b><select class="input" id="cB" aria-label="Port ${esc(b.name)}">${opts(b)}</select></div></div>
      <div class="field" style="margin-top:12px"><label for="cS">Jenis kabel</label><select class="input" id="cS"><option value="copper">Tembaga (UTP)</option><option value="fiber">Fiber optik</option></select></div>
      <div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="cGo">Simpan</button></div>`, false, (m, close) => {
      const sa = m.querySelector('#cA'), sb = m.querySelector('#cB'), ss = m.querySelector('#cS');
      sa.value = free(a)[0]; sb.value = free(b)[0];
      const guess = () => { ss.value = this.guessStyle(a, sa.value, b, sb.value); };
      sa.onchange = sb.onchange = guess; guess();
      m.querySelector('#cGo').onclick = () => { close(); this.makeLink(a, sa.value, b, sb.value, ss.value); };
    });
  }
  addNodeModal(p) {
    const caps = App.sys?.caps || {};
    const groups = {};
    App.templates.forEach(t => (groups[t.category] = groups[t.category] || []).push(t));
    const locked = t => !!(caps.avail && caps.avail[t.type] === false);
    const cats = [...CAT_ORDER.filter(g => groups[g]), ...Object.keys(groups).filter(g => !CAT_ORDER.includes(g))];
    const opts = cats.map(g => `<optgroup label="${esc(CAT_NAME[g] || g)}">${groups[g].map(t => `<option value="${t.type}" ${locked(t) ? 'disabled' : ''}>${esc(t.label)}${t.model ? ' — ' + esc(t.model) : ''}${locked(t) ? (t.type === 'netns' ? ' (hanya server Linux + root)' : ' (QEMU belum terpasang)') : ''}</option>`).join('')}</optgroup>`).join('');
    App.modal(`<h3>Tambah node baru</h3>
      <div class="field"><label for="anT">Template</label><select class="input" id="anT">${opts}</select></div>
      <div class="an-prev" id="anPrev"></div>
      <div class="row"><div class="field" style="width:130px"><label for="anN">Jumlah node</label><input class="input" id="anN" type="number" min="1" max="20" value="1"></div>
        <div class="field grow"><label for="anName">Nama / prefix</label><input class="input" id="anName"></div></div>
      <p class="muted" style="margin:0;font-size:12.5px">RAM, image, IP dan port lainnya bisa diubah lewat klik kanan node → Edit.</p>
      <div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="anGo">Simpan</button></div>`, false, (m, close) => {
      const sel = m.querySelector('#anT'), nm = m.querySelector('#anName');
      if (this.lastType && this.tpl[this.lastType] && !locked(this.tpl[this.lastType])) sel.value = this.lastType;
      const upd = () => { const t = this.tpl[sel.value]; if (!t) return; m.querySelector('#anPrev').innerHTML = `${deviceIcon(t.type, 44)}<div><b>${esc(t.label)}${t.model ? ' — ' + esc(t.model) : ''}</b><p>${esc(t.desc || '')}</p></div>`; nm.value = PREFIX[t.type] || 'N'; };
      sel.onchange = upd; upd();
      m.querySelector('#anGo').onclick = () => {
        if (!this.tpl[sel.value]) return;
        this.lastType = sel.value; close();
        this.addNodes(sel.value, p, Math.max(1, Math.min(20, +m.querySelector('#anN').value || 1)), nm.value.trim());
      };
    });
  }

  // ---------------------------------------------------------------- sidebar dialogs
  nodesModal() {
    App.modal(`<h3>Node yang dikonfigurasi</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>ID</th><th>Nama</th><th>Template</th><th>Status</th><th>IP</th><th>Port</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="nmBody"></tbody></table></div>
      <div class="modal-foot"><button class="btn success" id="nmStart">${UI.play} Nyalakan semua</button><button class="btn" id="nmStop">${UI.stop} Matikan semua</button><span class="grow"></span><button class="btn primary" id="nmAdd">${UI.plus} Tambah node</button><button class="btn" data-close>Tutup</button></div>`, true, (m, close) => {
      const render = () => {
        m.querySelector('#nmBody').innerHTML = this.lab.nodes.map(n => {
          const t = this.tpl[n.type] || {}, k = t.kind, run = this.running(n.id), pw = k === 'sim' || k === 'real';
          const st = k === 'cloud' ? 'selalu aktif' : k === 'remote' ? 'eksternal' : run ? 'menyala' : 'mati';
          const ip = this.status?.nodes?.[n.id]?.ip || n.host?.ip || '';
          return `<tr data-id="${n.id}"><td>${n.id}</td><td><div class="fm-name">${deviceIcon(n.type, 22)}<span>${esc(n.name)}</span></div></td>
            <td>${esc(t.label || n.type)}<div class="muted" style="font-size:12px">${esc(t.model || '')}</div></td>
            <td><span class="badge ${run || k === 'cloud' ? 'on' : ''}">${st}</span></td><td class="mono">${esc(ip)}</td><td>${(n.ifaces || []).length}</td>
            <td style="text-align:right;white-space:nowrap">
              ${pw ? (run ? `<button class="btn xs" data-na="stop" title="Stop">${UI.stop}</button>` : `<button class="btn xs success" data-na="start" title="Start">${UI.play}</button>`) : ''}
              ${k !== 'cloud' ? `<button class="btn xs" data-na="console" title="Console">${UI.term}</button>` : ''}
              ${k === 'sim' || n.type === 'qemu' ? `<button class="btn xs" data-na="wipe" title="Wipe">${UI.wipe}</button>` : ''}
              <button class="btn xs" data-na="edit" title="Edit">${UI.edit}</button>
              <button class="btn xs danger" data-na="del" title="Hapus">${UI.trash}</button></td></tr>`;
        }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Belum ada node. Klik "Tambah node".</td></tr>';
        m.querySelectorAll('[data-na]').forEach(b => b.onclick = async () => {
          const id = +b.closest('tr').dataset.id, n = this.nodeById(id), a = b.dataset.na;
          if (a === 'start' || a === 'stop' || a === 'wipe') { await this.power(a, [id]); render(); }
          else if (a === 'console') { close(); this.openConsole(n); }
          else if (a === 'edit') { close(); this.edit('node', id); }
          else if (a === 'del') { this.select('node', id); this.deleteSel(); render(); }
        });
      };
      render();
      m.querySelector('#nmStart').onclick = async () => { await this.power('start'); render(); };
      m.querySelector('#nmStop').onclick = async () => { await this.power('stop'); render(); };
      m.querySelector('#nmAdd').onclick = () => { close(); this.addNodeModal(); };
    });
  }
  linksModal() {
    const word = { up: '<span class="yes">up</span>', down: '<span class="no">down</span>', wait: '<span style="color:var(--amber)">menunggu</span>', off: '<span class="muted">mati</span>' };
    App.modal(`<h3>Koneksi</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Dari</th><th>Port</th><th>Ke</th><th>Port</th><th>Jenis</th><th>Status</th><th></th></tr></thead><tbody id="lmBody"></tbody></table></div>
      <div class="modal-foot"><button class="btn" id="lmCable">${UI.cable} Mode kabel</button><span class="grow"></span><button class="btn" data-close>Tutup</button></div>`, true, (m, close) => {
      const render = () => {
        m.querySelector('#lmBody').innerHTML = this.lab.links.map(l => {
          const a = this.nodeById(l.a.node), b = this.nodeById(l.b.node), st = this.status?.links?.[l.id] || {};
          const wl = l.a.iface.startsWith('Wireless') || l.b.iface.startsWith('Wireless');
          return `<tr data-id="${esc(l.id)}"><td><b>${esc(a?.name)}</b></td><td class="mono">${esc(shortIf(l.a.iface))} ${word[st.a] || ''}</td><td><b>${esc(b?.name)}</b></td><td class="mono">${esc(shortIf(l.b.iface))} ${word[st.b] || ''}</td>
            <td>${wl ? 'wireless' : l.style === 'fiber' ? 'fiber' : 'tembaga'}</td><td>${st.mixed ? '<span style="color:var(--amber)">dokumentasi</span>' : (st.a === 'up' && st.b === 'up' ? '<span class="yes">aktif</span>' : '<span class="muted">tidak aktif</span>')}</td>
            <td style="text-align:right;white-space:nowrap"><button class="btn xs" data-la="edit" title="Edit">${UI.edit}</button> <button class="btn xs danger" data-la="del" title="Hapus">${UI.trash}</button></td></tr>`;
        }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Belum ada koneksi. Tarik ikon colokan oranye di node ke node lain.</td></tr>';
        m.querySelectorAll('[data-la]').forEach(b => b.onclick = () => {
          const id = b.closest('tr').dataset.id;
          if (b.dataset.la === 'edit') { close(); this.edit('link', id); }
          else { this.select('link', id); this.deleteSel(); render(); }
        });
      };
      render();
      m.querySelector('#lmCable').onclick = () => { close(); this.setTool('cable'); };
    });
  }
  configsModal() {
    const list = this.lab.nodes.filter(n => this.tpl[n.type]?.kind === 'sim');
    if (!list.length) return App.toast('Belum ada node simulasi yang memiliki konfigurasi');
    App.modal(`<h3>Startup-config</h3><div id="csBar" style="margin-bottom:10px"></div><div class="cfg2"><div class="lst">${list.map(n => `<div data-id="${n.id}">${deviceIcon(n.type, 20)}<span>${esc(n.name)}</span></div>`).join('')}</div>
      <div style="min-width:0"><div class="tabs"><button class="act" data-w="s">startup-config</button><button data-w="r">running-config</button></div><pre id="cfgPre">Pilih node di kiri.</pre></div></div>
      <div class="modal-foot"><button class="btn" id="cfgCopy">Salin</button><button class="btn primary" data-close>Tutup</button></div>`, true, m => {
      let cur = null, which = 's';
      const cache = {}, pre = m.querySelector('#cfgPre');
      const show = async () => {
        if (!cur) return;
        const key = cur + which;
        if (!(key in cache)) {
          pre.textContent = 'Memuat…';
          const r = await App.api('GET', `/api/labs/${this.id}/nodes/${cur}/config${which === 's' ? '?which=startup' : ''}`, null, true);
          cache[key] = r ? (r.text || '(kosong — belum ada write memory)') : '(tidak tersedia untuk node ini)';
        }
        pre.textContent = cache[key];
      };
      m.querySelectorAll('.lst [data-id]').forEach(d => d.onclick = () => { m.querySelectorAll('.lst [data-id]').forEach(x => x.classList.toggle('act', x === d)); cur = +d.dataset.id; show(); });
      m.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { m.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('act', x === b)); which = b.dataset.w; show(); });
      m.querySelector('#cfgCopy').onclick = () => { navigator.clipboard?.writeText(pre.textContent); App.toast('Disalin ke clipboard'); };
      const bar = m.querySelector('#csBar');
      this.configSetsUi(bar, () => cur);
      bar.addEventListener('reloadcfg', () => { Object.keys(cache).forEach(k => delete cache[k]); show(); });
      m.querySelector('.lst [data-id]').click();
    });
  }
  labDetails() {
    const by = {};
    this.lab.nodes.forEach(n => by[n.type] = (by[n.type] || 0) + 1);
    App.modal(`<h3>Detail lab</h3>
      <div class="field"><label for="ldN">Nama lab</label><input class="input" id="ldN" value="${esc(this.name)}"></div>
      <div class="field"><label for="ldD">Deskripsi</label><textarea class="input" id="ldD" rows="3" style="font-family:var(--f-body)">${esc(this.desc)}</textarea></div>
      <h5>Isi lab — ${this.lab.nodes.length} perangkat, ${this.lab.links.length} kabel</h5>
      <div class="iflist">${Object.entries(by).map(([t, c]) => `<div><span>${esc(this.tpl[t]?.label || t)}</span><span>${c}</span></div>`).join('') || '<div><span class="muted">Kosong — Tambah objek → Node</span></div>'}</div>
      <h5>Cara cepat</h5>
      <div class="tip">1. Sidebar kiri → <b>Tambah objek → Node</b> (atau klik kanan kanvas).<br>2. Arahkan kursor ke node, tarik <b>ikon colokan oranye</b> ke node tujuan, lalu pilih port.<br>3. <b>Aksi lainnya → Nyalakan semua node</b>, lalu klik ganda node untuk membuka console.<br>4. Di router: <span class="mono">en → conf t → int g0/0 → ip add … → no sh</span>.</div>
      <div class="tip"><b>Perangkat fisik.</b> Node <b>Perangkat Fisik</b> membuka console Telnet/SSH ke alat sungguhan dari OS apa pun. Di server Linux (sudo), node <b>Cloud</b> bisa di-bridge ke NIC sehingga VM QEMU satu jaringan dengan perangkat fisik; di Windows/macOS Cloud memberi akses NAT.</div>
      <div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="ldSave">Simpan</button></div>`, false, (m, close) => {
      m.querySelector('#ldSave').onclick = async () => {
        const name = m.querySelector('#ldN').value.trim() || this.name, description = m.querySelector('#ldD').value.trim();
        if (await App.api('POST', `/api/labs/${this.id}/meta`, { name, description })) { this.name = name; this.desc = description; this.showName(); close(); App.toast('Detail lab disimpan'); }
      };
    });
  }
  async statusModal() {
    const s = await App.loadSystem(true); if (!s) return;
    const act = this.lab.nodes.filter(n => this.tpl[n.type]?.kind !== 'cloud');
    App.modal(`<h3>Status</h3>${App.gauges(s)}
      <dl class="kv"><dt>Lab ini</dt><dd>${act.filter(n => this.running(n.id)).length} dari ${act.length} node menyala, ${this.lab.links.length} kabel</dd>
        <dt>Server</dt><dd>${esc(s.os || s.caps.os)} · ${s.cpus} core · uptime ${Math.floor(s.uptime / 3600)} jam ${Math.floor(s.uptime % 3600 / 60)} menit</dd>
        <dt>VM QEMU</dt><dd>${s.caps.avail?.qemu ? `<span class="yes">siap</span> — akselerasi ${esc(s.caps.accel)}` : 'belum tersedia'}</dd></dl>
      <div class="modal-foot"><button class="btn" id="stFull">Status sistem lengkap</button><button class="btn primary" data-close>Tutup</button></div>`, true, (m, close) => {
      m.querySelector('#stFull').onclick = () => { close(); location.hash = '#/system'; };
    });
  }

  // ---------------------------------------------------------------- model ops
  uniqueName(t) {
    const p = PREFIX[t] || 'N'; let i = 1;
    const names = new Set(this.lab.nodes.map(n => n.name));
    while (names.has(p + i)) i++;
    return p + i;
  }
  addNode(type, x, y) { this.addNodes(type, { x, y }, 1); }
  addNodes(type, p, count = 1, prefix = '') {
    const tpl = this.tpl[type]; if (!tpl) return;
    p = p || this.center();
    const names = new Set(this.lab.nodes.map(n => n.name)), pre = prefix || PREFIX[type] || 'N';
    let id = this.lab.nodes.reduce((m, n) => Math.max(m, n.id), 0);
    const perRow = Math.min(count, 6);
    for (let c = 0; c < count; c++) {
      let name = '';
      if (count === 1 && prefix && prefix !== PREFIX[type] && !names.has(prefix)) name = prefix;
      else { let i = 1; while (names.has(pre + i)) i++; name = pre + i; }
      names.add(name);
      const x = p.x + (c % 6 - (perRow - 1) / 2) * 96, y = p.y + Math.floor(c / 6) * 110;
      const props = JSON.parse(JSON.stringify(tpl.props || {}));
      this.lab.nodes.push({ id: ++id, type, name, x: Math.round(x / 12) * 12, y: Math.round(y / 12) * 12, props, ifaces: clientIfaces(tpl, props) || [] });
    }
    this.select('node', id);
    this.drawAll();
    this.save(true);
  }
  addNote(x, y) {
    const id = (this.lab.notes || []).reduce((m, n) => Math.max(m, n.id), 0) + 1;
    const p = x === undefined ? (() => { const c = this.center(); return { x: c.x - 60, y: c.y - 20 }; })() : { x, y };
    (this.lab.notes = this.lab.notes || []).push({ id, x: p.x, y: p.y, text: 'Catatan baru' });
    this.select('note', id, true); this.drawNotes(); this.save();
  }
  deleteSel() {
    const s = this.sel; if (!s) return;
    if (s.kind === 'node') {
      const n = this.nodeById(s.id);
      if (this.running(n.id) && this.tpl[n.type].kind !== 'cloud' && !confirm(`${n.name} masih menyala. Hapus?`)) return;
      this.lab.nodes = this.lab.nodes.filter(x => x.id !== s.id);
      this.lab.links = this.lab.links.filter(l => l.a.node !== s.id && l.b.node !== s.id);
      const w = Consoles.wins[this.id + ':' + s.id]; w && w.close();
    } else if (s.kind === 'link') this.lab.links = this.lab.links.filter(l => l.id !== s.id);
    else if (s.kind === 'note') this.lab.notes = this.lab.notes.filter(n => n.id !== s.id);
    this.select(null); this.drawAll(); this.save();
  }
  save(reload) {
    if (this.noUndo) { this.noUndo = false; this.lastSnap = this.snapshot(); } else this.pushUndo();
    clearTimeout(this.saveT);
    this.saveT = setTimeout(async () => {
      const body = {
        nodes: this.lab.nodes.map(n => ({ id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, props: n.props, size: n.size, lpos: n.lpos })),
        links: this.lab.links, notes: this.lab.notes || []
      };
      const r = await App.api('PUT', `/api/labs/${this.id}/topology`, body);
      if (r && r.status) { this.status = r.status; this.drawLinks(); this.drawNodes(); }
      if (reload) await this.reloadLab();
    }, reload ? 50 : 500);
  }
  async reloadLab() {
    const d = await App.api('GET', `/api/labs/${this.id}`); if (!d) return;
    const pos = Object.fromEntries(this.lab.nodes.map(n => [n.id, [n.x, n.y]]));
    this.lab = d.lab; this.status = d.status;
    this.lab.nodes.forEach(n => { if (pos[n.id]) [n.x, n.y] = pos[n.id]; });
    if (!this.drag) this.drawAll();
    this.inspect();
  }
  async refreshStatus() {
    if (!this.alive || document.hidden) return;
    const s = await App.api('GET', `/api/labs/${this.id}/status`, null, true);
    if (!s) return;
    const changed = JSON.stringify(s) !== JSON.stringify(this.status);
    this.status = s;
    if (changed && !this.drag) { this.drawNodes(); this.drawLinks(); this.statusbar(); if (this.sel?.kind === 'node' && !this.root.querySelector('#insp :focus')) this.inspect(); }
  }
  async power(action, ids) {
    const label = { start: 'Menyalakan', stop: 'Mematikan', wipe: 'Mereset' }[action];
    if (action === 'wipe' && !confirm(`Reset ${ids ? 'node' : 'semua node'} ke konfigurasi pabrik? Semua konfigurasi akan hilang.`)) return;
    App.toast(`${label} ${ids ? this.nodeById(ids[0]).name : 'semua node'}…`);
    const r = await App.api('POST', `/api/labs/${this.id}/power/${action}`, ids ? { nodes: ids } : {});
    if (!r) return;
    (r.errors || []).forEach(e => App.toast(e, true));
    this.status = r.status;
    if (action === 'wipe') await this.reloadLab(); else { this.drawNodes(); this.drawLinks(); this.statusbar(); this.inspect(); }
  }
  async openConsole(n) {
    const k = this.tpl[n.type].kind;
    if (k === 'cloud') return App.toast(`${this.tpl[n.type].label} adalah perangkat pasif, tidak memiliki console`);
    if ((k === 'sim' || k === 'real') && !this.running(n.id)) {
      await this.power('start', [n.id]);
      if (!this.running(n.id)) return;
    }
    Consoles.open(this.id, n);
  }
  async showConfig(n) {
    const r = await App.api('GET', `/api/labs/${this.id}/nodes/${n.id}/config`);
    const s = await App.api('GET', `/api/labs/${this.id}/nodes/${n.id}/config?which=startup`);
    if (!r) return;
    App.modal(`<h3>Konfigurasi ${esc(n.name)}</h3>
      <div class="tabs"><button class="act" data-w="r">running-config</button><button data-w="s">startup-config</button></div>
      <pre id="cfgPre">${esc(r.text)}</pre>
      <div class="modal-foot"><button class="btn" id="cfgCopy">Salin</button><button class="btn primary" data-close>Tutup</button></div>`, true, m => {
      const pre = m.querySelector('#cfgPre');
      m.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
        m.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('act', x === b));
        pre.textContent = b.dataset.w === 'r' ? r.text : (s?.text || '');
      });
      m.querySelector('#cfgCopy').onclick = () => { navigator.clipboard?.writeText(pre.textContent); App.toast('Disalin ke clipboard'); };
    });
  }
  animatePath(path, ok) {
    const pts = path.map(id => this.nodeById(id)).filter(Boolean);
    if (!pts.length) return;
    const g = this.root.querySelector('#gTemp');
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', 7); c.setAttribute('class', 'packet' + (ok ? '' : ' fail'));
    g.appendChild(c);
    let i = 0, t0 = performance.now();
    const seg = 380;
    const step = now => {
      const k = Math.min(1, (now - t0) / seg);
      const a = pts[i], b = pts[i + 1] || a;
      c.setAttribute('cx', a.x + (b.x - a.x) * k); c.setAttribute('cy', a.y + (b.y - a.y) * k);
      if (k >= 1) { i++; t0 = now; }
      if (i < pts.length - 1) requestAnimationFrame(step);
      else setTimeout(() => c.remove(), ok ? 500 : 1200);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- inspector (edit drawer)
  edit(kind, id) { this.insOpen = true; this.select(kind, id); }
  select(kind, id, focusText) {
    this.sel = kind ? { kind, id } : null;
    if (!kind) this.insOpen = false;
    if (focusText) this.insOpen = true;
    this.root.querySelectorAll('.node,.link,.note').forEach(el => el.classList.remove('sel'));
    if (kind) this.root.querySelector(`.${kind}[data-id="${CSS.escape(String(id))}"]`)?.classList.add('sel');
    this.inspect(focusText);
  }
  inspect(focusText) {
    const wrap = this.root.querySelector('#insp'); if (!wrap) return;
    const el = wrap.querySelector('#inspBody'), s = this.sel;
    let title = '';
    if (this.insOpen && s) {
      if (s.kind === 'node') { const n = this.nodeById(s.id); if (n) { title = 'Edit node'; this.inspectNode(el, n); } }
      else if (s.kind === 'link') { const l = this.lab.links.find(x => x.id === s.id); if (l) { title = 'Edit koneksi'; this.inspectLink(el, l); } }
      else if (s.kind === 'note') {
        const n = (this.lab.notes || []).find(x => x.id === s.id);
        if (n && n.kind && n.kind !== 'note') { title = 'Objek gambar'; this.inspectShape(el, n, focusText); }
        else if (n) {
          title = 'Teks / catatan';
          el.innerHTML = `<h5>Isi</h5><textarea class="input" id="noteTxt" rows="8">${esc(n.text)}</textarea>
            <div class="ins-actions"><button class="btn danger sm" id="noteDel">${UI.trash} Hapus catatan</button></div>`;
          const ta = el.querySelector('#noteTxt');
          ta.oninput = () => { n.text = ta.value; this.drawNotes(); this.save(); };
          el.querySelector('#noteDel').onclick = () => this.deleteSel();
          if (focusText) { ta.focus(); ta.select(); }
        }
      }
    }
    wrap.classList.toggle('hidden', !title);
    this.root.querySelector('#editor').classList.toggle('ins-open', !!title);
    if (title) wrap.querySelector('#inspTitle').textContent = title; else el.innerHTML = '';
  }
  ifRows(n) {
    const map = {};
    this.lab.links.forEach(l => {
      map[l.a.node + '|' + l.a.iface] = { peer: l.b, st: this.status?.links?.[l.id]?.a };
      map[l.b.node + '|' + l.b.iface] = { peer: l.a, st: this.status?.links?.[l.id]?.b };
    });
    return (n.ifaces || []).map(i => {
      const m = map[n.id + '|' + i];
      const col = m ? ({ up: 'var(--led)', down: 'var(--red)', wait: 'var(--amber)', off: 'var(--dim)' }[m.st] || 'var(--dim)') : 'var(--dim)';
      return `<div><span><span class="led" style="background:${col}"></span> ${esc(shortIf(i))}</span><span class="muted">${m ? esc((this.nodeById(m.peer.node)?.name || '') + ' ' + shortIf(m.peer.iface)) : '—'}</span></div>`;
    }).join('');
  }
  inspectNode(el, n) {
    const tpl = this.tpl[n.type], run = this.running(n.id), k = tpl.kind;
    const caps = App.sys?.caps || {};
    let html = `<h3>${deviceIcon(n.type, 30)} <input class="ed-title" id="nName" value="${esc(n.name)}" style="min-width:0;flex:1"></h3>
      <p class="muted" style="margin:6px 0 0">${esc(tpl.label)} — ${esc(tpl.model)}</p>
      <p style="margin:6px 0 0"><span class="led ${run && k !== 'cloud' ? 'on' : ''}"></span> ${k === 'cloud' ? 'Selalu aktif' : k === 'remote' ? 'Perangkat eksternal' : run ? 'Menyala' : 'Mati'}</p>
      <div class="ins-actions">
        ${k === 'sim' || k === 'real' ? (run ? `<button class="btn sm" data-a="stop">${UI.stop} Matikan</button>` : `<button class="btn sm primary" data-a="start">${UI.play} Nyalakan</button>`) : ''}
        ${k !== 'cloud' ? `<button class="btn sm" data-a="console">${UI.term} Console</button>` : ''}
        ${k === 'sim' && tpl.cli === 'ios' ? `<button class="btn sm" data-a="config">Config</button>` : ''}
        ${k === 'sim' || n.type === 'qemu' ? `<button class="btn sm" data-a="wipe" title="Reset pabrik">${UI.wipe}</button>` : ''}
        <button class="btn sm danger" data-a="del">Hapus</button>
      </div>`;
    if (tpl.cli === 'pc') {
      const h = n.host || {};
      html += `<h5>Konfigurasi IP (seperti tab Desktop di Packet Tracer)</h5>
        <div class="row" style="margin-bottom:10px"><label class="check"><input type="radio" name="ipm" value="static" ${!h.dhcp ? 'checked' : ''}> Static</label><label class="check"><input type="radio" name="ipm" value="dhcp" ${h.dhcp ? 'checked' : ''}> DHCP</label></div>
        <div id="ipStatic" class="${h.dhcp ? 'hidden' : ''}">
          <div class="field"><label>Alamat IPv4</label><input class="input mono" id="hIp" value="${esc(h.ip || '')}" placeholder="192.168.1.10"></div>
          <div class="field"><label>Subnet mask</label><input class="input mono" id="hMask" value="${esc(h.mask || '')}" placeholder="255.255.255.0"></div>
          <div class="field"><label>Default gateway</label><input class="input mono" id="hGw" value="${esc(h.gw || '')}" placeholder="192.168.1.1"></div>
          <div class="field"><label>DNS server</label><input class="input mono" id="hDns" value="${esc(h.dns || '')}"></div>
        </div>
        <div id="ipDhcp" class="${h.dhcp ? '' : 'hidden'} tip" style="margin-bottom:10px">IP saat ini: <b class="mono">${esc((this.status?.nodes?.[n.id]?.ip !== 'DHCP' && this.status?.nodes?.[n.id]?.ip) || h.ip || 'belum dapat')}</b>${h.gw ? ` gw <span class="mono">${esc(h.gw)}</span>` : ''}</div>
        <button class="btn sm" id="hApply">Terapkan IP</button>`;
      if (h.wifi) html += `<h5>WiFi</h5>
        <div class="row"><div class="field grow"><label>SSID</label><input class="input mono" id="wSsid" value="${esc(h.wifi.ssid || '')}"></div><div class="field grow"><label>Password</label><input class="input mono" id="wKey" value="${esc(h.wifi.key || '')}"></div></div>
        <button class="btn sm" id="wApply">Sambungkan</button> <span class="muted" style="font-size:12.5px">Kabelkan port Wireless0 ke port Wireless pada Access Point.</span>`;
      if (n.type === 'server') {
        const sv = h.services || {}, dh = sv.dhcp || {}, dn = sv.dns || {};
        html += `<h5>Layanan DHCP</h5>
          <label class="check"><input type="checkbox" id="sDhcpOn" ${dh.enabled ? 'checked' : ''}> Aktifkan DHCP server</label>
          <div class="row" style="margin-top:8px"><div class="field grow"><label>IP awal</label><input class="input mono" id="sStart" value="${esc(dh.start || '')}"></div><div class="field" style="width:80px"><label>Jumlah</label><input class="input mono" id="sMax" value="${esc(dh.max || 50)}"></div></div>
          <div class="row"><div class="field grow"><label>Gateway</label><input class="input mono" id="sGw" value="${esc(dh.gw || '')}"></div><div class="field grow"><label>DNS</label><input class="input mono" id="sDns" value="${esc(dh.dns || '')}"></div></div>
          <h5>Layanan DNS</h5>
          <label class="check"><input type="checkbox" id="sDnsOn" ${dn.enabled ? 'checked' : ''}> Aktifkan DNS server</label>
          <div class="field" style="margin-top:8px"><label>Record (satu per baris: nama ip)</label><textarea class="input" id="sRec" rows="5">${esc(Object.entries(dn.records || {}).map(([a, b]) => a + ' ' + b).join('\n'))}</textarea></div>
          <h5>Layanan HTTP (web)</h5>
          <label class="check"><input type="checkbox" id="sHttpOn" ${(sv.http || {}).enabled ? 'checked' : ''}> Aktifkan web server (port 80)</label>
          <div class="field" style="margin-top:8px"><label>index.html</label><textarea class="input" id="sHtml" rows="5">${esc((sv.http || {}).index || '')}</textarea></div>
          <button class="btn sm" id="sApply">Simpan layanan</button>`;
      }
      const scripts = h.scripts || {};
      html += `<h5>Script otomatis</h5>
        <div class="row"><select class="input" id="scSel">${Object.keys(scripts).map(k => `<option>${esc(k)}</option>`).join('')}<option value="__new">+ script baru…</option></select></div>
        <textarea class="input" id="scTxt" rows="8" style="margin-top:8px" placeholder="# contoh\necho Mulai cek\nrepeat 3\n  ping 192.168.1.1 -n 1\nend\nif ping 8.8.8.8\n  echo internet OK\nelse\n  echo internet putus\nend"></textarea>
        <div class="ins-actions"><button class="btn sm" id="scSave">Simpan</button><button class="btn sm primary" id="scRun">${UI.play} Jalankan</button><button class="btn sm danger" id="scDel">Hapus</button><button class="btn sm ghost" id="scHelp">Sintaks</button></div>
        <pre id="scOut" class="hidden" style="background:var(--ink);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:220px;overflow:auto;font:12px/1.4 var(--f-mono);white-space:pre-wrap"></pre>`;
    }
    if (k === 'real' || k === 'remote' || k === 'cloud') html += this.propsForm(n, caps);
    if (k === 'sim') {
      const targets = this.lab.nodes.filter(x => x.id !== n.id && this.tpl[x.type].kind === 'sim');
      html += `<h5>Uji ping cepat</h5><div class="row"><select class="input" id="pDst">${targets.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}<option value="ip">IP manual…</option></select>
        <button class="btn sm" id="pGo">${UI.ping} Ping</button></div><div id="pRes" class="muted" style="font-size:12.5px;margin-top:6px"></div>`;
    }
    html += `<h5>Tampilan</h5><div class="row"><div class="field grow"><label>Ukuran ikon</label><select class="input sm" id="nSize">${[[0.75, 'Kecil'], [1, 'Normal'], [1.25, 'Besar'], [1.6, 'Sangat besar']].map(([v, l]) => `<option value="${v}" ${(n.size || 1) == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field grow"><label>Posisi label</label><select class="input sm" id="nLpos">${[['bottom', 'Bawah'], ['top', 'Atas'], ['left', 'Kiri'], ['right', 'Kanan']].map(([v, l]) => `<option value="${v}" ${(n.lpos || 'bottom') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>`;
    html += `<h5>Port</h5><div class="iflist">${this.ifRows(n)}</div>`;
    html += `<p class="muted" style="font-size:12.5px;margin-top:14px">${esc(tpl.desc)}</p>`;
    el.innerHTML = html;
    const $ = s => el.querySelector(s);
    $('#nName').onchange = e => { n.name = e.target.value.trim() || n.name; this.drawNodes(); this.save(); };
    $('#nSize').onchange = e => { n.size = +e.target.value; this.drawNodes(); this.drawLinks(); this.save(); };
    $('#nLpos').onchange = e => { n.lpos = e.target.value; this.drawNodes(); this.save(); };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'start' || a === 'stop' || a === 'wipe') this.power(a, [n.id]);
      else if (a === 'console') this.openConsole(n);
      else if (a === 'config') this.showConfig(n);
      else if (a === 'del') this.deleteSel();
    });
    if ($('#hApply')) {
      el.querySelectorAll('[name=ipm]').forEach(r => r.onchange = () => { $('#ipStatic').classList.toggle('hidden', r.value === 'dhcp' && r.checked); $('#ipDhcp').classList.toggle('hidden', !(r.value === 'dhcp' && r.checked)); });
      $('#hApply').onclick = async () => {
        const dhcp = el.querySelector('[name=ipm]:checked').value === 'dhcp';
        const body = dhcp ? { dhcp: true } : { ip: $('#hIp').value, mask: $('#hMask').value, gw: $('#hGw').value, dns: $('#hDns').value };
        const r = await App.api('POST', `/api/labs/${this.id}/nodes/${n.id}/host`, body);
        if (r) { n.host = Object.assign(n.host || {}, r.host); App.toast(dhcp ? (r.host.ip ? `DHCP: ${r.host.ip}` : 'Belum mendapat IP dari DHCP (node harus menyala & ada server DHCP)') : 'IP diterapkan'); this.refreshStatus(); this.inspect(); }
      };
    }
    if ($('#wApply')) $('#wApply').onclick = async () => {
      const r = await App.api('POST', `/api/labs/${this.id}/nodes/${n.id}/host`, { wifi: { ssid: $('#wSsid').value.trim(), key: $('#wKey').value } });
      if (r) { n.host.wifi = r.host.wifi; App.toast('Pengaturan WiFi disimpan'); setTimeout(() => this.refreshStatus(), 300); }
    };
    if ($('#scSel')) {
      const scripts = (n.host.scripts = n.host.scripts || {});
      const sel = $('#scSel'), txt = $('#scTxt');
      const showSel = () => { txt.value = sel.value === '__new' ? '' : (scripts[sel.value] || ''); };
      sel.onchange = () => {
        if (sel.value === '__new') {
          const nm = (prompt('Nama script (huruf/angka/-/_):') || '').replace(/[^A-Za-z0-9_-]/g, '');
          if (nm) { scripts[nm] = ''; this.inspect(); setTimeout(() => { const s2 = this.root.querySelector('#scSel'); s2.value = nm; s2.onchange(); }, 0); return; }
        }
        showSel();
      };
      showSel();
      const persist = () => App.api('POST', `/api/labs/${this.id}/nodes/${n.id}/host`, { scripts });
      $('#scSave').onclick = async () => {
        let nm = sel.value;
        if (nm === '__new') { nm = (prompt('Nama script:') || '').replace(/[^A-Za-z0-9_-]/g, ''); if (!nm) return; }
        scripts[nm] = txt.value;
        if (await persist()) { App.toast(`Script "${nm}" disimpan. Di console: run ${nm}`); if (sel.value === '__new') this.inspect(); }
      };
      $('#scDel').onclick = async () => { if (sel.value !== '__new' && confirm('Hapus script ini?')) { delete scripts[sel.value]; await persist(); this.inspect(); } };
      $('#scHelp').onclick = () => Guide.open('script');
      $('#scRun').onclick = async () => {
        const out = $('#scOut'); out.classList.remove('hidden'); out.textContent = 'Menjalankan…';
        const r = await App.api('POST', `/api/labs/${this.id}/nodes/${n.id}/script`, { text: txt.value });
        out.textContent = r ? r.output : 'Gagal menjalankan script.';
        this.refreshStatus();
      };
    }
    if ($('#sApply')) $('#sApply').onclick = async () => {
      const records = {};
      $('#sRec').value.split('\n').map(s => s.trim().split(/\s+/)).filter(p => p.length === 2).forEach(([a, b]) => records[a] = b);
      const services = { dhcp: { enabled: $('#sDhcpOn').checked, start: $('#sStart').value.trim(), max: +$('#sMax').value || 50, gw: $('#sGw').value.trim(), dns: $('#sDns').value.trim() },
                         dns: { enabled: $('#sDnsOn').checked, records },
                         http: { enabled: $('#sHttpOn').checked, index: $('#sHtml').value } };
      const r = await App.api('POST', `/api/labs/${this.id}/nodes/${n.id}/host`, { services });
      if (r) { n.host.services = services; App.toast('Layanan server disimpan'); }
    };
    if ($('#pGo')) $('#pGo').onclick = async () => {
      let dst = $('#pDst').value;
      if (dst === 'ip') { dst = prompt('Alamat IP tujuan:'); if (!dst) return; }
      const r = await App.api('POST', `/api/labs/${this.id}/ping`, { src: n.id, dst });
      if (!r) return;
      const why = { unreachable: 'tidak ada rute', noarp: 'next-hop/host tidak menjawab ARP', filtered: 'diblok ACL', noreturn: 'jalur balik tidak ada', noroute: 'perangkat tidak melakukan routing', ttl: 'TTL habis (loop)' }[r.why] || r.why;
      $('#pRes').innerHTML = r.ok ? `<span class="yes">Berhasil</span> ke ${esc(r.dst)} (${r.path.length - 1} hop)` : `<span class="no">Gagal</span> ke ${esc(r.dst || '')}: ${esc(why || '')}${r.at ? ' di ' + esc(this.nodeById(r.at)?.name || '') : ''}`;
      if (r.path) this.animatePath(r.path, r.ok);
    };
    el.querySelectorAll('[data-prop]').forEach(inp => inp.onchange = () => {
      const key = inp.dataset.prop;
      n.props[key] = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? +inp.value : inp.value);
      const ifs = clientIfaces(tpl, n.props);
      if (ifs) {
        n.ifaces = ifs;
        this.lab.links = this.lab.links.filter(l => !((l.a.node === n.id && !ifs.includes(l.a.iface)) || (l.b.node === n.id && !ifs.includes(l.b.iface))));
        this.drawLinks();
      }
      this.save(); this.inspect();
    });
  }
  propsForm(n, caps) {
    const p = n.props || {};
    const inp = (key, label, type = 'text', ph = '') => `<div class="field"><label>${label}</label><input class="input mono" data-prop="${key}" type="${type}" value="${esc(p[key] ?? '')}" placeholder="${esc(ph)}"></div>`;
    if (n.type === 'qemu') {
      const imgs = caps.images || [];
      return `<h5>Mesin virtual</h5>
        <div class="field"><label>Image (folder di data/images/qemu)</label><select class="input" data-prop="image"><option value="">— pilih image —</option>${imgs.map(i => `<option ${i.name === p.image ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
        ${imgs.length ? '' : '<div class="tip">Belum ada image. Salin misalnya <span class="mono">vios-adventerprisek9.qcow2</span> ke <span class="mono">data/images/qemu/vios/</span> lalu muat ulang halaman.</div>'}
        <div class="row">${inp('ram', 'RAM (MB)', 'number')}${inp('cpus', 'vCPU', 'number')}${inp('nics', 'Jumlah NIC', 'number')}</div>
        <div class="field"><label>Model NIC</label><select class="input" data-prop="nic_model">${['e1000', 'virtio-net-pci', 'vmxnet3', 'rtl8139', 'i82559er'].map(m => `<option ${m === p.nic_model ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="tip">Akselerasi: <b>${esc(caps.accel || '-')}</b>. Jaringan VM: ${caps.netmode === 'tap' ? 'Linux bridge (kabel bisa diubah saat VM menyala)' : 'socket UDP antar VM — <b>setelah mengubah kabel, matikan lalu nyalakan ulang VM</b>'}.</div>
        ${caps.avail?.qemu ? '' : `<div class="tip">QEMU belum terpasang di server: <span class="mono">${{ windows: 'winget install SoftwareFreedomConservancy.QEMU', macos: 'brew install qemu', linux: 'sudo apt install qemu-system-x86 qemu-utils' }[caps.os] || 'pasang QEMU'}</span></div>`}`;
    }
    if (n.type === 'netns') return `<h5>Jaringan host Linux</h5>${inp('ip', 'IP/prefix', 'text', '192.168.1.50/24')}${inp('gw', 'Gateway', 'text', '192.168.1.1')}
        <label class="check"><input type="checkbox" data-prop="dhcp" ${p.dhcp ? 'checked' : ''}> Minta IP lewat DHCP saat start</label>
        <div class="tip">Perubahan berlaku saat node dinyalakan ulang. Console berisi shell bash asli: <span class="mono">ping, ip a, traceroute, curl, ssh</span>.</div>`;
    if (n.type === 'ap') return `<h5>WiFi</h5>${inp('ssid', 'SSID')}
        <div class="row"><div class="field grow"><label>Keamanan</label><select class="input" data-prop="security">${['WPA2-PSK', 'WPA3-SAE', 'Open'].map(m => `<option ${m === p.security ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field grow"><label>Band</label><select class="input" data-prop="band">${['2.4 GHz', '5 GHz'].map(m => `<option ${m === p.band ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
        ${inp('key', 'Password')}${inp('channel', 'Channel', 'number')}
        <div class="tip">Klien (laptop/HP/IoT/tablet) dikabel ke port <b>Wireless0–15</b> dengan kabel wireless, lalu isi SSID & password yang sama di klien. Port GigabitEthernet0 untuk uplink ke switch/router.</div>`;
    if (n.type === 'odp') return `<h5>Splitter</h5><div class="field"><label>Rasio splitter</label><select class="input" data-prop="ratio">${['1:2', '1:4', '1:8', '1:16'].map(m => `<option ${m === p.ratio ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="tip">Splitter pasif: tidak butuh listrik. Redaman tipikal 1:2 = 3.6 dB, 1:4 = 7.2 dB, 1:8 = 10.5 dB, 1:16 = 13.8 dB. Hitung power budget di modul <b>Peta 3D</b> atau panduan "fiber".</div>`;
    if (n.type === 'ont') return `<h5>ONT</h5>${inp('sn', 'Serial number (dokumentasi)', 'text', 'ZTEG12345678')}<div class="tip">Mode bridge: port PON ke ODP, LAN1–4 ke router/PC. Di OLT, VLAN layanan diatur per port GPON.</div>`;
    if (n.type === 'hub') return '';
    if (n.type === 'cloud' && caps.netmode !== 'tap') return `<h5>Cloud (server ${esc({ windows: 'Windows', macos: 'macOS', linux: 'Linux non-root' }[caps.os] || '')})</h5>
        <div class="tip">Di mode simulasi Cloud berfungsi sebagai hub. VM QEMU yang dikabel ke Cloud mendapat akses <b>NAT</b> ke jaringan & internet komputer server (DHCP 10.0.2.15, gateway 10.0.2.2) — cukup untuk update, ping ke router/perangkat di LAN, dan mengakses perangkat fisik lewat IP.</div>
        ${inp('hostfwd', 'Teruskan port server → SSH VM (opsional)', 'number', '2222')}
        <div class="tip">Bridge layer-2 langsung ke NIC fisik (VM satu segmen dengan switch fisik) hanya tersedia bila server berjalan di Linux dengan sudo. Untuk console perangkat fisik gunakan node <b>Perangkat Fisik</b> (Telnet/SSH) — berjalan di semua OS.</div>`;
    if (n.type === 'cloud') {
      const ifs = caps.interfaces || [];
      return `<h5>Jembatan ke jaringan fisik (mode real)</h5>
        <div class="field"><label>Target NIC / bridge di server</label><select class="input" data-prop="target"><option value="">— hanya hub simulasi —</option>${ifs.map(i => `<option value="${esc(i.name)}" ${i.name === p.target ? 'selected' : ''}>${esc(i.name)}${i.bridge ? ' (bridge)' : ''}</option>`).join('')}</select></div>
        <div class="tip">Di mode simulasi, Cloud berfungsi sebagai hub. Untuk perangkat sungguhan, pilih NIC kedua yang tersambung ke switch/router fisik, atau bridge seperti <span class="mono">pnet0</span> (lihat Panduan). Jangan memilih NIC utama server kecuali sudah dijadikan bridge.</div>`;
    }
    if (n.type === 'remote') {
      const hosts = App.sys?.neighbors || [];
      return `<h5>Perangkat fisik</h5><div class="field"><label>Alamat IP perangkat</label><input class="input mono" data-prop="host" list="remote-ip-${n.id}" value="${esc(p.host ?? '')}" placeholder="192.168.1.254">
        <datalist id="remote-ip-${n.id}">${hosts.map(h => `<option value="${esc(h.ip)}">${esc([h.interface, h.mac].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></div>
        <div class="row"><div class="field grow"><label>Protokol</label><select class="input" data-prop="protocol">${['telnet', 'ssh'].map(m => `<option ${m === p.protocol ? 'selected' : ''}>${m}</option>`).join('')}</select></div>${inp('port', 'Port', 'number')}</div>
        ${inp('username', 'Username (SSH)')}${inp('ports', 'Nama port (pisahkan koma)', 'text', 'Gi0/0,Gi0/1')}
        <div class="tip">Pilih alamat dari cache neighbor Windows atau masukkan IP sendiri. Console dibuka dari server ke perangkat ini; akses SSH/Telnet tetap bergantung pada konfigurasi dan firewall perangkat.${caps.asyncssh ? '' : ' Untuk SSH pasang dulu: <span class="mono">pip install asyncssh</span>.'}</div>`;
    }
    return '';
  }
  inspectLink(el, l) {
    const a = this.nodeById(l.a.node), b = this.nodeById(l.b.node), st = this.status?.links?.[l.id] || {};
    const word = s => ({ up: '<span class="yes">up</span>', down: '<span class="no">shutdown</span>', wait: '<span style="color:var(--amber)">menunggu ujung lain</span>', off: '<span class="muted">mati</span>' }[s] || '—');
    el.innerHTML = `<h3>Kabel</h3>
      <dl class="kv" style="margin-top:12px"><dt>${esc(a?.name)}</dt><dd class="mono">${esc(l.a.iface)} ${word(st.a)}</dd><dt>${esc(b?.name)}</dt><dd class="mono">${esc(l.b.iface)} ${word(st.b)}</dd></dl>
      ${st.mixed ? '<div class="tip">Kabel antara node simulasi dan node real hanya bersifat dokumentasi. Untuk lalu lintas sungguhan, sambungkan node real (QEMU/Linux/Cloud) satu sama lain.</div>' : ''}
      <h5>Jenis kabel</h5><div class="row"><label class="check"><input type="radio" name="cs" value="copper" ${l.style !== 'fiber' ? 'checked' : ''}> Tembaga</label><label class="check"><input type="radio" name="cs" value="fiber" ${l.style === 'fiber' ? 'checked' : ''}> Fiber</label></div>
      <h5>Desain kabel</h5>
      <div class="row"><div class="field grow"><label>Warna</label><input type="color" class="input sm" id="lCol" value="${esc(l.color || '#3B4652')}"></div>
        <div class="field grow"><label>Gaya garis</label><select class="input sm" id="lDash">${[['', 'Solid'], ['dashed', 'Putus-putus'], ['dotted', 'Titik-titik']].map(([v, t]) => `<option value="${v}" ${(l.dash || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field" style="width:76px"><label>Tebal</label><input type="number" min="1" max="6" class="input sm" id="lW" value="${l.width || 2}"></div></div>
      <button class="btn xs" id="lReset">Kembalikan default</button>
      <div class="ins-actions"><button class="btn danger sm" id="lDel">Hapus kabel</button></div>`;
    el.querySelectorAll('[name=cs]').forEach(r => r.onchange = () => { l.style = r.value; this.drawLinks(); this.save(); });
    el.querySelector('#lCol').oninput = e => { l.color = e.target.value; this.drawLinks(); this.save(); };
    el.querySelector('#lDash').onchange = e => { l.dash = e.target.value || undefined; this.drawLinks(); this.save(); };
    el.querySelector('#lW').onchange = e => { l.width = Math.max(1, Math.min(6, +e.target.value || 2)); this.drawLinks(); this.save(); };
    el.querySelector('#lReset').onclick = () => { delete l.color; delete l.dash; delete l.width; this.drawLinks(); this.save(); this.inspect(); };
    el.querySelector('#lDel').onclick = () => this.deleteSel();
  }
}
