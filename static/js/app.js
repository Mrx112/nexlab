/* NexLab app shell: auth, routing, pages */
const App = {
  me: null, templates: null, sys: null, editor: null,

  async api(method, url, body, quiet) {
    try {
      const r = await fetch(url, {
        method, credentials: 'same-origin',
        headers: Object.assign({ 'X-NexLab': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && !url.startsWith('/api/login')) { if (!quiet) this.showAuth(); return null; }
      if (!r.ok) { if (!quiet) this.toast(d.error || `Gagal (${r.status})`, true); return null; }
      return d;
    } catch (e) { if (!quiet) this.toast('Server tidak dapat dihubungi', true); return null; }
  },
  toast(msg, bad) {
    const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), bad ? 6000 : 3200);
  },
  modal(html, wide, init) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const f = bg.querySelector('input,select,textarea,button'); f && f.focus();
    init && init(bg.querySelector('.modal'), close);
    return close;
  },
  icons(root) {
    (root || document).querySelectorAll('[data-ico]').forEach(el => {
      if (el.dataset.icoDone) return; el.dataset.icoDone = 1;
      const ic = UI[el.dataset.ico] || '';
      if (el.childNodes.length) el.innerHTML = ic + `<span>${el.innerHTML}</span>`; else el.innerHTML = ic;
    });
  },
  closePop() { document.querySelectorAll('.pop').forEach(p => p.remove()); },
  // items: 'Header' | '-' | [label, fn, key, disabled, icon]
  menu(x, y, items) {
    this.closePop();
    const m = document.createElement('div'); m.className = 'pop';
    items.forEach(it => {
      if (it === '-') { m.appendChild(document.createElement('hr')); return; }
      if (typeof it === 'string') { const h = document.createElement('div'); h.className = 'hd'; h.textContent = it; m.appendChild(h); return; }
      const [label, fn, k, dis, ic] = it;
      const d = document.createElement('div'); d.className = 'mi' + (dis ? ' dis' : '');
      d.innerHTML = `<span class="ic">${ic ? UI[ic] || '' : ''}</span><span class="lb">${esc(label)}</span><span class="k">${esc(k || '')}</span>`;
      d.onclick = () => { this.closePop(); fn(); };
      m.appendChild(d);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
    setTimeout(() => addEventListener('mousedown', function h(ev) { if (!ev.target.closest('.pop')) { m.remove(); removeEventListener('mousedown', h); } }), 0);
    return m;
  },
  gauge(label, pct, sub, center, color) {
    const c = 2 * Math.PI * 42, p = Math.max(0, Math.min(100, pct || 0));
    const col = color || (p > 85 ? '#D9534F' : p > 65 ? '#F0AD4E' : '#1F6FB5');
    return `<div class="gauge"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="gg-bg"/><circle cx="50" cy="50" r="42" class="gg-fg" stroke="${col}" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
      <text x="50" y="57" text-anchor="middle" class="gg-val">${esc(center ?? Math.round(p) + '%')}</text></svg><div class="gg-lbl">${esc(label)}</div><div class="gg-sub">${esc(sub)}</div></div>`;
  },
  gauges(s) {
    const used = s.mem_total - s.mem_avail, pct = (a, b) => b ? a / b * 100 : 0, l0 = +((s.load || [])[0]) || 0;
    return `<div class="gauges">${this.gauge('CPU', pct(l0, s.cpus || 1), `${s.cpus} core · beban ${l0}`)}${this.gauge('Memori', pct(used, s.mem_total), `${used} / ${s.mem_total} MB`)}
      ${this.gauge('NexLab', pct(s.app_rss_mb, s.mem_total), `${s.app_rss_mb} MB RAM`)}${this.gauge('Node menyala', s.running_nodes ? 100 : 0, 'simulasi & real', String(s.running_nodes), '#27AE60')}</div>`;
  },
  // ------------------------------------------------------------ mini markdown (workbook, Claude answers)
  md(text) {
    const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = null, code = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
      if (code !== null) { if (/^```/.test(raw)) { out.push(`<pre class="mdpre">${esc(code)}</pre>`); code = null; } else code += (code ? '\n' : '') + raw; continue; }
      if (/^```/.test(raw)) { close(); code = ''; continue; }
      let m;
      if ((m = raw.match(/^(#{1,4})\s+(.*)/))) { close(); out.push(`<h${Math.min(6, m[1].length + 3)}>${inline(m[2])}</h${Math.min(6, m[1].length + 3)}>`); }
      else if ((m = raw.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
      else if ((m = raw.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
      else if (!raw.trim()) close();
      else { close(); out.push(`<p>${inline(raw)}</p>`); }
    }
    if (code !== null) out.push(`<pre class="mdpre">${esc(code)}</pre>`);
    close();
    return out.join('');
  },

  // ------------------------------------------------------------ Claude CLI helpers
  AI_EXAMPLES: {
    create: ['LAN kantor 3 VLAN (Staff, Guest, Server) dengan router-on-a-stick, DHCP di router, dan ACL yang memblokir Guest ke Server',
      'OSPF area 0 antara 3 router dengan masing-masing 1 LAN dan 1 PC, semua PC bisa saling ping',
      'Jaringan rumah: router, access point WiFi WPA2, 2 smartphone dan 1 laptop, server DHCP & DNS',
      'Lab latihan routing statis 2 router + soal workbook dan penilaian otomatis'],
    extend: ['Tambahkan server web dan DNS, buat semua PC bisa membuka http://web.lab', 'Tambahkan VLAN 30 dengan 2 PC dan routing antar-VLAN',
      'Pasang ACL agar PC tamu tidak bisa ping server', 'Buatkan workbook dan cek penilaian untuk lab ini'],
  },
  aiModelSelect(id) {
    return `<label class="check" style="gap:6px">Model <select class="input sm" id="${id}" style="width:auto"><option value="">Default CLI</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku (cepat)</option></select></label>`;
  },
  aiStatusHtml(st) {
    if (!st.installed) return `<div class="ai-st bad">${UI.info}<div><b>Claude CLI tidak ditemukan di server.</b><br>Pasang di komputer server: <span class="mono">npm install -g @anthropic-ai/claude-code</span>, lalu login dengan <span class="mono">claude</span> → <span class="mono">/login</span>.</div></div>`;
    if (!st.loggedIn) return `<div class="ai-st bad">${UI.lock}<div><b>Claude CLI terpasang (${esc(st.version)}) tetapi belum login.</b><br>NexLab memakai akun yang login di CLI pada komputer server.${this.me?.role === 'admin' ? ' <button class="btn xs primary" data-ai-login>Login Claude CLI</button>' : ' Minta admin untuk login.'}<pre class="ai-login hidden"></pre></div></div>`;
    if (!st.allowed) return `<div class="ai-st bad">${UI.lock}<div><b>Fitur Claude hanya untuk admin.</b> Admin dapat mengizinkan semua pengguna di halaman Status sistem.</div></div>`;
    return `<div class="ai-st ok">${UI.spark}<div>Terhubung ke <b>Claude CLI ${esc(st.version)}</b> — login ${esc({ 'claude.ai': 'akun Claude', console: 'Anthropic Console' }[st.authMethod] || st.authMethod || '')}${st.subscription ? ` (${esc(st.subscription)})` : ''}${st.email ? ` · ${esc(st.email)}` : ''}. Pemakaian dihitung ke akun ini.</div></div>`;
  },
  bindAiLogin(m, after) {
    const b = m.querySelector('[data-ai-login]'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true;
      const r = await this.api('POST', '/api/admin/ai/login', {});
      const pre = m.querySelector('.ai-login');
      if (r) { pre.textContent = r.output + '\n\nSelesaikan login di browser komputer server, lalu klik "Cek ulang".'; pre.classList.remove('hidden'); }
      b.textContent = 'Cek ulang'; b.disabled = false;
      b.onclick = async () => { await this.api('GET', '/api/ai/status?force=1', null, true); after(); };
    };
  },
  busy(box, btn, msg) {
    const t0 = Date.now();
    btn && (btn.disabled = true);
    box.innerHTML = `<div class="ai-busy"><span class="spin"></span><span>${esc(msg)}… <b class="el">0</b> detik</span></div>`;
    const iv = setInterval(() => { const e = box.querySelector('.el'); if (e) e.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
    return () => { clearInterval(iv); btn && (btn.disabled = false); box.innerHTML = ''; };
  },
  aiMeta(r) {
    return `<p class="muted" style="font-size:12px;margin:6px 0 0">${r.ms ? `Selesai dalam ${Math.round(r.ms / 1000)} detik` : ''}${r.cost ? ` · perkiraan biaya $${(+r.cost).toFixed(3)} (dihitung ke akun Claude CLI)` : ''}</p>`;
  },
  aiResultHtml(r) {
    return `<div class="ai-res"><b>${UI.check} Selesai:</b> ${r.nodes} perangkat, ${r.links} kabel, ${r.configured} perangkat dikonfigurasi.
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
      ${r.warnings?.length ? `<details><summary>${r.warnings.length} catatan / peringatan</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}${this.aiMeta(r)}</div>`;
  },
  async aiCreateModal() {
    const st = await this.api('GET', '/api/ai/status', null, true) || {};
    this.modal(`<h3>Buat lab dengan Claude</h3>${this.aiStatusHtml(st)}
      <div class="field"><label for="acP">Jelaskan lab yang ingin dibuat</label><textarea class="input" id="acP" rows="6" style="font-family:var(--f-body)" placeholder="mis. Kantor dengan 2 lantai, tiap lantai 1 switch dan 3 PC di VLAN berbeda, router dengan DHCP, dan server web"></textarea></div>
      <div class="g-chips">${this.AI_EXAMPLES.create.map(x => `<button class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><span class="muted" style="font-size:12.5px">Claude membuat topologi, kabel, konfigurasi IOS, IP perangkat akhir, dan workbook penilaian.</span><span class="grow"></span>${this.aiModelSelect('acModel')}</div>
      <div id="acOut"></div>
      <div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="acGo" ${st.allowed && st.loggedIn ? '' : 'disabled'}>${UI.spark} Buat lab</button></div>`, true, (m, close) => {
      m.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { m.querySelector('#acP').value = b.dataset.ex; });
      this.bindAiLogin(m, () => { close(); this.aiCreateModal(); });
      const go = m.querySelector('#acGo');
      go.onclick = async () => {
        const prompt = m.querySelector('#acP').value.trim(); if (!prompt) return;
        const box = m.querySelector('#acOut');
        const lab = await this.api('POST', '/api/labs', { name: 'Lab Claude ' + new Date().toLocaleDateString('id-ID'), template: 'blank' });
        if (!lab) return;
        const stop = this.busy(box, go, 'Claude sedang merancang topologi & konfigurasi');
        const r = await this.api('POST', `/api/labs/${lab.id}/ai`, { prompt, mode: 'replace', model: m.querySelector('#acModel').value, rename: true });
        stop();
        if (!r) { await this.api('DELETE', `/api/labs/${lab.id}`, null, true); return; }
        close(); this.toast(`Lab "${r.name || 'baru'}" dibuat: ${r.nodes} perangkat, ${r.links} kabel`);
        location.hash = '#/lab/' + lab.id;
      };
    });
  },
  async logout() {
    await this.api('POST', '/api/logout', {});
    location.hash = ''; this.me = null;
    this.pub = await this.api('GET', '/api/public', null, true);
    this.showAuth();
  },
  async loadTemplates() { if (!this.templates) { const d = await this.api('GET', '/api/templates'); if (d) { this.templates = d.templates; this.labTemplates = d.labs; } } return this.templates; },
  async loadSystem(force) { if (!this.sys || force) { const d = await this.api('GET', '/api/system'); if (d) this.sys = d; } return this.sys; },

  // ------------------------------------------------------------ boot
  async boot() {
    const qs = new URLSearchParams(location.search);
    const pub = await this.api('GET', '/api/public', null, true) || {};
    this.pub = pub;
    document.querySelectorAll('.appTitle,#brandTitle').forEach(e => e.textContent = pub.title || 'NexLab');
    const me = await this.api('GET', '/api/me', null, true);
    if (qs.get('console')) {
      if (!me) { this.showAuth(); return; }
      const [lid, nid] = qs.get('console').split(':');
      document.body.classList.add('popout');
      document.title = (qs.get('name') || 'Console') + ' — NexLab';
      Consoles.open(+lid, { id: +nid, name: qs.get('name') || 'Console' }, true);
      return;
    }
    if (!me) return this.showAuth();
    this.me = me.user;
    this.showShell();
  },
  showAuth() {
    document.getElementById('shell').classList.add('hidden');
    document.getElementById('auth').classList.remove('hidden');
    const pub = this.pub || {};
    const tabR = document.getElementById('tabReg'), tabL = document.getElementById('tabLogin');
    const fL = document.getElementById('fLogin'), fR = document.getElementById('fReg');
    tabR.classList.toggle('hidden', !pub.register);
    const show = reg => { tabL.classList.toggle('act', !reg); tabR.classList.toggle('act', reg); fL.classList.toggle('hidden', reg); fR.classList.toggle('hidden', !reg); };
    tabL.onclick = () => show(false); tabR.onclick = () => show(true);
    document.getElementById('authNote').textContent = pub.first_user ? 'Belum ada akun. Akun pertama yang didaftarkan menjadi administrator.' : (pub.register ? '' : 'Registrasi ditutup oleh administrator.');
    if (pub.first_user) show(true);
    fL.onsubmit = async e => {
      e.preventDefault();
      const err = document.getElementById('lerr'); err.textContent = '';
      const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-NexLab': '1' },
        body: JSON.stringify({ username: lu.value, password: lp.value, remember: lr.checked }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = d.error || 'Gagal masuk'; return; }
      this.me = d.user; lp.value = '';
      if (new URLSearchParams(location.search).get('console')) return location.reload();
      this.showShell();
    };
    fR.onsubmit = async e => {
      e.preventDefault();
      const err = document.getElementById('rerr'); err.textContent = '';
      if (rp.value !== rp2.value) { err.textContent = 'Password tidak sama'; return; }
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NexLab': '1' },
        body: JSON.stringify({ username: ru.value, password: rp.value, fullname: rn.value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = d.error || 'Gagal mendaftar'; return; }
      lu.value = ru.value; lp.value = rp.value;
      this.pub.first_user = false;
      this.toast(d.role === 'admin' ? 'Akun admin dibuat. Selamat datang!' : 'Akun dibuat. Silakan masuk.');
      if (d.role === 'admin') fL.requestSubmit(); else show(false);
    };
    this.icons(document.getElementById('auth'));
  },
  showShell() {
    document.getElementById('auth').classList.add('hidden');
    document.getElementById('shell').classList.remove('hidden');
    const me = this.me;
    this.icons(document.getElementById('shell'));
    document.getElementById('whoami').textContent = me.fullname || me.username;
    document.querySelectorAll('.admin-only').forEach(e => e.classList.toggle('hidden', me.role !== 'admin'));
    document.getElementById('avatarBtn').onclick = e => {
      const r = e.currentTarget.getBoundingClientRect();
      this.menu(r.right - 210, r.bottom + 4, [`${me.fullname || me.username} (${me.role === 'admin' ? 'administrator' : 'pengguna'})`,
        ['Akun & password', () => this.accountModal(), '', false, 'user'], '-', ['Logout', () => this.logout(), '', false, 'logout']]);
    };
    if (!this.routed) { this.routed = true; addEventListener('hashchange', () => this.route()); }
    this.route();
  },
  route() {
    const h = location.hash.slice(2) || 'labs';
    const [page, arg] = h.split('/');
    if (this.editor) { this.editor.destroy(); this.editor = null; }
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('act', a.dataset.nav === page));
    const v = document.getElementById('view');
    v.className = 'page'; v.style.padding = '';
    document.title = (this.pub?.title || 'NexLab') + ({ system: ' — Status sistem', users: ' — Manajemen user', help: ' — Panduan' }[page] || '');
    if (page === 'lab' && arg) { v.style.padding = '0'; v.style.display = 'flex'; this.editor = new Editor(v, arg); document.querySelector('.topbar').classList.add('hidden'); return; }
    v.style.display = ''; document.querySelector('.topbar').classList.remove('hidden');
    if (page === 'system') return this.pageSystem(v);
    if (page === 'users') return this.pageUsers(v);
    if (page === 'help') return Guide.page(v);
    return this.pageLabs(v);
  },

  // ------------------------------------------------------------ pages
  thumb(t) {
    if (!t || !t.n.length) return `<svg viewBox="0 0 300 150"><text x="150" y="80" text-anchor="middle" fill="#A0A9B4" font-size="13">Lab kosong</text></svg>`;
    const xs = t.n.map(n => n[0]), ys = t.n.map(n => n[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const w = Math.max(1, maxx - minx), hh = Math.max(1, maxy - miny);
    const k = Math.min(240 / w, 100 / hh, 0.6);
    const X = x => 150 + (x - (minx + maxx) / 2) * k, Y = y => 75 + (y - (miny + maxy) / 2) * k;
    return `<svg viewBox="0 0 300 150">${t.l.map(([a, b]) => `<line x1="${X(t.n[a][0])}" y1="${Y(t.n[a][1])}" x2="${X(t.n[b][0])}" y2="${Y(t.n[b][1])}" stroke="#5D6D7E" stroke-width="1.3"/>`).join('')}
      ${t.n.map(([x, y, ty]) => deviceIcon(ty, 22).replace('<svg ', `<svg x="${X(x) - 11}" y="${Y(y) - 11}" `)).join('')}</svg>`;
  },
  async pageLabs(v) {
    const admin = this.me.role === 'admin';
    const fmt = t => new Date(t * 1000).toLocaleString('id-ID');
    v.innerHTML = `<div class="fm">
      <section class="fm-main">
        <div class="fm-head">${UI.folder} File manager <span class="crumb">/ ${esc(this.me.username)}</span><span class="grow"></span>
          ${admin ? '<label class="check" style="font-weight:400"><input type="checkbox" id="allLabs"> Semua pengguna</label>' : ''}</div>
        <div class="fm-tools">
          <button class="btn sm primary" id="bNew">${UI.plus} Lab baru</button>
          <button class="btn sm ai" id="bAi">${UI.spark} Buat dengan Claude</button>
          <button class="btn sm" id="bImport">${UI.up} Impor</button>
          <button class="btn sm" id="bExp">${UI.down} Ekspor</button>
          <button class="btn sm danger" id="bDel">${UI.trash} Hapus</button>
          <span class="grow"></span>
          <input class="input sm" id="fmq" placeholder="Cari lab…" aria-label="Cari lab">
        </div>
        <div id="labList"><p class="muted" style="padding:14px">Memuat…</p></div>
      </section>
      <aside class="fm-prev" id="labPrev"></aside></div>`;
    let labs = [], cur = null, all = false;
    const $ = s => v.querySelector(s);
    const checked = () => [...v.querySelectorAll('.fm-t tbody input:checked')].map(i => +i.value);
    const pick = () => { const c = checked(); return c.length ? c : cur ? [cur.id] : []; };
    const del = async ids => {
      if (!ids.length) return this.toast('Pilih lab terlebih dahulu', true);
      if (!confirm(`Hapus ${ids.length > 1 ? ids.length + ' lab' : 'lab ini'} beserta semua konfigurasinya?`)) return;
      for (const id of ids) await this.api('DELETE', `/api/labs/${id}`);
      if (cur && ids.includes(cur.id)) cur = null;
      load();
    };
    const exp = ids => {
      if (!ids.length) return this.toast('Pilih lab terlebih dahulu', true);
      ids.forEach((id, i) => setTimeout(() => { const a = document.createElement('a'); a.href = `/api/labs/${id}/export`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }, i * 400));
    };
    const preview = id => {
      cur = labs.find(l => l.id === id) || null;
      v.querySelectorAll('.fm-t tbody tr').forEach(tr => tr.classList.toggle('sel', +tr.dataset.id === id));
      const p = $('#labPrev'); if (!p) return;
      if (!cur) { p.innerHTML = `<div class="fm-head">${UI.eye} Pratinjau lab</div><div class="pv-empty">Pilih lab untuk melihat pratinjau.<br>Klik ganda untuk membuka.</div>`; return; }
      p.innerHTML = `<div class="fm-head">${UI.eye} Pratinjau lab</div><div class="pv-thumb">${this.thumb(cur.thumb)}</div>
        <div class="pv-body"><h3>${esc(cur.name)}</h3>${cur.description ? `<p class="muted" style="margin:0 0 10px">${esc(cur.description)}</p>` : ''}
          <dl class="kv"><dt>Perangkat</dt><dd>${cur.nodes}</dd><dt>Kabel</dt><dd>${cur.links}</dd><dt>Menyala</dt><dd><span class="led ${cur.running ? 'on' : ''}"></span> ${cur.running}</dd>
            <dt>Diubah</dt><dd>${fmt(cur.updated)}</dd>${all ? `<dt>Pemilik</dt><dd>${esc(cur.owner)}</dd>` : ''}</dl>
          <div class="pv-actions"><button class="btn primary" data-p="open">${UI.play} Buka lab</button><button class="btn" data-p="exp">${UI.down} Ekspor</button><span class="grow"></span><button class="btn danger" data-p="del">${UI.trash} Hapus</button></div></div>`;
      p.querySelector('[data-p=open]').onclick = () => { location.hash = '#/lab/' + cur.id; };
      p.querySelector('[data-p=exp]').onclick = () => exp([cur.id]);
      p.querySelector('[data-p=del]').onclick = () => del([cur.id]);
    };
    const render = () => {
      const box = $('#labList'); if (!box) return;
      if (!labs.length) {
        box.innerHTML = `<div class="empty" style="margin:14px"><h3 style="color:#333;margin-bottom:6px">Belum ada lab</h3><p>Mulai dari lab demo yang sudah terkonfigurasi untuk melihat cara kerjanya, atau buat lab kosong.</p><button class="btn primary" id="bFirst">Buat lab demo</button></div>`;
        $('#bFirst').onclick = async () => { const r = await this.api('POST', '/api/labs', { name: 'Demo NexLab', template: 'demo' }); if (r) location.hash = '#/lab/' + r.id; };
        return preview(null);
      }
      const q = $('#fmq').value.trim().toLowerCase();
      const rows = labs.filter(l => !q || (l.name + ' ' + (l.description || '')).toLowerCase().includes(q));
      box.innerHTML = `<table class="t fm-t"><thead><tr><th><input type="checkbox" id="selAll" title="Pilih semua"></th><th>Nama</th><th>Node</th><th>Kabel</th><th>Status</th><th>Diubah</th>${all ? '<th>Pemilik</th>' : ''}</tr></thead><tbody>
        ${rows.map(l => `<tr data-id="${l.id}"><td><input type="checkbox" value="${l.id}" aria-label="Pilih ${esc(l.name)}"></td>
          <td><div class="fm-name">${UI.lab}<span>${esc(l.name)}</span></div>${l.description ? `<div class="muted">${esc(l.description)}</div>` : ''}</td>
          <td>${l.nodes}</td><td>${l.links}</td><td><span class="badge ${l.running ? 'on' : ''}">${l.running ? l.running + ' menyala' : 'mati'}</span></td>
          <td class="muted">${fmt(l.updated)}</td>${all ? `<td>${esc(l.owner)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Tidak ada lab yang cocok</td></tr>`}</tbody></table>`;
      $('#selAll').onchange = e => v.querySelectorAll('.fm-t tbody input').forEach(i => i.checked = e.target.checked);
      v.querySelectorAll('.fm-t tbody tr[data-id]').forEach(tr => {
        tr.onclick = e => { if (e.target.tagName !== 'INPUT') preview(+tr.dataset.id); };
        tr.ondblclick = e => { if (e.target.tagName !== 'INPUT') location.hash = '#/lab/' + tr.dataset.id; };
      });
      preview(cur && rows.some(r => r.id === cur.id) ? cur.id : rows.length ? rows[0].id : null);
    };
    const load = async () => {
      all = !!$('#allLabs')?.checked;
      const d = await this.api('GET', '/api/labs' + (all ? '?all=1' : ''));
      if (!d || !$('#labList')) return;
      labs = d.labs; render();
    };
    $('#allLabs') && ($('#allLabs').onchange = load);
    $('#fmq').oninput = render;
    $('#bNew').onclick = () => this.newLabModal();
    $('#bAi').onclick = () => this.aiCreateModal();
    $('#bExp').onclick = () => exp(pick());
    $('#bDel').onclick = () => del(pick());
    $('#bImport').onclick = () => {
      const f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json';
      f.onchange = async () => {
        try {
          const j = JSON.parse(await f.files[0].text());
          const data = j.data || j;
          const r = await this.api('POST', '/api/labs', { name: j.name || f.files[0].name.replace(/\..*$/, ''), description: j.description || '', data });
          if (r) { this.toast('Lab diimpor'); location.hash = '#/lab/' + r.id; }
        } catch (e) { this.toast('File bukan lab NexLab yang valid', true); }
      };
      f.click();
    };
    await this.loadTemplates();
    load();
  },
  newLabModal() {
    this.modal(`<h3>Lab baru</h3>
      <div class="field"><label for="nlName">Nama lab</label><input class="input" id="nlName" value="Lab ${new Date().toLocaleDateString('id-ID')}"></div>
      <div class="field"><label for="nlDesc">Deskripsi (opsional)</label><input class="input" id="nlDesc" placeholder="mis. Latihan VLAN dan inter-VLAN routing"></div>
      <div class="field"><label>Mulai dari</label><div class="tpl-list">${(this.labTemplates || []).map((t, i) => `<label class="tpl"><input type="radio" name="tpl" value="${t.id}" ${i === 0 ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div></div>
      <div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="nlGo">Buat lab</button></div>`, false, (m, close) => {
      m.querySelector('#nlGo').onclick = async () => {
        const r = await this.api('POST', '/api/labs', { name: m.querySelector('#nlName').value, description: m.querySelector('#nlDesc').value, template: m.querySelector('[name=tpl]:checked').value });
        if (r) { close(); location.hash = '#/lab/' + r.id; }
      };
    });
  },
  async pageSystem(v) {
    v.innerHTML = '<p class="muted">Memuat…</p>';
    const s = await this.loadSystem(true); if (!s) return;
    const c = s.caps, used = s.mem_total - s.mem_avail;
    const yes = b => b ? '<span class="yes">ya</span>' : '<span class="no">tidak</span>';
    const scheme = location.protocol.replace(':', '');
    v.innerHTML = `<div class="page-head"><div><h2>Status sistem</h2><p>Komputer (Linux, Windows atau macOS) yang menjalankan NexLab dan cara mengaksesnya dari perangkat lain.</p></div><span class="grow"></span><button class="btn sm" id="sysRef">${UI.refresh} Refresh</button></div>
    ${this.gauges(s)}
    <div class="cols">
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Alamat akses</h3>
        <p class="muted" style="margin-top:0">Buka salah satu alamat ini dari komputer Windows atau HP di jaringan yang sama:</p>
        ${s.addresses.map(a => `<div style="margin:6px 0"><span class="url">${scheme}://${esc(a.ip)}:${s.port}/</span> <span class="muted">${esc(a.iface)}</span></div>`).join('')}
        <p class="muted" style="font-size:13px">Untuk akses dari internet, teruskan port <b>${s.port}</b> di router ke IP server ini (port forwarding), atau gunakan IP publik server. Lihat Panduan bagian akses online.</p></section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Sumber daya</h3>
        <dl class="kv"><dt>CPU</dt><dd>${s.cpus} core, beban ${s.load.join(' / ')}</dd>
          <dt>RAM</dt><dd>${used} / ${s.mem_total} MB<div class="meter"><i style="width:${s.mem_total ? used / s.mem_total * 100 : 0}%"></i></div></dd>
          <dt>NexLab</dt><dd>${s.app_rss_mb} MB RAM, ${s.running_nodes} node menyala</dd>
          <dt>Uptime</dt><dd>${Math.floor(s.uptime / 3600)} jam ${Math.floor(s.uptime % 3600 / 60)} menit</dd><dt>Versi</dt><dd>${esc(s.version)}</dd></dl></section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Kemampuan mode real</h3>
        <dl class="kv"><dt>Sistem operasi</dt><dd>${esc(s.os || c.os)}</dd><dt>Admin / root</dt><dd>${yes(c.root)}</dd><dt>QEMU</dt><dd>${yes(c.qemu && c.qemu_img)}</dd>
          <dt>Akselerasi VM</dt><dd>${esc(c.accel)}</dd><dt>Jaringan VM</dt><dd>${c.netmode === 'tap' ? 'Linux bridge (bisa bridge ke NIC fisik)' : 'Socket UDP + NAT (tanpa admin)'}</dd>
          <dt>Linux Host (netns)</dt><dd>${yes(c.avail && c.avail.netns)}</dd><dt>SSH ke perangkat (asyncssh)</dt><dd>${yes(c.asyncssh)}</dd></dl>
        <p class="muted" style="font-size:13px">${c.os === 'linux' ? (c.root ? 'Semua fitur real aktif.' : 'Mode simulasi berjalan penuh. Jalankan dengan <span class="mono">sudo ./start.sh</span> untuk bridge ke NIC fisik dan Linux Host.') : 'Simulasi, Peta 3D, panduan dan console Perangkat Fisik berjalan penuh. VM QEMU berjalan dengan jaringan socket; Linux Host dan bridge NIC khusus server Linux.'}</p></section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Antarmuka jaringan server</h3>
        <table class="t"><tr><th>Nama</th><th>Jenis</th></tr>${c.os !== 'linux' ? (s.addresses || []).map(a => `<tr><td class="mono">${esc(a.iface)}</td><td>${esc(a.ip)}</td></tr>`).join('') : ''}${c.interfaces.map(i => `<tr><td class="mono">${esc(i.name)}</td><td>${i.bridge ? 'bridge' : 'NIC'}</td></tr>`).join('') || '<tr><td colspan=2 class="muted">tidak terbaca</td></tr>'}</table></section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Image QEMU</h3>
        ${c.images.length ? `<table class="t"><tr><th>Nama</th><th>File</th></tr>${c.images.map(i => `<tr><td>${esc(i.name)}</td><td class="mono" style="font-size:12px">${esc(i.disks.join(', '))}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada. Taruh image di <span class="mono">data/images/qemu/&lt;nama&gt;/</span>, contoh <span class="mono">data/images/qemu/vios/vios.qcow2</span>.</p>'}</section>
    </div>`;
    v.querySelector('#sysRef').onclick = () => this.pageSystem(v);
    const extra = document.createElement('div'); extra.className = 'cols'; extra.style.marginTop = '14px';
    v.appendChild(extra);
    const [ai, run] = await Promise.all([this.api('GET', '/api/ai/status?force=1', null, true), this.me.role === 'admin' ? this.api('GET', '/api/admin/running', null, true) : null]);
    if (!v.contains(extra)) return;
    extra.innerHTML = `<section class="panel"><h3>Integrasi Claude CLI</h3>${ai ? this.aiStatusHtml(ai) : '<p class="muted">Status tidak terbaca</p>'}
        ${ai ? `<dl class="kv" style="margin-top:10px"><dt>Terpasang</dt><dd>${ai.installed ? `<span class="yes">ya</span> ${esc(ai.version)}` : '<span class="no">tidak</span>'}</dd>
          <dt>Login</dt><dd>${ai.loggedIn ? '<span class="yes">ya</span>' : '<span class="no">belum</span>'}</dd>${ai.path ? `<dt>Lokasi</dt><dd class="mono" style="font-size:12px;word-break:break-all">${esc(ai.path)}</dd>` : ''}
          ${ai.configDir ? `<dt>Profil</dt><dd class="mono" style="font-size:12px;word-break:break-all">${esc(ai.configDir)}</dd>` : ''}${ai.user ? `<dt>User OS server</dt><dd class="mono">${esc(ai.user)}</dd>` : ''}</dl>
          ${this.me.role === 'admin' ? `<label class="check" style="margin-top:12px"><input type="checkbox" id="aiUsers" ${ai.allow_users ? 'checked' : ''}> Izinkan pengguna non-admin memakai Claude (memakai kuota akun CLI ini)</label>` : ''}
          <p class="muted" style="font-size:12.5px">NexLab menjalankan <span class="mono">claude -p</span> sebagai user OS yang menjalankan server, jadi login CLI harus dilakukan oleh user itu. Jika server dijalankan dengan <span class="mono">sudo</span>, login juga sebagai root.</p>` : ''}</section>
      ${run ? `<section class="panel"><h3>Lab yang sedang berjalan</h3>${run.labs.length ? `<table class="t"><tr><th>Lab</th><th>Pemilik</th><th>Node menyala</th><th></th></tr>
        ${run.labs.map(l => `<tr data-id="${l.id}"><td>${esc(l.name)}</td><td>${esc(l.owner)}</td><td>${l.running} / ${l.nodes}</td><td style="text-align:right;white-space:nowrap"><a class="btn xs" href="#/lab/${l.id}">Join</a> <button class="btn xs danger" data-stop="${l.id}">${UI.stop} Stop</button></td></tr>`).join('')}</table>` : '<p class="muted">Tidak ada lab yang sedang berjalan.</p>'}</section>` : ''}`;
    this.bindAiLogin(extra, () => this.pageSystem(v));
    const au = extra.querySelector('#aiUsers');
    if (au) au.onchange = () => this.api('POST', '/api/admin/settings', { allow_ai_users: au.checked }).then(r => r && this.toast('Pengaturan Claude disimpan'));
    extra.querySelectorAll('[data-stop]').forEach(b => b.onclick = async () => {
      if (confirm('Matikan semua node di lab ini?') && await this.api('POST', `/api/labs/${b.dataset.stop}/power/stop`, {})) this.pageSystem(v);
    });
  },
  async pageUsers(v) {
    const [d, st] = await Promise.all([this.api('GET', '/api/admin/users'), this.api('GET', '/api/admin/settings')]);
    if (!d) return;
    v.innerHTML = `<div class="page-head"><div><h2>Manajemen user</h2><p>Kelola siapa saja yang boleh masuk ke lab ini.</p></div><span class="grow"></span>
      <label class="check"><input type="checkbox" id="allowReg" ${st.allow_register ? 'checked' : ''}> Izinkan pendaftaran akun baru</label></div>
      <section class="panel"><table class="t"><tr><th>Username</th><th>Nama</th><th>Peran</th><th>Lab</th><th>Login terakhir</th><th>Status</th><th></th></tr>
      ${d.users.map(u => `<tr data-id="${u.id}"><td class="mono">${esc(u.username)}</td><td>${esc(u.fullname)}</td>
        <td><select class="input" style="height:30px;width:110px" data-f="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
        <td>${u.labs}</td><td>${u.last_login ? new Date(u.last_login * 1000).toLocaleString('id-ID') : '—'}</td>
        <td><label class="check"><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''}> aktif</label></td>
        <td style="text-align:right"><button class="btn sm" data-a="pw">Reset password</button> <button class="btn sm danger" data-a="del">Hapus</button></td></tr>`).join('')}
      </table></section>`;
    document.getElementById('allowReg').onchange = e => this.api('POST', '/api/admin/settings', { allow_register: e.target.checked }).then(r => r && this.toast('Pengaturan disimpan'));
    v.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelector('[data-f=role]').onchange = e => this.api('POST', `/api/admin/users/${id}`, { role: e.target.value }).then(r => r ? this.toast('Peran diubah') : this.pageUsers(v));
      tr.querySelector('[data-f=active]').onchange = e => this.api('POST', `/api/admin/users/${id}`, { active: e.target.checked ? 1 : 0 }).then(r => r ? this.toast('Status diubah') : this.pageUsers(v));
      tr.querySelector('[data-a=pw]').onclick = async () => { const p = prompt('Password baru (min. 6 karakter):'); if (p && await this.api('POST', `/api/admin/users/${id}`, { password: p })) this.toast('Password direset'); };
      tr.querySelector('[data-a=del]').onclick = async () => { if (confirm('Hapus pengguna ini?') && await this.api('DELETE', `/api/admin/users/${id}`)) this.pageUsers(v); };
    });
  },
  pageHelp(v) {
    v.innerHTML = `<div class="page-head"><div><h2>Panduan</h2><p>Hal-hal yang paling sering dibutuhkan saat ngelab.</p></div></div>
    <div class="cols">
      <section class="panel"><h3 style="font-size:16px">Perintah router & switch (IOS)</h3><pre class="mono" style="font-size:12.5px;white-space:pre-wrap;color:var(--muted)">enable / configure terminal / end / exit / do …
hostname, enable secret, banner motd #…#
interface g0/0 | interface range fa0/1 - 10
 ip address A M | no shutdown | description
 switchport mode access|trunk
 switchport access vlan 10
 switchport trunk allowed vlan 10,20
 switchport trunk native vlan 99
 encapsulation dot1Q 10   (sub-interface)
 ip helper-address | ip access-group 110 in
 no switchport (switch L3)
vlan 10 / name STAFF
ip routing / ip route / ip default-gateway
router ospf 1 / network … area 0 / passive-interface
router rip / version 2 / network …
ip dhcp pool / network / default-router / dns-server
ip dhcp excluded-address
access-list 1-199 | ip access-list extended NAME
line console 0 | line vty 0 4 / password / login [local]
username / ip domain-name / crypto key generate rsa
show run|start|ip int br|ip route|vlan br|int trunk
show mac address-table|cdp nei|ip ospf nei|arp
show access-lists|ip dhcp binding|version|interfaces
write memory / copy run start / reload / erase
ping / traceroute / telnet / ssh -l user IP
Tanda ? untuk bantuan, Tab untuk melengkapi, | include</pre></section>
      <section class="panel"><h3 style="font-size:16px">PC, laptop & server</h3><pre class="mono" style="font-size:12.5px;white-space:pre-wrap;color:var(--muted)">ipconfig | ipconfig /all
ipconfig 192.168.1.10 255.255.255.0 192.168.1.1
ip 192.168.1.10/24 192.168.1.1   (gaya VPCS)
ipconfig /renew  | dhcp
ping 8.8.8.8 -n 10 | tracert 10.0.0.1
nslookup server.lab.local
telnet 10.0.0.1 | ssh -l admin 10.0.0.1
arp -a | cls | help</pre>
        <p class="muted" style="font-size:13px">IP juga bisa diatur lewat panel kanan editor (seperti tab Desktop Packet Tracer). Server punya layanan DHCP dan DNS.</p></section>
      <section class="panel"><h3 style="font-size:16px">Menghubungkan ke perangkat fisik</h3>
        <p class="muted" style="font-size:13.5px">Node simulasi (router, switch, PC) adalah emulasi CLI: sangat ringan, tetapi tidak mengirim paket sungguhan. Untuk lalu lintas nyata ke switch/router fisik:</p>
        <ol style="font-size:13.5px;padding-left:18px;color:var(--muted)">
          <li>Jalankan server dengan <span class="mono">sudo ./start.sh</span>.</li>
          <li>Pasang NIC kedua (USB LAN pun bisa) ke switch fisik, atau buat bridge <span class="mono">pnet0</span> dengan <span class="mono">sudo scripts/make-bridge.sh eth0</span>.</li>
          <li>Taruh node <b>Cloud</b>, isi target = NIC/bridge itu.</li>
          <li>Kabelkan node <b>QEMU VM</b> (image vIOS, CSR1000v, MikroTik CHR, VyOS, dll.) atau <b>Linux Host</b> ke Cloud.</li>
          <li>Untuk console perangkat fisik langsung, gunakan node <b>Perangkat Fisik</b> (Telnet/SSH ke IP-nya).</li></ol></section>
      <section class="panel"><h3 style="font-size:16px">Akses online</h3>
        <ol style="font-size:13.5px;padding-left:18px;color:var(--muted)">
          <li>Di router rumah/kantor, teruskan port TCP <b>${location.port || 80}</b> ke IP lokal server.</li>
          <li>Izinkan port di firewall server — Linux: <span class="mono">sudo ufw allow ${location.port || 80}/tcp</span>; Windows: jalankan <span class="mono">scripts\\firewall-windows.bat</span> sebagai administrator; macOS: klik Izinkan saat diminta.</li>
          <li>Sebaiknya pakai HTTPS: <span class="mono">./start.sh --cert cert.pem --key key.pem</span> atau reverse proxy (Caddy/Nginx).</li>
          <li>Setelah akun Anda dibuat, matikan pendaftaran di menu Pengguna dan pakai password yang kuat.</li></ol></section>
    </div>`;
  },
  accountModal() {
    const me = this.me;
    this.modal(`<h3>Akun</h3><p class="muted" style="margin-top:-6px">${esc(me.fullname || me.username)} — ${me.role === 'admin' ? 'administrator' : 'pengguna'}</p>
      <h5 style="font:500 13px var(--f-body);color:var(--muted);margin:16px 0 8px">Ganti password</h5>
      <div class="field"><label>Password lama</label><input class="input" type="password" id="pwOld" autocomplete="current-password"></div>
      <div class="field"><label>Password baru</label><input class="input" type="password" id="pwNew" minlength="6" autocomplete="new-password"></div>
      <div class="modal-foot"><button class="btn danger" id="bLogout">Keluar</button><span class="grow"></span><button class="btn" data-close>Tutup</button><button class="btn primary" id="bPw">Simpan password</button></div>`, false, (m, close) => {
      m.querySelector('#bPw').onclick = async () => { if (await this.api('POST', '/api/me/password', { old: m.querySelector('#pwOld').value, new: m.querySelector('#pwNew').value })) { this.toast('Password diganti'); close(); } };
      m.querySelector('#bLogout').onclick = () => { close(); this.logout(); };
    });
  },
};
App.boot();
