/* Browser console windows (xterm.js) — sim CLI line editor + raw passthrough for real devices */
const Consoles = {
  wins: {}, z: 50, n: 0,
  open(labId, node, popout) {
    const key = labId + ':' + node.id;
    if (this.wins[key]) { this.wins[key].focus(); return this.wins[key]; }
    const w = new ConsoleWin(labId, node, popout);
    this.wins[key] = w;
    return w;
  },
  closeLab(labId) { Object.values(this.wins).forEach(w => { if (w.labId == labId) w.close(); }); },
};

class ConsoleWin {
  constructor(labId, node, popout) {
    this.labId = labId; this.node = node; this.popout = popout;
    this.mode = null; this.buf = ''; this.prompt = ''; this.echo = true; this.busy = true; this.queue = '';
    this.hist = []; this.hi = -1;
    const el = this.el = document.createElement('div');
    el.className = 'cwin';
    const off = (Consoles.n++ % 6) * 28;
    el.style.left = (popout ? 0 : 90 + off) + 'px';
    el.style.top = (popout ? 0 : 70 + off) + 'px';
    el.innerHTML = `<div class="cwin-bar"><span class="led on"></span><span class="ttl"></span><span class="muted" style="font-size:11.5px;font-weight:400;margin-left:4px" data-k></span>
      <span class="grow"></span>
      ${popout ? '' : '<button class="btn ghost sm" data-a="pop" title="Buka di tab baru">⧉</button><button class="btn ghost sm" data-a="max" title="Perbesar">▢</button>'}
      <button class="btn ghost sm" data-a="close" title="Tutup">✕</button></div><div class="cwin-term"></div>`;
    el.querySelector('.ttl').textContent = node.name;
    document.body.appendChild(el);
    this.focus();
    el.addEventListener('mousedown', () => this.focus());
    el.querySelector('[data-a=close]').onclick = () => this.close();
    const mx = el.querySelector('[data-a=max]');
    if (mx) mx.onclick = () => { el.classList.toggle('max'); setTimeout(() => this.fitNow(), 30); };
    const pp = el.querySelector('[data-a=pop]');
    if (pp) pp.onclick = () => {
      window.open(`/?console=${labId}:${node.id}&name=${encodeURIComponent(node.name)}`, '_blank', 'width=920,height=580');
      this.close();
    };
    if (!popout) this.dragify(el.querySelector('.cwin-bar'));

    const term = this.term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', fontSize: 13.5, cursorBlink: true,
      scrollback: 8000, convertEol: false, allowProposedApi: true,
      theme: { background: '#000000', foreground: '#E5E5E5', cursor: '#E5E5E5', selectionBackground: '#3A5A80',
               green: '#4EC94E', red: '#F05050', yellow: '#E5C34A', cyan: '#45C8D8', blue: '#5C9DF2', magenta: '#C27DE0' }
    });
    this.fit = new FitAddon.FitAddon();
    term.loadAddon(this.fit);
    term.open(el.querySelector('.cwin-term'));
    this.fitNow();
    this.ro = new ResizeObserver(() => this.fitNow());
    this.ro.observe(el);
    term.onData(d => this.onData(d));
    term.focus();
    this.connect();
  }
  focus() { this.el.style.zIndex = ++Consoles.z; this.term && this.term.focus(); }
  fitNow() {
    try { this.fit.fit(); } catch (e) {}
    if (this.mode === 'raw' && this.ws && this.ws.readyState === 1)
      this.ws.send(JSON.stringify({ t: 'resize', cols: this.term.cols, rows: this.term.rows }));
  }
  dragify(bar) {
    bar.addEventListener('mousedown', e => {
      if (e.target.closest('button') || this.el.classList.contains('max')) return;
      const sx = e.clientX, sy = e.clientY, ox = this.el.offsetLeft, oy = this.el.offsetTop;
      const mv = ev => { this.el.style.left = Math.max(0, ox + ev.clientX - sx) + 'px'; this.el.style.top = Math.max(0, oy + ev.clientY - sy) + 'px'; };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
      e.preventDefault();
    });
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws/console/${this.labId}/${this.node.id}`);
    this.el.querySelector('[data-k]').textContent = 'menghubungkan…';
    ws.onopen = () => { this.el.querySelector('[data-k]').textContent = ''; };
    ws.onclose = () => {
      this.el.querySelector('.led').classList.remove('on');
      this.el.querySelector('[data-k]').textContent = 'terputus — klik di terminal untuk sambung ulang';
      this.term.write('\r\n\x1b[90m[koneksi console tertutup]\x1b[0m\r\n');
      this.dead = true;
    };
    ws.onmessage = ev => this.onMsg(JSON.parse(ev.data));
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  onMsg(m) {
    const t = this.term;
    switch (m.t) {
      case 'mode': this.mode = m.d; if (m.d === 'raw') { this.busy = false; this.fitNow(); } this.el.querySelector('[data-k]').textContent = m.d === 'raw' ? 'console langsung' : ''; break;
      case 'out': t.write(m.d); break;
      case 'prompt':
        this.prompt = m.d; this.echo = m.echo !== false; t.write(m.d); this.busy = false; this.flush(); break;
      case 'help':
        if (m.d) t.write('\r\n' + m.d); t.write(this.prompt + this.buf); this.busy = false; this.flush(); break;
      case 'tab':
        if (m.d) { t.write('\r\x1b[K' + this.prompt + m.d); this.buf = m.d; } else t.write('\x07');
        this.busy = false; this.flush(); break;
      case 'log':
        if (this.busy) t.write(m.d); else t.write('\r\x1b[K' + m.d + this.prompt + this.buf); break;
      case 'clear': t.clear(); t.write('\x1b[2J\x1b[H'); break;
    }
  }
  flush() { if (this.queue) { const q = this.queue; this.queue = ''; this.process(q); } }
  onData(d) {
    if (this.dead) { this.dead = false; this.el.querySelector('.led').classList.add('on'); this.busy = true; this.connect(); return; }
    if (this.mode === 'raw') { this.send({ t: 'data', d }); return; }
    if (this.busy) { this.queue += d; return; }
    this.process(d);
  }
  setLine(s) {
    if (this.echo) this.term.write('\r\x1b[K' + this.prompt + s);
    this.buf = s;
  }
  process(d) {
    const t = this.term;
    const ios = !/^C:\\>$/.test(this.prompt) && this.echo && /[>#]$/.test(this.prompt);
    for (let i = 0; i < d.length; i++) {
      const ch = d[i];
      if (ch === '\x1b') {
        const seq = d.slice(i, i + 3);
        if (seq === '\x1b[A') { if (this.hist.length) { this.hi = Math.max(0, (this.hi < 0 ? this.hist.length : this.hi) - 1); this.setLine(this.hist[this.hi]); } }
        else if (seq === '\x1b[B') { if (this.hi >= 0) { this.hi++; if (this.hi >= this.hist.length) { this.hi = -1; this.setLine(''); } else this.setLine(this.hist[this.hi]); } }
        i += 2; continue;
      }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && d[i + 1] === '\n') i++;
        t.write('\r\n');
        if (this.echo && this.buf.trim()) { this.hist.push(this.buf); if (this.hist.length > 100) this.hist.shift(); }
        this.hi = -1;
        this.send({ t: 'line', d: this.buf });
        this.buf = ''; this.busy = true;
        this.queue = d.slice(i + 1) + this.queue;
        return;
      }
      if (ch === '\x7f' || ch === '\b') { if (this.buf) { this.buf = this.buf.slice(0, -1); if (this.echo) t.write('\b \b'); } continue; }
      if (ch === '\t') { if (ios) { this.send({ t: 'tab', d: this.buf }); this.busy = true; this.queue = d.slice(i + 1) + this.queue; return; } continue; }
      if (ch === '?' && ios) { t.write('?'); this.send({ t: 'help', d: this.buf }); this.busy = true; this.queue = d.slice(i + 1) + this.queue; return; }
      if (ch === '\x1a') { t.write('^Z'); this.buf = ''; this.send({ t: 'ctrl', d: 'z' }); this.busy = true; return; }
      if (ch === '\x03') { t.write('^C\r\n'); this.buf = ''; this.send({ t: 'ctrl', d: 'c' }); this.busy = true; return; }
      if (ch === '\x15') { this.setLine(''); continue; }
      if (ch < ' ') continue;
      this.buf += ch;
      if (this.echo) t.write(ch);
    }
  }
  paste(txt) {
    if (this.mode === 'raw') { this.send({ t: 'data', d: txt.replace(/\r/g, '').replace(/\n/g, '\r') + '\r' }); return; }
    const d = txt.replace(/\r/g, '').split('\n').filter(l => l.trim()).join('\r') + '\r';
    if (this.busy) this.queue += d; else this.process(d);
  }
  close() {
    try { this.ws && this.ws.close(); } catch (e) {}
    this.ro && this.ro.disconnect();
    this.term.dispose();
    this.el.remove();
    delete Consoles.wins[this.labId + ':' + this.node.id];
    if (this.popout) window.close();
  }
}
