/* Panel panduan: pencarian kata kunci bahasa Indonesia, tutorial, kalkulator, kirim ke console */
const Guide = {
  el: null, cur: null,
  norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.\/\- ]+/g, ' '); },
  stem(w) { return w.replace(/^(meng|meny|mem|men|me|peng|pem|pen|pe|di|ber|ter|se)(?=[a-z]{4,})/, '').replace(/(kan|an|nya|lah)$/, ''); },
  index() {
    if (this.idx) return this.idx;
    this.idx = GUIDE_KB.map(t => {
      const body = [t.intro, ...(t.steps || []).map(s => s.join(' ')), ...(t.tips || [])].join(' ');
      return { t, title: this.norm(t.title), kw: this.norm(t.kw).split(/\s+/).filter(Boolean), body: this.norm(body), cat: this.norm(t.cat) };
    });
    return this.idx;
  },
  search(q) {
    const words = this.norm(q).split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return [];
    const terms = [];
    words.forEach(w => {
      terms.push({ w, wt: 1 });
      const st = this.stem(w); if (st !== w) terms.push({ w: st, wt: 0.8 });
      (GUIDE_SYN[w] || GUIDE_SYN[st] || '').split(' ').filter(Boolean).forEach(s => terms.push({ w: s, wt: 0.7 }));
    });
    return this.index().map(e => {
      let sc = 0, hitWords = 0;
      words.forEach(w => { if (terms.some(x => (x.w === w || GUIDE_SYN[w]?.includes(x.w)) && (e.title.includes(x.w) || e.kw.some(k => k.startsWith(x.w))))) hitWords++; });
      terms.forEach(({ w, wt }) => {
        if (e.title.includes(w)) sc += 6 * wt;
        if (e.kw.includes(w)) sc += 5 * wt; else if (e.kw.some(k => k.startsWith(w) && w.length >= 3)) sc += 3 * wt;
        if (e.cat.includes(w)) sc += 2 * wt;
        if (w.length >= 3 && e.body.includes(w)) sc += 1 * wt;
      });
      sc += hitWords * 3;
      return { t: e.t, sc };
    }).filter(r => r.sc > 2).sort((a, b) => b.sc - a.sc).slice(0, 20).map(r => r.t);
  },

  // ------------------------------------------------------------ UI
  ensure() {
    if (this.el) return;
    const el = this.el = document.createElement('aside');
    el.className = 'guide hidden';
    el.setAttribute('aria-label', 'Panduan');
    el.innerHTML = `<div class="g-head"><h3>Panduan & referensi</h3><span class="grow"></span><button class="btn ghost sm" data-g="close" title="Tutup (Esc)">✕</button></div>
      <div class="g-search"><input class="input" id="gq" placeholder="Cari: firewall, vlan, wifi, fiber, ospf, dhcp, kabel rapi…" autocomplete="off"></div>
      <div class="g-body" id="gbody"></div>`;
    document.body.appendChild(el);
    const q = el.querySelector('#gq');
    q.addEventListener('input', () => this.renderList(q.value));
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = this.search(q.value); if (r[0]) this.show(r[0].id); } if (e.key === 'Escape') this.close(); });
    el.querySelector('[data-g=close]').onclick = () => this.close();
    el.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  },
  open(id) { this.ensure(); this.el.classList.remove('hidden'); if (id) this.show(id); else { this.renderList(this.el.querySelector('#gq').value); this.el.querySelector('#gq').focus(); } },
  close() { this.el && this.el.classList.add('hidden'); },
  toggle() { this.ensure(); if (this.el.classList.contains('hidden')) this.open(); else this.close(); },
  renderList(q, into) {
    const box = into || this.el.querySelector('#gbody');
    const res = q && q.trim() ? this.search(q) : null;
    if (res) {
      box.innerHTML = res.length ? `<p class="muted g-count">${res.length} panduan untuk "${esc(q)}"</p>` + res.map(t => this.card(t)).join('')
        : `<div class="tip">Tidak ditemukan untuk "${esc(q)}". Coba kata lain: firewall, vlan, routing, dhcp, wifi, fiber, kabel, script, mikrotik.</div>`;
    } else {
      box.innerHTML = `<div class="g-chips">${GUIDE_CATS.map(c => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` +
        GUIDE_CATS.map(c => `<h4 class="g-cat">${esc(c)}</h4>` + GUIDE_KB.filter(t => t.cat === c).map(t => this.card(t)).join('')).join('');
      box.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => box.querySelector(`h4.g-cat:nth-of-type(${GUIDE_CATS.indexOf(b.dataset.cat) + 1})`)?.scrollIntoView({ behavior: 'smooth' }));
    }
    box.querySelectorAll('[data-open]').forEach(c => c.onclick = () => this.show(c.dataset.open, into));
  },
  card(t) { return `<button class="g-card" data-open="${t.id}"><span class="g-title">${esc(t.title)}</span><span class="g-meta">${esc(t.cat)} · ${esc(t.lvl)}</span></button>`; },
  code(dev, cmd) {
    return `<div class="g-code"><div class="g-code-bar"><span>${esc(dev || 'Perintah')}</span><span class="grow"></span>
      <button class="btn ghost sm" data-copy>Salin</button>${dev ? '<button class="btn ghost sm" data-send>Kirim ke console</button>' : ''}</div><pre>${esc(cmd)}</pre></div>`;
  },
  show(id, into) {
    const t = GUIDE_KB.find(x => x.id === id); if (!t) return;
    const box = into || this.el.querySelector('#gbody');
    let h = `<button class="btn ghost sm" data-back>← Kembali</button>
      <h3 class="g-h">${esc(t.title)}</h3><p class="g-meta">${esc(t.cat)} · ${esc(t.lvl)}</p>${t.intro ? `<p>${esc(t.intro)}</p>` : ''}`;
    if (t.widget) h += this.widget(t.widget);
    (t.steps || []).forEach((s, i) => {
      h += `<div class="g-step"><div class="g-num">${i + 1}</div><div class="g-stepc"><b>${esc(s[0])}</b>${s[1] ? `<p>${esc(s[1])}</p>` : ''}${s[3] ? this.code(s[2], s[3]) : ''}</div></div>`;
    });
    if (t.verify) h += `<h5 class="g-sub">Verifikasi</h5>` + this.code(t.verify[0], t.verify[1]);
    if (t.tips) h += `<h5 class="g-sub">Tips</h5><ul class="g-tips">${t.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const rel = this.search(t.kw.split(' ').slice(0, 3).join(' ')).filter(x => x.id !== t.id).slice(0, 4);
    if (rel.length) h += `<h5 class="g-sub">Terkait</h5>` + rel.map(x => this.card(x)).join('');
    box.innerHTML = h;
    box.scrollTop = 0;
    box.querySelector('[data-back]').onclick = () => this.renderList(into ? '' : this.el.querySelector('#gq').value, into);
    box.querySelectorAll('[data-open]').forEach(c => c.onclick = () => this.show(c.dataset.open, into));
    box.querySelectorAll('.g-code').forEach(c => {
      const txt = c.querySelector('pre').textContent;
      c.querySelector('[data-copy]').onclick = () => { navigator.clipboard?.writeText(txt).then(() => App.toast('Perintah disalin'), () => App.toast('Salin manual: blok teks lalu Ctrl+C', true)); };
      const sb = c.querySelector('[data-send]'); if (sb) sb.onclick = ev => this.send(txt, ev);
    });
    if (t.widget) this.bindWidget(t.widget, box);
  },
  send(txt, ev) {
    const wins = Object.values(Consoles.wins);
    if (!wins.length) return App.toast('Buka console perangkat dulu (klik ganda node di topologi), lalu klik "Kirim ke console" lagi.', true);
    const go = w => { w.paste(txt); w.focus(); App.toast(`Dikirim ke ${w.node.name}`); };
    if (wins.length === 1) return go(wins[0]);
    const m = document.createElement('div'); m.className = 'pop';
    m.innerHTML = '<div class="hd">Kirim ke console</div>' + wins.map((w, i) => `<div class="mi" data-i="${i}">${esc(w.node.name)}</div>`).join('');
    document.body.appendChild(m);
    m.style.left = Math.min(ev.clientX, innerWidth - 220) + 'px'; m.style.top = Math.min(ev.clientY, innerHeight - 200) + 'px';
    m.querySelectorAll('[data-i]').forEach(d => d.onclick = () => { m.remove(); go(wins[+d.dataset.i]); });
    setTimeout(() => addEventListener('mousedown', function h(e) { if (!e.target.closest('.pop')) { m.remove(); removeEventListener('mousedown', h); } }), 0);
  },

  // ------------------------------------------------------------ calculators
  widget(w) {
    if (w === 'subnet') return `<div class="g-calc"><div class="field"><label>IP/prefix</label><input class="input mono" id="cIp" value="192.168.10.37/26"></div><div id="cOut"></div></div>`;
    if (w === 'fiber') return `<div class="g-calc"><div class="row wrap">
      ${[['fTx', 'Daya OLT (dBm)', 4], ['fKm', 'Panjang kabel (km)', 3], ['fCon', 'Jumlah konektor', 4], ['fSp', 'Jumlah sambungan', 6], ['fSens', 'Sensitivitas ONT (dBm)', -28]].map(([i, l, v]) => `<div class="field"><label>${l}</label><input class="input mono" id="${i}" value="${v}"></div>`).join('')}
      <div class="field"><label>Splitter 1</label><select class="input" id="fS1"><option value="0">-</option><option value="3.6">1:2</option><option value="7.2">1:4</option><option value="10.5" selected>1:8</option><option value="13.8">1:16</option></select></div>
      <div class="field"><label>Splitter 2</label><select class="input" id="fS2"><option value="0" selected>-</option><option value="3.6">1:2</option><option value="7.2">1:4</option><option value="10.5">1:8</option><option value="13.8">1:16</option></select></div>
      </div><div id="cOut"></div></div>`;
    if (w === 'wireless') return `<div class="g-calc"><div class="row wrap">
      ${[['wKm', 'Jarak (km)', 1.2], ['wF', 'Frekuensi (GHz)', 5.8], ['wTx', 'Daya pancar (dBm)', 23], ['wGa', 'Gain antena A (dBi)', 23], ['wGb', 'Gain antena B (dBi)', 23], ['wL', 'Rugi kabel total (dB)', 2]].map(([i, l, v]) => `<div class="field"><label>${l}</label><input class="input mono" id="${i}" value="${v}"></div>`).join('')}
      </div><div id="cOut"></div></div>`;
    return '';
  },
  bindWidget(w, box) {
    const $ = s => box.querySelector(s), out = $('#cOut');
    const calc = () => {
      if (w === 'subnet') out.innerHTML = Calc.subnetHtml($('#cIp').value);
      if (w === 'fiber') {
        const r = Calc.fiber({ tx: +$('#fTx').value, km: +$('#fKm').value, con: +$('#fCon').value, splice: +$('#fSp').value, split: +$('#fS1').value + +$('#fS2').value, sens: +$('#fSens').value });
        out.innerHTML = `<dl class="kv g-res"><dt>Total redaman</dt><dd>${r.loss.toFixed(2)} dB</dd><dt>Daya terima ONT</dt><dd><b class="${r.ok ? 'yes' : 'no'}">${r.rx.toFixed(2)} dBm</b></dd><dt>Margin</dt><dd>${r.margin.toFixed(2)} dB</dd><dt>Status</dt><dd>${r.status}</dd></dl>`;
      }
      if (w === 'wireless') {
        const r = Calc.wireless({ km: +$('#wKm').value, ghz: +$('#wF').value, tx: +$('#wTx').value, ga: +$('#wGa').value, gb: +$('#wGb').value, loss: +$('#wL').value });
        out.innerHTML = `<dl class="kv g-res"><dt>Free space path loss</dt><dd>${r.fspl.toFixed(1)} dB</dd><dt>RSSI estimasi</dt><dd><b class="${r.q === 'Bagus' ? 'yes' : r.q === 'Cukup' ? '' : 'no'}">${r.rssi.toFixed(1)} dBm (${r.q})</b></dd><dt>Radius Fresnel tengah</dt><dd>${r.fresnel.toFixed(2)} m (60% = ${(r.fresnel * 0.6).toFixed(2)} m harus bebas)</dd></dl>`;
      }
    };
    box.querySelectorAll('.g-calc input, .g-calc select').forEach(i => i.addEventListener('input', calc));
    calc();
  },
  // inline page (#/help) version
  page(v) {
    v.innerHTML = `<div class="page-head"><div><h2>Panduan & referensi</h2><p>Ketik kata kunci dalam bahasa Indonesia, misalnya "firewall", "blokir ping", "wifi tamu", "fiber ke rumah", "kabel rapi".</p></div></div>
      <div class="g-pagewrap"><input class="input" id="gpq" placeholder="Cari panduan…" style="height:44px;font-size:16px"><div id="gpbody" class="g-pagebody"></div></div>`;
    const q = v.querySelector('#gpq'), body = v.querySelector('#gpbody');
    q.addEventListener('input', () => this.renderList(q.value, body));
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = this.search(q.value); if (r[0]) this.show(r[0].id, body); } });
    this.renderList('', body);
    q.focus();
  },
};

const Calc = {
  ip2i(s) { const p = s.split('.').map(Number); if (p.length !== 4 || p.some(x => isNaN(x) || x < 0 || x > 255)) return null; return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; },
  i2ip(v) { return [24, 16, 8, 0].map(s => (v >>> s) & 255).join('.'); },
  subnetHtml(txt) {
    const m = String(txt).trim().match(/^(\d+\.\d+\.\d+\.\d+)\s*(?:\/\s*(\d+)|\s+(\d+\.\d+\.\d+\.\d+))?$/);
    if (!m) return '<p class="no">Format: 192.168.1.10/24 atau 192.168.1.10 255.255.255.0</p>';
    const ip = this.ip2i(m[1]); if (ip === null) return '<p class="no">IP tidak valid</p>';
    let len = m[2] !== undefined ? +m[2] : null;
    if (m[3]) { const mk = this.ip2i(m[3]); len = mk === null ? null : mk.toString(2).replace(/0+$/, '').length; }
    if (len === null) len = 24;
    if (len < 0 || len > 32) return '<p class="no">Prefix 0–32</p>';
    const mask = len ? (0xffffffff << (32 - len)) >>> 0 : 0, net = (ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
    const hosts = len >= 31 ? (len === 32 ? 1 : 2) : Math.pow(2, 32 - len) - 2;
    const first = len >= 31 ? net : net + 1, last = len >= 31 ? bc : bc - 1;
    return `<dl class="kv g-res"><dt>Network</dt><dd class="mono">${this.i2ip(net)}/${len}</dd><dt>Subnet mask</dt><dd class="mono">${this.i2ip(mask)}</dd>
      <dt>Wildcard</dt><dd class="mono">${this.i2ip(~mask >>> 0)}</dd><dt>Broadcast</dt><dd class="mono">${this.i2ip(bc)}</dd>
      <dt>Range host</dt><dd class="mono">${this.i2ip(first)} – ${this.i2ip(last)}</dd><dt>Jumlah host</dt><dd>${hosts.toLocaleString('id-ID')}</dd>
      <dt>Perintah OSPF</dt><dd class="mono">network ${this.i2ip(net)} ${this.i2ip(~mask >>> 0)} area 0</dd></dl>`;
  },
  fiber({ tx = 4, km = 0, con = 2, splice = 0, split = 0, sens = -28 }) {
    const loss = km * 0.35 + con * 0.5 + splice * 0.1 + split;
    const rx = tx - loss, margin = rx - sens;
    const ok = rx >= sens + 1 && rx <= -8;
    const status = rx > -8 ? 'Terlalu kuat (pasang attenuator)' : margin < 1 ? 'Gagal / LOS' : margin < 3 ? 'Kritis (margin tipis)' : 'Baik';
    return { loss, rx, margin, ok: ok && margin >= 3, status };
  },
  wireless({ km = 1, ghz = 5.8, tx = 23, ga = 23, gb = 23, loss = 2 }) {
    const d = Math.max(km, 0.001);
    const fspl = 20 * Math.log10(d) + 20 * Math.log10(ghz * 1000) + 32.44;
    const rssi = tx + ga + gb - loss - fspl;
    const fresnel = 17.32 * Math.sqrt(d / (4 * ghz));
    const q = rssi >= -65 ? 'Bagus' : rssi >= -75 ? 'Cukup' : 'Lemah';
    return { fspl, rssi, fresnel, q };
  },
};
