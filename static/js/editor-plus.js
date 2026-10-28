/* Editor extensions: Claude AI, workbook & grading, lab timer, Packet Tracer simulation mode (PDUs + event list),
   Inspect/Delete/Draw tools, shapes & pictures, config sets, undo, dark canvas, keyboard shortcuts. */
const L2_TYPES = new Set(['switch', 'l3switch', 'hub', 'ap', 'cloud', 'odp', 'ont', 'olt']);
const PDU_COLORS = ['#8E44AD', '#16A085', '#D35400', '#2980B9', '#C0392B', '#27AE60', '#F39C12', '#7F8C8D'];
const WHY_TEXT = { unreachable: 'tidak ada rute ke tujuan', noarp: 'next-hop/host tidak menjawab ARP', filtered: 'paket diblok ACL', noreturn: 'jalur balik tidak ada',
  noroute: 'perangkat tidak melakukan routing', ttl: 'TTL habis (routing loop)', off: 'perangkat sumber mati' };
const SHAPE_NAMES = { rect: 'Persegi', ellipse: 'Elips', line: 'Garis', text: 'Teks', image: 'Gambar' };

Object.assign(Editor.prototype, {
  // ================================================================ Claude AI
  async aiModal(tab = 'build') {
    const st = await App.api('GET', '/api/ai/status', null, true) || {};
    App.modal(`<h3>Claude AI — bangun lab dari prompt</h3>
      ${App.aiStatusHtml(st)}
      <div class="tabs"><button data-t="build" class="${tab === 'build' ? 'act' : ''}">Bangun / ubah lab</button><button data-t="ask" class="${tab === 'ask' ? 'act' : ''}">Tanya Claude</button></div>
      <div data-p="build" class="${tab === 'build' ? '' : 'hidden'}">
        <div class="field"><label for="aiP">Apa yang ingin dibuat atau diubah?</label><textarea class="input" id="aiP" rows="5" style="font-family:var(--f-body)" placeholder="mis. Tambahkan VLAN 30 untuk divisi Keuangan dengan 2 PC, routing antar-VLAN lewat R1, dan DHCP untuk VLAN 30"></textarea></div>
        <div class="g-chips">${App.AI_EXAMPLES.extend.map(x => `<button class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap"><label class="check"><input type="radio" name="aiM" value="extend" ${this.lab.nodes.length ? 'checked' : ''}> Ubah / tambah ke lab ini</label>
          <label class="check"><input type="radio" name="aiM" value="replace" ${this.lab.nodes.length ? '' : 'checked'}> Ganti seluruh lab</label><span class="grow"></span>${App.aiModelSelect('aiModel')}</div>
        <div id="aiOut"></div>
      </div>
      <div data-p="ask" class="${tab === 'ask' ? '' : 'hidden'}">
        <div class="field"><label for="aiQ">Pertanyaan tentang lab ini</label><textarea class="input" id="aiQ" rows="4" style="font-family:var(--f-body)" placeholder="mis. Kenapa PC-Staff tidak bisa ping Server? Apa yang salah di konfigurasi R1?"></textarea></div>
        <div class="g-chips">${['Kenapa ping gagal?', 'Jelaskan topologi ini', 'Periksa konfigurasi keamanan', 'Buat soal latihan dari lab ini'].map(x => `<button class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div id="aiAns"></div>
      </div>
      <div class="modal-foot"><button class="btn" data-close>Tutup</button><button class="btn primary" id="aiGo" ${st.allowed && st.loggedIn ? '' : 'disabled'}>${UI.spark} Jalankan</button></div>`, true, (m, close) => {
      let tabNow = tab;
      m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
        tabNow = b.dataset.t;
        m.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('act', x === b));
        m.querySelectorAll('[data-p]').forEach(p => p.classList.toggle('hidden', p.dataset.p !== tabNow));
      });
      m.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { m.querySelector('#aiP').value = b.dataset.ex; });
      m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { m.querySelector('#aiQ').value = b.dataset.q; });
      App.bindAiLogin(m, () => { close(); this.aiModal(tabNow); });
      const go = m.querySelector('#aiGo');
      go.onclick = async () => {
        const model = m.querySelector('#aiModel').value;
        if (tabNow === 'ask') {
          const q = m.querySelector('#aiQ').value.trim(); if (!q) return;
          const box = m.querySelector('#aiAns');
          const stop = App.busy(box, go, 'Claude sedang menganalisis lab');
          const r = await App.api('POST', `/api/labs/${this.id}/ai/ask`, { question: q, model });
          stop();
          box.innerHTML = r ? `<div class="ai-ans">${App.md(r.answer)}</div>${App.aiMeta(r)}` : '';
          return;
        }
        const prompt = m.querySelector('#aiP').value.trim(); if (!prompt) return;
        const mode = m.querySelector('[name=aiM]:checked').value;
        if (mode === 'replace' && this.lab.nodes.length && !confirm('Ganti seluruh isi lab dengan hasil Claude?')) return;
        const box = m.querySelector('#aiOut');
        const stop = App.busy(box, go, 'Claude sedang merancang topologi & konfigurasi');
        const r = await App.api('POST', `/api/labs/${this.id}/ai`, { prompt, mode, model, rename: mode === 'replace' });
        stop();
        if (!r) return;
        if (r.name && mode === 'replace') { this.name = r.name; this.desc = r.description || this.desc; this.showName(); }
        box.innerHTML = App.aiResultHtml(r);
        await this.reloadLab(); this.fitView(); this.resetUndo();
        if (this.lab.workbook) this.workbookPanel(true);
      };
    });
  },

  // ================================================================ workbook, grading, timer
  workbookPanel(open) {
    let p = this.root.querySelector('#wbPanel');
    const ed = this.root.querySelector('#editor');
    if (p && !open) { p.remove(); ed.classList.remove('wb-open'); this.root.querySelector('[data-sb=workbook]')?.classList.remove('on'); return; }
    if (!p) {
      p = document.createElement('aside'); p.id = 'wbPanel'; p.className = 'sidepanel wb';
      ed.appendChild(p); ed.classList.add('wb-open');
    }
    this.root.querySelector('[data-sb=workbook]')?.classList.add('on');
    const wb = this.lab.workbook || { title: '', text: '', checks: [] };
    const tm = this.lab.timer;
    p.innerHTML = `<div class="ins-head"><span>Workbook / tugas lab</span><span class="grow"></span><button class="btn ghost xs" data-w="edit" title="Edit">${UI.edit}</button><button class="btn ghost xs" data-w="close" title="Tutup">${UI.close}</button></div>
      <div class="ins-body">
        ${wb.title ? `<h3 style="margin-bottom:8px">${esc(wb.title)}</h3>` : ''}
        ${wb.text ? `<div class="md">${App.md(wb.text)}</div>` : '<p class="muted">Belum ada instruksi. Klik ikon pensil untuk menulis tugas, atau minta Claude membuatkannya.</p>'}
        <h5>Penilaian (${wb.checks.length} cek)</h5>
        ${wb.checks.length ? `<div id="wbRes" class="checks">${wb.checks.map(c => `<div><span class="ck">•</span>${esc(this.checkLabel(c))}</div>`).join('')}</div>
          <div class="ins-actions"><button class="btn sm primary" data-w="check">${UI.check} Periksa jawaban</button><span id="wbScore" class="score"></span></div>` : '<p class="muted" style="font-size:12.5px">Tambahkan cek (ping, config, running, link) agar lab bisa dinilai otomatis seperti Activity Wizard di Packet Tracer.</p>'}
        <h5>Timer lab</h5>
        <div class="row"><input class="input sm" id="tmMin" type="number" min="1" max="1440" value="${tm?.minutes || 60}" style="width:90px" aria-label="Menit"> <span class="muted">menit</span>
          <button class="btn sm" data-w="tstart">${UI.play} Mulai</button><button class="btn sm" data-w="tstop">${UI.stop} Stop</button></div>
      </div>`;
    const act = {
      close: () => this.workbookPanel(false), edit: () => this.workbookEdit(),
      check: async () => {
        const r = await App.api('POST', `/api/labs/${this.id}/check`, {}); if (!r) return;
        p.querySelector('#wbRes').innerHTML = r.results.map(x => `<div class="${x.ok ? 'ok' : 'bad'}"><span class="ck">${x.ok ? '✔' : '✘'}</span>${esc(x.label)}${x.info ? ` <span class="muted">(${esc(WHY_TEXT[x.info] || x.info)})</span>` : ''}</div>`).join('');
        p.querySelector('#wbScore').innerHTML = `Skor: <b>${r.score}%</b>`;
      },
      tstart: () => this.setTimer({ minutes: +p.querySelector('#tmMin').value || 60, started: Date.now() / 1000 }),
      tstop: () => this.setTimer(null),
    };
    p.querySelectorAll('[data-w]').forEach(b => b.onclick = () => act[b.dataset.w]());
  },
  checkLabel(c) {
    return c.label || ({ ping: `Ping ${c.src} → ${c.dst}`, config: `${c.node}: config berisi "${c.contains}"`, running: `${c.node} menyala`, link: `Kabel ${c.a} ↔ ${c.b}` }[c.type] || c.type);
  },
  workbookEdit() {
    const wb = this.lab.workbook || { title: '', text: '', checks: [] };
    const toLine = c => ({ ping: `ping ${c.src} ${c.dst}`, config: `config ${c.node} ${c.contains}`, running: `running ${c.node}`, link: `link ${c.a} ${c.b}` }[c.type] || '');
    App.modal(`<h3>Edit workbook</h3>
      <div class="field"><label for="wbT">Judul</label><input class="input" id="wbT" value="${esc(wb.title)}"></div>
      <div class="field"><label for="wbX">Instruksi (markdown sederhana: # judul, - poin, **tebal**, \`kode\`)</label><textarea class="input" id="wbX" rows="10" style="font-family:var(--f-body)">${esc(wb.text)}</textarea></div>
      <div class="field"><label for="wbC">Cek penilaian (satu per baris)</label><textarea class="input" id="wbC" rows="6" placeholder="ping PC1 192.168.2.10&#10;config R1 router ospf 1&#10;running SW1&#10;link R1 SW1">${esc(wb.checks.map(toLine).join('\n'))}</textarea></div>
      <p class="muted" style="font-size:12.5px;margin:0">Format: <span class="mono">ping SUMBER TUJUAN</span> · <span class="mono">config NODE teks</span> · <span class="mono">running NODE</span> · <span class="mono">link NODE1 NODE2</span></p>
      <div class="modal-foot"><button class="btn danger" id="wbDel">Hapus workbook</button><span class="grow"></span><button class="btn" data-close>Batal</button><button class="btn primary" id="wbSave">Simpan</button></div>`, true, (m, close) => {
      const save = async workbook => {
        if (await App.api('PUT', `/api/labs/${this.id}/extra`, { workbook })) { this.lab.workbook = workbook; close(); this.workbookPanel(true); App.toast('Workbook disimpan'); }
      };
      m.querySelector('#wbDel').onclick = () => { if (confirm('Hapus workbook lab ini?')) save(null).then(() => this.workbookPanel(false)); };
      m.querySelector('#wbSave').onclick = () => {
        const checks = m.querySelector('#wbC').value.split('\n').map(s => s.trim()).filter(Boolean).map(s => {
          const [t, a, ...rest] = s.split(/\s+/);
          if (t === 'ping') return { type: 'ping', src: a, dst: rest[0] };
          if (t === 'config') return { type: 'config', node: a, contains: rest.join(' ') };
          if (t === 'running') return { type: 'running', node: a };
          if (t === 'link') return { type: 'link', a, b: rest[0] };
          return null;
        }).filter(Boolean);
        save({ title: m.querySelector('#wbT').value.trim(), text: m.querySelector('#wbX').value, checks });
      };
    });
  },
  async setTimer(timer) {
    if (!await App.api('PUT', `/api/labs/${this.id}/extra`, { timer })) return;
    this.lab.timer = timer; this.tickTimer();
    App.toast(timer ? `Timer ${timer.minutes} menit dimulai` : 'Timer dihentikan');
  },
  tickTimer() {
    const el = this.root.querySelector('#edTimer'); if (!el) return;
    const t = this.lab.timer;
    if (!t || !t.started) { el.classList.add('hidden'); return; }
    const left = Math.round(t.started + t.minutes * 60 - Date.now() / 1000);
    el.classList.remove('hidden'); el.classList.toggle('late', left <= 0);
    const a = Math.abs(left), s = `${Math.floor(a / 3600) ? Math.floor(a / 3600) + ':' : ''}${String(Math.floor(a % 3600 / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
    el.textContent = left <= 0 ? `Waktu habis +${s}` : `⏱ ${s}`;
  },

  // ================================================================ simulation mode (Packet Tracer)
  setSimMode(on) {
    this.sim.on = on;
    this.root.querySelector('#editor').classList.toggle('simmode', on);
    this.root.querySelectorAll('.modebar [data-mode]').forEach(b => b.classList.toggle('on', (b.dataset.mode === 'sim') === on));
    this.root.querySelector('[data-sb=sim]')?.classList.toggle('on', on);
    if (!on) { this.simPause(); this.root.querySelector('#simPanel')?.remove(); this.root.querySelector('#gTemp .env')?.remove(); }
    else this.simPanel();
    this.pduList();
  },
  l2path(a, b) {
    if (a === b) return [a];
    const adj = {};
    this.lab.links.forEach(l => { (adj[l.a.node] = adj[l.a.node] || []).push(l.b.node); (adj[l.b.node] = adj[l.b.node] || []).push(l.a.node); });
    const prev = { [a]: null }, q = [a];
    while (q.length) {
      const c = q.shift();
      for (const nb of adj[c] || []) {
        if (nb in prev) continue;
        const n = this.nodeById(nb);
        if (nb !== b && !(n && L2_TYPES.has(n.type))) continue;
        prev[nb] = c;
        if (nb === b) { const p = [b]; let x = c; while (x !== null) { p.unshift(x); x = prev[x]; } return p; }
        q.push(nb);
      }
    }
    return [a, b];
  },
  portBetween(a, b) {
    const l = this.lab.links.find(l => (l.a.node === a && l.b.node === b) || (l.a.node === b && l.b.node === a));
    if (!l) return { out: '', in: '' };
    return l.a.node === a ? { out: l.a.iface, in: l.b.iface } : { out: l.b.iface, in: l.a.iface };
  },
  buildEvents(pdu, r) {
    const P = pdu.proto.toUpperCase(), ev = [];
    let t = 0;
    const srcIp = r.src_ip || '', dstIp = r.dst || '';
    const ttl0 = n => (this.tpl[this.nodeById(n)?.type]?.cli === 'ios' ? 255 : 128);
    let ttl = ttl0(pdu.src);
    ev.push({ t: 0, last: null, at: pdu.src, type: P, dir: 'req', ttl, src: srcIp, dst: dstIp, kind: 'start' });
    const seg = (list, dir, sIp, dIp) => {
      for (let i = 0; i < list.length - 1; i++) {
        const p = this.l2path(list[i], list[i + 1]);
        for (let j = 1; j < p.length; j++) {
          const last = j === p.length - 1;
          ev.push({ t: +(t += 0.001).toFixed(3), last: p[j - 1], at: p[j], type: P, dir, ttl, src: sIp, dst: dIp,
            kind: last ? (i === list.length - 2 ? 'dest' : 'route') : 'l2', ports: this.portBetween(p[j - 1], p[j]) });
        }
        if (i < list.length - 2) ttl--;
      }
    };
    seg(r.fwd || [pdu.src], 'req', srcIp, dstIp);
    if (r.ok) { ttl = ttl0(r.back?.[0]); seg(r.back || [], 'rep', dstIp, srcIp); }
    else if (r.why === 'noreturn') { ttl = ttl0(r.back?.[0]); seg(r.back || [], 'rep', dstIp, srcIp); }
    const lastEv = ev[ev.length - 1];
    if (!r.ok) {
      if (r.at && lastEv.at !== r.at && r.why === 'filtered') {
        const p = this.l2path(lastEv.at, r.at);
        for (let j = 1; j < p.length; j++) ev.push({ t: +(t += 0.001).toFixed(3), last: p[j - 1], at: p[j], type: P, dir: lastEv.dir, ttl, src: lastEv.src, dst: lastEv.dst, kind: 'l2', ports: this.portBetween(p[j - 1], p[j]) });
      }
      Object.assign(ev[ev.length - 1], { fail: true, why: r.why });
    } else ev[ev.length - 1].kind = 'done';
    ev.forEach(e => { e.pdu = pdu.id; e.color = pdu.color; });
    return ev;
  },
  async firePdu(pdu) {
    const r = await App.api('POST', `/api/labs/${this.id}/pdu`, { src: pdu.src, dst: pdu.dst, proto: pdu.proto, port: pdu.port });
    if (!r) return;
    pdu.status = r.ok ? 'ok' : 'fail'; pdu.why = r.why; pdu.time = (this.sim.clock = +((this.sim.clock || 0) + 1).toFixed(3));
    const ev = this.buildEvents(pdu, r);
    if (this.sim.on) {
      this.sim.events = this.sim.events.filter(e => e.pdu !== pdu.id).concat(ev);
      this.simPanel(); this.pduList();
      if (this.sim.idx < 0) this.simStep(1);
    } else {
      this.pduList();
      for (const e of ev) { await this.animEnv(e, 170); }
      if (!r.ok) this.flashFail(ev[ev.length - 1].at);
    }
  },
  pduPick(n) {
    if (!this.sim.pick) {
      this.sim.pick = n.id;
      const h = this.root.querySelector('#hint'); h.textContent = `PDU: sumber ${n.name} — klik perangkat tujuan`; h.classList.remove('hidden');
      return;
    }
    const src = this.sim.pick; this.sim.pick = null;
    if (src === n.id) return this.setTool('pdu');
    this.addPdu({ src, dst: String(n.id), proto: 'icmp' });
    this.setTool(null);
  },
  addPdu(o) {
    const pdu = Object.assign({ id: ++this.sim.seq, color: PDU_COLORS[this.sim.seq % PDU_COLORS.length], status: '', port: null }, o);
    this.sim.pdus.push(pdu);
    this.firePdu(pdu);
  },
  complexPduModal() {
    const opts = this.lab.nodes.filter(n => this.tpl[n.type]?.kind === 'sim').map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('');
    App.modal(`<h3>Buat PDU kompleks</h3>
      <div class="row"><div class="field grow"><label for="cpS">Sumber</label><select class="input" id="cpS">${opts}</select></div>
        <div class="field grow"><label for="cpD">Tujuan (node)</label><select class="input" id="cpD"><option value="">— IP manual —</option>${opts}</select></div></div>
      <div class="field"><label for="cpI">atau IP tujuan</label><input class="input mono" id="cpI" placeholder="192.168.1.10"></div>
      <div class="row"><div class="field grow"><label for="cpP">Protokol</label><select class="input" id="cpP"><option value="icmp">ICMP (ping)</option><option value="tcp">TCP</option><option value="udp">UDP</option></select></div>
        <div class="field grow"><label for="cpPort">Port tujuan</label><input class="input mono" id="cpPort" placeholder="80 / 23 / 53" disabled></div></div>
      <p class="muted" style="font-size:12.5px;margin:0">Port umum: HTTP 80, HTTPS 443, Telnet 23, SSH 22, DNS 53, DHCP 67. ACL extended ikut dievaluasi.</p>
      <div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="cpGo">Buat PDU</button></div>`, false, (m, close) => {
      const P = m.querySelector('#cpP'), port = m.querySelector('#cpPort');
      P.onchange = () => { port.disabled = P.value === 'icmp'; };
      m.querySelector('#cpGo').onclick = () => {
        const dst = m.querySelector('#cpI').value.trim() || m.querySelector('#cpD').value;
        if (!dst) return App.toast('Pilih tujuan', true);
        close(); this.addPdu({ src: +m.querySelector('#cpS').value, dst, proto: P.value, port: P.value === 'icmp' ? null : port.value });
      };
    });
  },
  pduList() {
    let box = this.root.querySelector('#pduBox');
    if (!this.sim.pdus.length && !this.sim.on) { box && box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'pduBox'; box.className = 'pdubox'; this.root.querySelector('#cwrap').appendChild(box); }
    const name = id => this.nodeById(+id)?.name || id;
    box.innerHTML = `<div class="pdu-head"><b>Skenario PDU</b><span class="grow"></span><button class="btn xs" data-p="simple" title="Tambah PDU sederhana">${UI.mail} Sederhana</button><button class="btn xs" data-p="complex">${UI.mail} Kompleks</button><button class="btn xs" data-p="clear" title="Hapus semua">${UI.trash}</button></div>
      ${!this.sim.pdus.length ? '' : `<table class="t"><thead><tr><th>Fire</th><th>Status</th><th>Sumber</th><th>Tujuan</th><th>Tipe</th><th></th><th></th></tr></thead><tbody>
      ${this.sim.pdus.map(p => `<tr data-id="${p.id}"><td><button class="btn xs" data-p="fire" title="Kirim ulang">${UI.play}</button></td>
        <td>${p.status === 'ok' ? '<span class="yes">Sukses</span>' : p.status === 'fail' ? `<span class="no" title="${esc(WHY_TEXT[p.why] || p.why || '')}">Gagal</span>` : '—'}</td>
        <td>${esc(name(p.src))}</td><td>${esc(/^\d+$/.test(p.dst) ? name(p.dst) : p.dst)}</td><td>${p.proto.toUpperCase()}${p.port ? ':' + esc(p.port) : ''}</td>
        <td><i class="sw" style="background:${p.color}"></i></td><td><button class="btn xs ghost" data-p="del" title="Hapus">${UI.close}</button></td></tr>`).join('')}</tbody></table>`}`;
    box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      const a = b.dataset.p, id = +b.closest('tr')?.dataset.id, p = this.sim.pdus.find(x => x.id === id);
      if (a === 'simple') this.setTool('pdu');
      else if (a === 'complex') this.complexPduModal();
      else if (a === 'clear') { this.sim.pdus = []; this.sim.events = []; this.sim.idx = -1; this.root.querySelector('#gTemp .env')?.remove(); this.pduList(); this.simPanel(); }
      else if (a === 'fire' && p) this.firePdu(p);
      else if (a === 'del' && p) { this.sim.pdus = this.sim.pdus.filter(x => x !== p); this.sim.events = this.sim.events.filter(e => e.pdu !== id); this.sim.idx = Math.min(this.sim.idx, this.sim.events.length - 1); this.pduList(); this.simPanel(); }
    });
  },
  visibleEvents() { const f = this.sim.filter; return this.sim.events.filter(e => f[e.type.toLowerCase()] !== false); },
  simPanel() {
    if (!this.sim.on) return;
    let p = this.root.querySelector('#simPanel');
    if (!p) { p = document.createElement('aside'); p.id = 'simPanel'; p.className = 'sidepanel sim'; this.root.querySelector('#editor').appendChild(p); }
    const ev = this.visibleEvents(), f = this.sim.filter, name = id => this.nodeById(id)?.name || '—';
    p.innerHTML = `<div class="ins-head"><span>Panel simulasi</span><span class="grow"></span><button class="btn ghost xs" data-s="close" title="Kembali ke Realtime">${UI.close}</button></div>
      <div class="ins-body">
        <h5 style="margin-top:0">Daftar event</h5>
        <div class="tbl-wrap ev"><table class="t"><thead><tr><th></th><th>Waktu (s)</th><th>Dari</th><th>Di perangkat</th><th>Tipe</th><th>Info</th></tr></thead><tbody>
          ${ev.map((e, i) => `<tr data-i="${i}" class="${i === this.sim.idx ? 'cur' : ''} ${i > this.sim.idx ? 'future' : ''}"><td><i class="sw" style="background:${e.color}"></i>${e.fail ? ' <span class="no">✘</span>' : ''}</td><td>${e.t.toFixed(3)}</td><td>${esc(e.last ? name(e.last) : '—')}</td><td><b>${esc(name(e.at))}</b></td><td>${e.type}</td><td><button class="btn xs" data-info="${i}">${UI.eye}</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="padding:14px">Belum ada event. Tambahkan PDU (ikon amplop) lalu tekan Putar.</td></tr>'}
        </tbody></table></div>
        <div class="simctl">
          <button class="btn sm" data-s="reset" title="Reset simulasi">${UI.wipe}</button>
          <button class="btn sm" data-s="back" title="Kembali">◀</button>
          <button class="btn sm primary" data-s="play" title="Putar / jeda">${this.sim.playing ? '❚❚ Jeda' : '▶ Putar'}</button>
          <button class="btn sm" data-s="fwd" title="Maju satu event">▶|</button>
          <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:6px">Kecepatan <input type="range" min="200" max="1500" step="100" value="${1700 - this.sim.speed}" id="simSpd"></label>
        </div>
        <h5>Filter protokol</h5>
        <div class="row">${['icmp', 'tcp', 'udp'].map(k => `<label class="check"><input type="checkbox" data-f="${k}" ${f[k] !== false ? 'checked' : ''}> ${k.toUpperCase()}</label>`).join('')}</div>
        <div id="simInfo" class="tip" style="${this.sim.idx >= 0 && ev[this.sim.idx] ? '' : 'display:none'}">${this.sim.idx >= 0 && ev[this.sim.idx] ? this.eventText(ev[this.sim.idx]) : ''}</div>
        <p class="muted" style="font-size:12px;margin-top:12px">Simulasi menelusuri jalur paket memakai tabel routing, ARP, VLAN dan ACL perangkat simulasi. Detail layer adalah model edukasi, bukan tangkapan paket asli.</p>
      </div>`;
    const S = {
      close: () => this.setSimMode(false), reset: () => { this.simPause(); this.sim.idx = -1; this.root.querySelector('#gTemp .env')?.remove(); this.simPanel(); },
      back: () => { this.simPause(); this.simStep(-1); }, fwd: () => { this.simPause(); this.simStep(1); },
      play: () => this.sim.playing ? this.simPause() : this.simPlay(),
    };
    p.querySelectorAll('[data-s]').forEach(b => b.onclick = () => S[b.dataset.s]());
    p.querySelectorAll('[data-f]').forEach(c => c.onchange = () => { this.sim.filter[c.dataset.f] = c.checked; this.sim.idx = -1; this.simPanel(); });
    p.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-info]')) { this.simPause(); this.sim.idx = +tr.dataset.i - 1; this.simStep(1); } });
    p.querySelectorAll('[data-info]').forEach(b => b.onclick = () => this.pduInfo(ev[+b.dataset.info]));
    p.querySelector('#simSpd').oninput = e => { this.sim.speed = 1700 - +e.target.value; };
    p.querySelector('tr.cur')?.scrollIntoView({ block: 'nearest' });
  },
  async simStep(d) {
    const ev = this.visibleEvents();
    const i = this.sim.idx + d;
    if (i < 0 || i >= ev.length) { this.simPause(); return false; }
    this.sim.idx = i;
    this.simPanel();
    await this.animEnv(ev[i], d > 0 ? Math.min(600, this.sim.speed * 0.7) : 0, true);
    if (ev[i].fail) this.flashFail(ev[i].at);
    return true;
  },
  async simPlay() {
    if (this.sim.idx >= this.visibleEvents().length - 1) this.sim.idx = -1;
    this.sim.playing = true; this.simPanel();
    while (this.sim.playing && this.sim.on && this.alive) {
      if (!await this.simStep(1)) break;
      await new Promise(r => setTimeout(r, this.sim.speed));
    }
    this.sim.playing = false; this.simPanel();
  },
  simPause() { if (this.sim.playing) { this.sim.playing = false; this.simPanel(); } },
  envSvg(color) {
    return `<g class="env"><rect x="-11" y="-8" width="22" height="16" rx="2" fill="${color}" stroke="#fff" stroke-width="1.5"/><path d="M-11 -8L0 1L11 -8" fill="none" stroke="#fff" stroke-width="1.5"/></g>`;
  },
  animEnv(e, ms, keep) {
    return new Promise(res => {
      const g = this.root.querySelector('#gTemp'); if (!g) return res();
      g.querySelector('.env')?.remove();
      const a = this.nodeById(e.last ?? e.at), b = this.nodeById(e.at);
      if (!a || !b) return res();
      g.insertAdjacentHTML('beforeend', this.envSvg(e.color));
      const el = g.querySelector('.env:last-child');
      const t0 = performance.now();
      const step = now => {
        const k = ms ? Math.min(1, (now - t0) / ms) : 1;
        el.setAttribute('transform', `translate(${a.x + (b.x - a.x) * k},${a.y + (b.y - a.y) * k - 36})`);
        if (k < 1) requestAnimationFrame(step);
        else { if (!keep) setTimeout(() => el.remove(), 60); res(); }
      };
      requestAnimationFrame(step);
    });
  },
  flashFail(nid) {
    const n = this.nodeById(nid), g = this.root.querySelector('#gTemp'); if (!n || !g) return;
    g.insertAdjacentHTML('beforeend', `<g class="failx" transform="translate(${n.x + 22},${n.y - 30})"><circle r="10" fill="#D9534F" stroke="#fff" stroke-width="2"/><path d="M-4 -4L4 4M4 -4L-4 4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>`);
    const el = g.lastElementChild; setTimeout(() => el.remove(), 1600);
  },
  eventText(e) {
    const n = this.nodeById(e.at), name = n?.name || '?', t = this.tpl[n?.type] || {};
    const what = e.type === 'ICMP' ? (e.dir === 'req' ? 'ICMP echo request' : 'ICMP echo reply') : `${e.type} ${e.dir === 'req' ? 'segmen' : 'balasan'}`;
    if (e.kind === 'start') return `<b>${esc(name)}</b> membuat paket ${what} dari <span class="mono">${esc(e.src || '?')}</span> ke <span class="mono">${esc(e.dst)}</span>${e.fail ? ` — <span class="no">gagal: ${esc(WHY_TEXT[e.why] || e.why)}</span>` : ''}.`;
    let s = `<b>${esc(name)}</b> menerima ${what} di port <span class="mono">${esc(e.ports?.in || '?')}</span>. `;
    if (e.kind === 'l2') s += L2_TYPES.has(n?.type) ? 'Perangkat layer 2 meneruskan frame berdasarkan tabel MAC/VLAN ke port tujuan.' : 'Paket diteruskan.';
    else if (e.kind === 'route') s += `Tujuan <span class="mono">${esc(e.dst)}</span> bukan milik ${esc(t.label || 'perangkat')} ini; dicocokkan dengan tabel routing, TTL dikurangi, lalu diteruskan ke hop berikutnya.`;
    else if (e.kind === 'dest') s += e.dir === 'req' ? `Alamat tujuan milik perangkat ini — ${e.type === 'ICMP' ? 'membalas dengan echo reply' : 'menerima koneksi'}.` : 'Balasan diterima.';
    else if (e.kind === 'done') s += '<span class="yes">Balasan sampai di pengirim — komunikasi berhasil.</span>';
    if (e.fail) s += ` <span class="no">Paket dibuang: ${esc(WHY_TEXT[e.why] || e.why)}.</span>`;
    return s;
  },
  pduInfo(e) {
    if (!e) return;
    const n = this.nodeById(e.at), l3 = !L2_TYPES.has(n?.type);
    const row = (layer, inn, out) => `<tr><td><b>${layer}</b></td><td>${inn}</td><td>${out}</td></tr>`;
    App.modal(`<h3>Informasi PDU di perangkat: ${esc(n?.name || '')}</h3>
      <table class="t osi"><thead><tr><th>Layer OSI</th><th>Layer masuk</th><th>Layer keluar</th></tr></thead><tbody>
        ${row('Layer 7', e.type === 'TCP' || e.type === 'UDP' ? 'Aplikasi' : '', '')}
        ${row('Layer 4', e.type !== 'ICMP' ? `${e.type} port tujuan` : '', '')}
        ${row('Layer 3', l3 && e.kind !== 'start' ? `IP Header Src. IP: ${esc(e.src)}, Dest. IP: ${esc(e.dst)}<br>${e.type === 'ICMP' ? 'ICMP Message Type: ' + (e.dir === 'req' ? 8 : 0) : ''}` : '',
          l3 && !e.fail && e.kind !== 'done' ? `IP Header Src. IP: ${esc(e.src)}, Dest. IP: ${esc(e.dst)}, TTL: ${e.ttl}` : '')}
        ${row('Layer 2', e.kind !== 'start' ? 'Ethernet II Header' : '', !e.fail && e.kind !== 'done' ? 'Ethernet II Header' : '')}
        ${row('Layer 1', e.ports?.in ? `Port: ${esc(e.ports.in)}` : '', !e.fail && e.kind !== 'done' ? 'Port keluar' : '')}
      </tbody></table>
      <div class="tip">${this.eventText(e)}</div>
      <div class="modal-foot"><button class="btn primary" data-close>Tutup</button></div>`, true);
  },

  // ================================================================ inspect tool
  inspectMenu(n, e) {
    const t = this.tpl[n.type] || {};
    if (t.kind !== 'sim') return App.toast('Inspect hanya untuk perangkat simulasi', true);
    const ios = t.cli === 'ios', sw = n.type === 'switch' || n.type === 'l3switch' || n.type === 'olt';
    const items = [`Inspect ${n.name}`];
    if (ios) {
      if (n.type !== 'switch') items.push(['Tabel routing', () => this.inspectRun(n, 'Tabel routing', ['show ip route']), '', false, 'links']);
      items.push(['Tabel ARP', () => this.inspectRun(n, 'Tabel ARP', ['show arp']), '', false, 'file']);
      if (sw) { items.push(['Tabel MAC', () => this.inspectRun(n, 'Tabel MAC', ['show mac address-table']), '', false, 'nodes']); items.push(['VLAN', () => this.inspectRun(n, 'VLAN', ['show vlan brief']), '', false, 'nodes']); }
      items.push(['Interface', () => this.inspectRun(n, 'Ringkasan interface', ['show ip interface brief']), '', false, 'plug']);
      items.push(['ACL', () => this.inspectRun(n, 'Access list', ['show access-lists']), '', false, 'lock']);
      items.push(['Running-config', () => this.showConfig(n), '', false, 'file']);
    } else {
      items.push(['IP configuration', () => this.inspectRun(n, 'IP configuration', ['ipconfig /all']), '', false, 'info']);
      items.push(['Tabel ARP', () => this.inspectRun(n, 'Tabel ARP', ['arp -a']), '', false, 'file']);
    }
    this.menu(e.clientX, e.clientY, items);
  },
  async inspectRun(n, title, cmds) {
    if (!this.running(n.id)) return App.toast(`${n.name} mati — nyalakan dulu`, true);
    const r = await App.api('POST', `/api/labs/${this.id}/nodes/${n.id}/exec`, { cmds }); if (!r) return;
    const txt = r.output.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\s*\n/, '');
    App.modal(`<h3>${esc(title)} — ${esc(n.name)}</h3><pre>${esc(txt || '(kosong)')}</pre><div class="modal-foot"><button class="btn primary" data-close>Tutup</button></div>`, true);
  },

  // ================================================================ shapes & pictures
  addShape(kind, p, extra) {
    const id = (this.lab.notes || []).reduce((m, n) => Math.max(m, n.id), 0) + 1;
    const base = { rect: { w: 200, h: 120, stroke: '#1F6FB5', fill: '#1F6FB5', fo: 0.08, sw: 2, dash: '' }, ellipse: { w: 180, h: 120, stroke: '#16A085', fill: '#16A085', fo: 0.08, sw: 2, dash: '' },
      line: { w: 160, h: 0, stroke: '#2C3E50', sw: 2, dash: '' }, text: { w: 0, h: 0, text: 'Teks', size: 16, color: '#2C3E50', bold: true, bg: '' }, image: { w: 320, h: 200 } }[kind];
    const n = Object.assign({ id, kind, x: Math.round(p.x), y: Math.round(p.y) }, base, extra || {});
    (this.lab.notes = this.lab.notes || []).push(n);
    this.drawNotes(); this.save();
    return n;
  },
  pickImage(p) {
    const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
    f.onchange = () => {
      const file = f.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
          if (src.length > 3e6) return App.toast('Gambar terlalu besar (maks ±2 MB setelah dikompres)', true);
          const s = Math.min(1, 500 / Math.max(c.width, c.height));
          const n = this.addShape('image', p || this.center(), { src, w: Math.round(c.width * s), h: Math.round(c.height * s) });
          this.edit('note', n.id);
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    };
    f.click();
  },
  shapeSvg(n, sel) {
    const st = `stroke:${n.stroke || 'none'};stroke-width:${n.sw || 0};stroke-dasharray:${n.dash === 'dashed' ? '8 5' : n.dash === 'dotted' ? '2 4' : 'none'}`;
    const fill = `fill:${n.fill || 'none'};fill-opacity:${n.fo ?? 0.1}`;
    let body = '', w = n.w || 0, h = n.h || 0;
    if (n.kind === 'rect') body = `<rect class="shp" width="${w}" height="${h}" rx="4" style="${fill};${st}"/>`;
    else if (n.kind === 'ellipse') body = `<ellipse class="shp" cx="${w / 2}" cy="${h / 2}" rx="${Math.abs(w / 2)}" ry="${Math.abs(h / 2)}" style="${fill};${st}"/>`;
    else if (n.kind === 'line') body = `<line class="hitl" x1="0" y1="0" x2="${w}" y2="${h}"/><line x1="0" y1="0" x2="${w}" y2="${h}" style="${st};stroke-linecap:round"/>`;
    else if (n.kind === 'image') body = `<image href="${n.src}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
    else if (n.kind === 'text') {
      const lines = String(n.text || '').split('\n'), fs = +n.size || 16;
      w = Math.max(20, Math.max(...lines.map(s => s.length)) * fs * 0.56 + 12); h = lines.length * fs * 1.3 + 8;
      body = `${n.bg ? `<rect width="${w}" height="${h}" rx="3" style="fill:${n.bg}"/>` : '<rect width="' + w + '" height="' + h + '" fill="transparent"/>'}<text x="6" y="${fs + 2}" style="font-size:${fs}px;fill:${n.color || '#2C3E50'};font-weight:${n.bold ? 700 : 400};font-family:var(--f-body)">${lines.map((s, i) => `<tspan x="6" dy="${i ? fs * 1.3 : 0}">${esc(s)}</tspan>`).join('')}</text>`;
    }
    if (n.text && (n.kind === 'rect' || n.kind === 'ellipse')) body += `<text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" style="font:600 13px var(--f-body);fill:${n.stroke || '#333'}">${esc(n.text)}</text>`;
    const x0 = Math.min(0, w), y0 = Math.min(0, h);
    const selbb = sel ? `<rect class="selbb" x="${x0 - 4}" y="${y0 - 4}" width="${Math.abs(w) + 8}" height="${Math.abs(h) + 8}"/>${n.kind !== 'text' ? `<rect class="rsz" x="${w - 5}" y="${h - 5}" width="10" height="10"/>` : ''}` : '';
    return `<g class="note shape k-${n.kind} ${sel ? 'sel' : ''}" data-id="${n.id}" transform="translate(${n.x},${n.y})">${body}${selbb}</g>`;
  },
  inspectShape(el, n, focusText) {
    const k = n.kind, f = (key, label, type = 'text', extra = '') => `<div class="field grow"><label>${label}</label><input class="input sm" data-sp="${key}" type="${type}" value="${esc(n[key] ?? '')}" ${extra}></div>`;
    let h = `<h3>${esc(SHAPE_NAMES[k] || 'Objek')}</h3>`;
    if (k === 'text' || k === 'rect' || k === 'ellipse') h += `<h5>Teks</h5><textarea class="input" data-sp="text" rows="${k === 'text' ? 4 : 2}" style="font-family:var(--f-body)">${esc(n.text || '')}</textarea>`;
    if (k === 'text') h += `<div class="row" style="margin-top:8px">${f('size', 'Ukuran', 'number', 'min="8" max="72"')}${f('color', 'Warna', 'color')}${f('bg', 'Latar', 'color')}</div>
      <label class="check"><input type="checkbox" data-sp="bold" ${n.bold ? 'checked' : ''}> Tebal</label> <button class="btn xs" data-clear="bg">Tanpa latar</button>`;
    if (k === 'rect' || k === 'ellipse' || k === 'line') h += `<h5>Garis & isi</h5><div class="row">${f('stroke', 'Warna garis', 'color')}${f('sw', 'Tebal', 'number', 'min="0" max="12"')}</div>
      <div class="field"><label>Gaya garis</label><select class="input sm" data-sp="dash">${[['', 'Solid'], ['dashed', 'Putus-putus'], ['dotted', 'Titik-titik']].map(([v, l]) => `<option value="${v}" ${(n.dash || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${k !== 'line' ? `<div class="row">${f('fill', 'Warna isi', 'color')}${f('fo', 'Transparansi isi', 'number', 'min="0" max="1" step="0.05"')}</div>` : ''}`;
    if (k !== 'text') h += `<h5>Ukuran</h5><div class="row">${f('w', 'Lebar', 'number')}${f('h', 'Tinggi', 'number')}</div><p class="muted" style="font-size:12px;margin:0">Atau tarik kotak kecil di pojok kanan bawah objek.</p>`;
    h += `<div class="ins-actions"><button class="btn sm" data-z="back">Ke belakang</button><button class="btn sm" data-z="front">Ke depan</button><button class="btn danger sm" data-z="del">${UI.trash} Hapus</button></div>`;
    el.innerHTML = h;
    el.querySelectorAll('[data-sp]').forEach(inp => inp.oninput = inp.onchange = () => {
      const key = inp.dataset.sp;
      n[key] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value;
      this.drawNotes(); this.save();
    });
    el.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { n[b.dataset.clear] = ''; this.drawNotes(); this.save(); });
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => {
      if (b.dataset.z === 'del') return this.deleteSel();
      const arr = this.lab.notes, i = arr.indexOf(n); arr.splice(i, 1);
      b.dataset.z === 'back' ? arr.unshift(n) : arr.push(n);
      this.drawNotes(); this.save();
    });
    if (focusText) { const ta = el.querySelector('textarea'); ta && (ta.focus(), ta.select()); }
  },

  // ================================================================ config sets, import/export
  async configSetsUi(box, cur) {
    const sets = this.lab.configsets || [];
    box.innerHTML = `<div class="row" style="flex-wrap:wrap;gap:6px"><b style="font-size:12.5px">Config set:</b>
      <select class="input sm" id="csSel" style="width:170px">${sets.map(s => `<option>${esc(s.name)}</option>`).join('') || '<option value="">(belum ada)</option>'}</select>
      <button class="btn sm" data-c="load" ${sets.length ? '' : 'disabled'}>Muat</button><button class="btn sm" data-c="save">Simpan sebagai…</button><button class="btn sm" data-c="del" ${sets.length ? '' : 'disabled'}>Hapus</button>
      <span class="grow"></span><a class="btn sm" href="/api/labs/${this.id}/configs">${UI.down} Ekspor semua (.txt)</a><button class="btn sm" data-c="imp">${UI.up} Impor ke node</button></div>`;
    const call = async (action, name) => {
      const r = await App.api('POST', `/api/labs/${this.id}/configsets`, { action, name }); if (!r) return;
      this.lab.configsets = r.sets; this.configSetsUi(box, cur);
      App.toast({ save: `Config set "${name}" disimpan`, load: `Config set "${name}" dimuat ke semua node`, delete: 'Config set dihapus' }[action]);
      if (action === 'load') box.dispatchEvent(new Event('reloadcfg'));
    };
    box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      const sel = box.querySelector('#csSel').value;
      if (b.dataset.c === 'save') { const nm = prompt('Nama config set (mis. "Awal", "Solusi"):'); if (nm) call('save', nm); }
      else if (b.dataset.c === 'load' && sel && confirm(`Muat config set "${sel}"? Konfigurasi node saat ini akan diganti.`)) call('load', sel);
      else if (b.dataset.c === 'del' && sel && confirm(`Hapus config set "${sel}"?`)) call('delete', sel);
      else if (b.dataset.c === 'imp') this.importConfig(cur());
    });
  },
  importConfig(nid) {
    const n = this.nodeById(nid);
    if (!n || this.tpl[n.type]?.cli !== 'ios') return App.toast('Pilih perangkat IOS di daftar kiri', true);
    App.modal(`<h3>Impor config ke ${esc(n.name)}</h3><p class="muted" style="margin-top:0">Tempel konfigurasi (format running-config / perintah mode global). Dijalankan di <span class="mono">configure terminal</span> lalu disimpan dengan <span class="mono">write memory</span>.</p>
      <textarea class="input" id="icT" rows="14"></textarea><div class="modal-foot"><button class="btn" data-close>Batal</button><button class="btn primary" id="icGo">Terapkan</button></div>`, true, (m, close) => {
      m.querySelector('#icGo').onclick = async () => {
        if (!this.running(nid)) await this.power('start', [nid]);
        const lines = m.querySelector('#icT').value.split('\n').filter(s => s.trim() && !/^\s*(!|end$|Building|Current configuration|version )/.test(s));
        const r = await App.api('POST', `/api/labs/${this.id}/nodes/${nid}/exec`, { cmds: ['configure terminal', ...lines, 'end', 'write memory'] });
        if (!r) return;
        close(); App.toast(r.rejected.length ? `${r.rejected.length} baris ditolak simulator: ${r.rejected.slice(0, 3).join(' | ')}` : 'Konfigurasi diterapkan', r.rejected.length > 0);
      };
    });
  },

  // ================================================================ undo, theme, shortcuts
  snapshot() {
    return JSON.stringify({ nodes: this.lab.nodes.map(n => ({ id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, props: n.props, size: n.size, lpos: n.lpos })), links: this.lab.links, notes: this.lab.notes || [] });
  },
  resetUndo() { this.undoStack = []; this.lastSnap = this.snapshot(); },
  pushUndo() {
    const s = this.snapshot();
    if (this.lastSnap && s !== this.lastSnap) { this.undoStack.push(this.lastSnap); if (this.undoStack.length > 50) this.undoStack.shift(); }
    this.lastSnap = s;
  },
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return App.toast('Tidak ada yang bisa dibatalkan');
    const s = JSON.parse(prev), byId = Object.fromEntries(this.lab.nodes.map(n => [n.id, n]));
    let lost = false;
    this.lab.nodes = s.nodes.map(sn => { if (byId[sn.id]) return Object.assign(byId[sn.id], sn); lost = true; return Object.assign({ ifaces: [] }, sn); });
    this.lab.links = s.links; this.lab.notes = s.notes;
    this.lastSnap = prev; this.noUndo = true;
    this.select(null); this.drawAll(); this.save(lost);
    if (lost) App.toast('Node dikembalikan tanpa konfigurasi lamanya');
  },
  toggleTheme() {
    const dark = !this.root.querySelector('#editor').classList.contains('dark');
    this.root.querySelector('#editor').classList.toggle('dark', dark);
    try { localStorage.setItem('nx-theme', dark ? 'dark' : 'light'); } catch (e) {}
    this.root.querySelector('[data-sb=theme] span').textContent = dark ? 'Mode terang' : 'Mode gelap';
  },
  shortcutsModal() {
    const k = [['Klik ganda node', 'Buka console'], ['Klik kanan', 'Menu objek / kanvas'], ['C', 'Mode kabel'], ['N', 'Tambah teks/catatan'], ['I', 'Alat Inspect'], ['D', 'Alat Delete'],
      ['P', 'Tambah PDU sederhana'], ['Shift+S / Shift+R', 'Mode Simulasi / Realtime'], ['Spasi', 'Putar/jeda simulasi'], ['Ctrl+Z', 'Undo'], ['Del / Backspace', 'Hapus objek terpilih'],
      ['+ / −', 'Zoom'], ['F', 'Pas layar'], ['Esc', 'Batal alat / tutup panel'], ['F1', 'Panduan'], ['?', 'Daftar pintasan ini']];
    App.modal(`<h3>Pintasan keyboard</h3><table class="t">${k.map(([a, b]) => `<tr><td style="width:170px"><span class="kbd">${esc(a)}</span></td><td>${esc(b)}</td></tr>`).join('')}</table><div class="modal-foot"><button class="btn primary" data-close>Tutup</button></div>`);
  },
});
