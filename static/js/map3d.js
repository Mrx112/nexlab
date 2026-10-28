/* NexLab — Peta 3D: bangunan bertingkat, instalasi perangkat, jalur kabel rapi, fiber (OLT/ODC/ODP/ONT), antena PtP */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const esc3 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- catalog
// mount: floor | desk | wall | low | ceiling | pole | mast | ground
const CAT = {
  rack:     { label: 'Rack 19"', g: 'in', mount: 'floor', size: [0.6, 2.0, 0.8], color: 0x2B3446, port: 1.7 },
  router:   { label: 'Router', g: 'in', mount: 'desk', size: [0.35, 0.06, 0.25], color: 0xFF9E3D, port: 0.03 },
  switch:   { label: 'Switch', g: 'in', mount: 'wall', size: [0.44, 0.05, 0.3], color: 0x4FE3D1, port: 0.03 },
  patch:    { label: 'Patch panel', g: 'in', mount: 'wall', size: [0.44, 0.045, 0.1], color: 0x9AA8BC, y: 1.9, port: 0.02 },
  ap:       { label: 'Access Point', g: 'in', mount: 'ceiling', size: [0.22, 0.04, 0.22], color: 0xE8F4FF, round: true, port: 0 },
  ont:      { label: 'ONT / Modem', g: 'in', mount: 'wall', size: [0.2, 0.05, 0.16], color: 0xFFFFFF, y: 1.3, port: 0.02 },
  pc:       { label: 'PC', g: 'in', mount: 'desk', size: [0.5, 0.35, 0.05], color: 0x1E2633, port: 0.1 },
  laptop:   { label: 'Laptop', g: 'in', mount: 'desk', size: [0.34, 0.02, 0.24], color: 0x9AA8BC, port: 0.01 },
  printer:  { label: 'Printer', g: 'in', mount: 'desk', size: [0.45, 0.25, 0.4], color: 0xD7DEE8, port: 0.1 },
  phone:    { label: 'IP Phone', g: 'in', mount: 'desk', size: [0.2, 0.08, 0.2], color: 0x2B3446, port: 0.04 },
  cctv:     { label: 'CCTV', g: 'in', mount: 'ceiling', size: [0.12, 0.12, 0.2], color: 0xF2F5F9, port: 0 },
  outlet:   { label: 'Outlet RJ45', g: 'in', mount: 'low', size: [0.09, 0.09, 0.02], color: 0xF2F5F9, port: 0 },
  olt:      { label: 'OLT', g: 'out', mount: 'floor', size: [0.6, 1.4, 0.6], color: 0x364B66, port: 1.2 },
  odc:      { label: 'ODC (kabinet)', g: 'out', mount: 'ground', size: [0.9, 1.4, 0.4], color: 0x7D8B9C, port: 1.1 },
  pole:     { label: 'Tiang 7 m', g: 'out', mount: 'ground', size: [0.18, 7, 0.18], color: 0x8A94A3, cyl: true, port: 6.6 },
  tower:    { label: 'Tower 18 m', g: 'out', mount: 'ground', size: [1.2, 18, 1.2], color: 0xC9524C, lattice: true, port: 17.5 },
  odp:      { label: 'ODP (di tiang)', g: 'out', mount: 'pole', size: [0.3, 0.42, 0.14], color: 0xE8E8E8, y: 5.2, port: 0.2 },
  closure:  { label: 'Joint closure', g: 'out', mount: 'pole', size: [0.14, 0.45, 0.14], color: 0x222831, cyl: true, y: 6.2, port: 0.2 },
  handhole: { label: 'Handhole', g: 'out', mount: 'ground', size: [0.8, 0.12, 0.8], color: 0x59616D, port: 0 },
  dish:     { label: 'Antena PtP (dish)', g: 'wl', mount: 'mast', size: [0.6, 0.6, 0.25], color: 0xF2F5F9, gain: 25, port: 0 },
  sector:   { label: 'Antena sektor', g: 'wl', mount: 'mast', size: [0.15, 0.8, 0.1], color: 0xF2F5F9, gain: 16, port: 0 },
  omni:     { label: 'Antena omni', g: 'wl', mount: 'mast', size: [0.05, 1.0, 0.05], color: 0xF2F5F9, cyl: true, gain: 9, port: 0 },
};
const CABLES = {
  utp:      { label: 'UTP Cat6', color: 0x3D7DFF, r: 0.022, slack: 3, unit: 'm' },
  fiber:    { label: 'Fiber SM (feeder/distribusi)', color: 0xFFD23D, r: 0.035, slack: 0.05, unit: 'm' },
  drop:     { label: 'Drop cable FO', color: 0x15181D, r: 0.02, slack: 0.08, unit: 'm' },
  coax:     { label: 'Coaxial', color: 0xECECEC, r: 0.025, slack: 2, unit: 'm' },
  power:    { label: 'Kabel listrik', color: 0xD9343F, r: 0.025, slack: 2, unit: 'm' },
  wireless: { label: 'Link wireless', color: 0x4FE3D1, r: 0, slack: 0, unit: 'km' },
};
const BUILDINGS = {
  house2: { label: 'Rumah 2 lantai', w: 10, d: 8, floors: 2, fh: 3, style: 'house' },
  house1: { label: 'Rumah 1 lantai', w: 9, d: 7, floors: 1, fh: 3.2, style: 'house' },
  office3: { label: 'Kantor 3 lantai', w: 20, d: 12, floors: 3, fh: 3.6, style: 'office' },
  hall: { label: 'Gedung 1 lantai', w: 14, d: 10, floors: 1, fh: 4, style: 'office' },
};
const SPLIT_LOSS = { '1:2': 3.6, '1:4': 7.2, '1:8': 10.5, '1:16': 13.8, '1:32': 17.1 };
const HOUSE_ROOF = 1.8;

// ---------------------------------------------------------------- templates
function tplHouseFTTH() {
  const B = (id, name, x, z, t) => Object.assign({ id, name, x, z }, BUILDINGS[t], { label: undefined });
  const O = (id, type, name, x, z, b = null, floor = 0, props = {}) => ({ id, type, name, x, z, b, floor, props });
  const C = (id, a, b, kind, route = 'auto') => ({ id, a, b, kind, route });
  return {
    buildings: [B('B1', 'Rumah Pelanggan', 0, 0, 'house2'), Object.assign(B('B2', 'STO / Sentral', -48, -22, 'hall'), { w: 9, d: 7 })],
    objects: [
      O('O1', 'olt', 'OLT-STO', -50, -22, 'B2', 0, { tx: 4 }), O('O2', 'rack', 'Rack STO', -48, -22, 'B2', 0),
      O('O3', 'odc', 'ODC-01', -34, -13, null, 0, { ratio: '1:4' }),
      O('O4', 'pole', 'Tiang 1', -28, -10), O('O5', 'pole', 'Tiang 2', -17, -10), O('O6', 'pole', 'Tiang 3', -6, -10),
      O('O7', 'odp', 'ODP-01', -6, -10, null, 0, { ratio: '1:8' }),
      O('O8', 'ont', 'ONT Rumah', -4.2, -3.8, 'B1', 0), O('O9', 'router', 'Router WiFi', -3.4, -3.4, 'B1', 0),
      O('O10', 'ap', 'AP Lt.1', 0, 0, 'B1', 0), O('O11', 'ap', 'AP Lt.2', 0.5, 0, 'B1', 1),
      O('O12', 'cctv', 'CCTV Teras', 4.6, -3.6, 'B1', 0), O('O13', 'outlet', 'Outlet R. Kerja', 3.5, 3.85, 'B1', 1),
      O('O14', 'pc', 'PC R. Kerja', 3.5, 3.2, 'B1', 1), O('O15', 'laptop', 'Laptop', 2, 1, 'B1', 0),
      O('O16', 'outlet', 'Outlet TV', -4.85, 2.5, 'B1', 0),
    ],
    cables: [C('K1', 'O1', 'O3', 'fiber', 'buried'), C('K2', 'O3', 'O7', 'fiber', 'aerial'), C('K3', 'O7', 'O8', 'drop', 'aerial'),
      C('K4', 'O8', 'O9', 'utp'), C('K5', 'O9', 'O10', 'utp'), C('K6', 'O9', 'O11', 'utp'), C('K7', 'O9', 'O12', 'utp'),
      C('K8', 'O9', 'O13', 'utp'), C('K9', 'O13', 'O14', 'utp'), C('K10', 'O9', 'O16', 'utp'), C('K11', 'O10', 'O15', 'wireless')],
    settings: {},
  };
}
function tplCampus() {
  const O = (id, type, name, x, z, b = null, floor = 0, props = {}) => ({ id, type, name, x, z, b, floor, props });
  const C = (id, a, b, kind, route = 'auto') => ({ id, a, b, kind, route });
  const objs = [O('A1', 'rack', 'Rack Gedung A', -8, -4.5, 'GA', 0), O('A2', 'switch', 'Core SW A', -8.6, -5.6, 'GA', 0),
    O('B1o', 'rack', 'Rack Gedung B', 258, 87, 'GB', 0), O('B2o', 'switch', 'SW B', 257.4, 85.4, 'GB', 0),
    O('D1', 'dish', 'PtP Gedung A', 6, 3, 'GA', 3, { ghz: 5.8, tx: 17 }), O('D2', 'dish', 'PtP Gedung B', 254, 87, 'GB', 2, { ghz: 5.8, tx: 17 }),
    ...[1, 2, 3, 4, 5, 6].map(i => O('P' + i, 'pole', 'Tiang ' + i, 12 + i * 36, 6 + i * 11))];
  const cabs = [C('W1', 'D1', 'D2', 'wireless'), C('F1', 'A1', 'B1o', 'fiber', 'aerial'), C('U1', 'A2', 'D1', 'utp'), C('U2', 'B2o', 'D2', 'utp')];
  for (let f = 0; f < 3; f++) {
    objs.push(O('SA' + f, 'switch', `SW A Lt.${f + 1}`, -9.4, -5.6, 'GA', f), O('AA' + f, 'ap', `AP A Lt.${f + 1}`, 0, 0, 'GA', f), O('AB' + f, 'ap', `AP A Lt.${f + 1} timur`, 7, 2, 'GA', f));
    if (f) cabs.push(C('UA' + f, 'A2', 'SA' + f, 'utp'));
    cabs.push(C('UAA' + f, 'SA' + f, 'AA' + f, 'utp'), C('UAB' + f, 'SA' + f, 'AB' + f, 'utp'));
  }
  for (let f = 0; f < 2; f++) { objs.push(O('BA' + f, 'ap', `AP B Lt.${f + 1}`, 260, 90, 'GB', f)); cabs.push(C('UBA' + f, 'B2o', 'BA' + f, 'utp')); }
  return {
    buildings: [Object.assign({ id: 'GA', name: 'Gedung A' , x: 0, z: 0 }, BUILDINGS.office3, { label: undefined }),
      Object.assign({ id: 'GB', name: 'Gedung B', x: 260, z: 90, w: 16, d: 10, floors: 2, fh: 3.6, style: 'office' })],
    objects: objs, cables: cabs, settings: {},
  };
}
const MAP_TEMPLATES = { house: ['Rumah 2 lantai + FTTH (OLT–ODC–ODP–ONT)', tplHouseFTTH], campus: ['2 gedung + PtP wireless + fiber cadangan', tplCampus] };

// ---------------------------------------------------------------- helpers
function labelSprite(text, color = '#DCE6F2', bg = 'rgba(10,19,34,.82)', scale = 1) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fs = 44;
  ctx.font = `600 ${fs}px "Chakra Petch", "Segoe UI", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w; c.height = fs + 26;
  ctx.font = `600 ${fs}px "Chakra Petch", "Segoe UI", sans-serif`;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, c.height, 14) : ctx.rect(0, 0, w, c.height); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 18, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(w / c.height * 0.032 * scale, 0.032 * scale, 1);
  sp.renderOrder = 10;
  return sp;
}
const dist = (a, b) => a.distanceTo(b);
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }

export class Map3D {
  constructor(host, editor) {
    this.host = host; this.ed = editor; this.alive = true;
    this.data = editor.lab.map3d && editor.lab.map3d.buildings ? editor.lab.map3d : { buildings: [], objects: [], cables: [], settings: {} };
    this.data.settings = this.data.settings || {};
    this.tool = 'select'; this.cableKind = 'utp'; this.sel = null; this.pendingCable = null;
    this.showFloor = 'all'; this.xray = true; this.labels = true; this.tab = 'prop';
    this.buildUI();
    this.initThree();
    this.rebuild();
    this.frameAll();
    this.loop();
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const pal = (g) => Object.entries(CAT).filter(([, c]) => c.g === g).map(([k, c]) => `<button class="m3-item" data-place="${k}">${esc3(c.label)}</button>`).join('');
    this.host.innerHTML = `<div class="m3">
      <aside class="m3-pal">
        <h4>Bangunan</h4>${Object.entries(BUILDINGS).map(([k, b]) => `<button class="m3-item" data-bld="${k}">${esc3(b.label)}</button>`).join('')}
        <h4>Template peta</h4>${Object.entries(MAP_TEMPLATES).map(([k, t]) => `<button class="m3-item m3-tpl" data-tpl="${k}">${esc3(t[0])}</button>`).join('')}
        <h4>Dalam ruangan</h4>${pal('in')}
        <h4>Luar / Fiber</h4>${pal('out')}
        <h4>Wireless</h4>${pal('wl')}
      </aside>
      <div class="m3-stage">
        <div class="m3-bar">
          <button class="btn sm on" data-tool="select">Pilih / geser</button>
          <button class="btn sm" data-tool="cable">Tarik kabel</button>
          <select class="input m3-sel" id="m3Kind" title="Jenis kabel">${Object.entries(CABLES).map(([k, c]) => `<option value="${k}">${esc3(c.label)}</option>`).join('')}</select>
          <span class="sep"></span>
          <label class="muted" for="m3Floor">Lantai</label><select class="input m3-sel" id="m3Floor" style="width:90px"></select>
          <label class="check"><input type="checkbox" id="m3X" checked> Dinding tembus</label>
          <label class="check"><input type="checkbox" id="m3L" checked> Label</label>
          <span class="grow"></span>
          <button class="btn sm" id="m3Fit">Kamera</button>
          <button class="btn sm danger" id="m3Del">Hapus</button>
        </div>
        <div class="m3-canvas" id="m3c"></div>
        <div class="m3-hint" id="m3hint"></div>
      </div>
      <aside class="m3-side">
        <div class="m3-tabs">${[['prop', 'Properti'], ['cable', 'Kabel'], ['bom', 'Material'], ['budget', 'Budget'], ['tips', 'Standar']].map(([k, l]) => `<button data-tab="${k}" class="${k === 'prop' ? 'act' : ''}">${l}</button>`).join('')}</div>
        <div class="m3-panel" id="m3p"></div>
      </aside></div>`;
    const $ = s => this.host.querySelector(s);
    this.$ = $;
    this.host.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => this.setTool(b.dataset.tool));
    this.host.querySelectorAll('[data-place]').forEach(b => b.onclick = () => this.setTool('place:' + b.dataset.place));
    this.host.querySelectorAll('[data-bld]').forEach(b => b.onclick = () => this.setTool('bld:' + b.dataset.bld));
    this.host.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => this.applyTemplate(b.dataset.tpl));
    this.host.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.host.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('act', x === b)); this.panel(); });
    $('#m3Kind').onchange = e => { this.cableKind = e.target.value; this.setTool('cable'); };
    $('#m3Floor').onchange = e => { this.showFloor = e.target.value; this.rebuild(); };
    $('#m3X').onchange = e => { this.xray = e.target.checked; this.rebuild(); };
    $('#m3L').onchange = e => { this.labels = e.target.checked; this.rebuild(); };
    $('#m3Fit').onclick = () => this.frameAll();
    $('#m3Del').onclick = () => this.deleteSel();
    this.keyH = e => {
      if (!this.alive || this.host.classList.contains('hidden') || e.target.closest('input,textarea,select')) return;
      if (e.key === 'Delete') this.deleteSel();
      if (e.key === 'Escape') this.setTool('select');
    };
    addEventListener('keydown', this.keyH);
  }
  hint(t) { const h = this.$('#m3hint'); h.textContent = t || ''; h.style.display = t ? 'block' : 'none'; }
  setTool(t) {
    this.tool = t; this.pendingCable = null;
    this.host.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    this.host.querySelectorAll('[data-place],[data-bld]').forEach(b => b.classList.toggle('on', t === 'place:' + b.dataset.place || t === 'bld:' + b.dataset.bld));
    if (t === 'cable') this.hint(`Tarik ${CABLES[this.cableKind].label}: klik perangkat pertama, lalu perangkat tujuan. Jalur dibuat otomatis lewat tray plafon & riser.`);
    else if (t.startsWith('place:')) this.hint(`Klik lantai bangunan atau tanah untuk menaruh ${CAT[t.slice(6)].label}. Perangkat tiang (ODP/closure) diklik di dekat tiang.`);
    else if (t.startsWith('bld:')) this.hint(`Klik di tanah untuk menaruh ${BUILDINGS[t.slice(4)].label}.`);
    else this.hint('');
    this.renderer && (this.renderer.domElement.style.cursor = t === 'select' ? 'default' : 'crosshair');
  }

  // ---------------------------------------------------------------- three setup
  initThree() {
    const el = this.$('#m3c');
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(r.domElement);
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0B1626);
    scene.fog = new THREE.Fog(0x0B1626, 160, 420);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
    this.camera.position.set(30, 28, 34);
    const ctl = this.controls = new OrbitControls(this.camera, r.domElement);
    ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.495; ctl.screenSpacePanning = false;
    scene.add(new THREE.HemisphereLight(0xCFE3FF, 0x1A2333, 1.1));
    const sun = new THREE.DirectionalLight(0xFFF2DD, 1.6); sun.position.set(40, 80, 30); scene.add(sun);
    const ground = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x1A2A2A, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.userData.ground = true; scene.add(ground);
    const grid = new THREE.GridHelper(600, 120, 0x2A4060, 0x1B2C42); grid.position.y = 0.01; scene.add(grid);
    this.world = new THREE.Group(); scene.add(this.world);
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    const ro = this.ro = new ResizeObserver(() => this.resize()); ro.observe(el);
    this.resize();
    const dom = r.domElement;
    dom.addEventListener('pointerdown', e => this.onDown(e));
    dom.addEventListener('pointermove', e => this.onMove(e));
    dom.addEventListener('pointerup', e => this.onUp(e));
    dom.addEventListener('dblclick', e => this.onDbl(e));
  }
  resize() {
    const el = this.$('#m3c'); const w = el.clientWidth || 800, h = el.clientHeight || 600;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  loop() {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(() => this.loop());
    if (this.paused) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.resize(); }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('keydown', this.keyH); this.renderer.dispose(); }
  frameAll() {
    const pts = [];
    this.data.buildings.forEach(b => pts.push([b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]));
    this.data.objects.filter(o => !o.b).forEach(o => pts.push([o.x, o.z]));
    if (!pts.length) { this.camera.position.set(30, 28, 34); this.controls.target.set(0, 0, 0); return; }
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(24, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.05 + 10;
    this.controls.target.set(cx, 2, cz);
    this.camera.position.set(cx + span * 0.42, span * 0.55, cz + span * 0.62);
    this.scene.fog.near = Math.max(160, span * 2.2); this.scene.fog.far = Math.max(420, span * 5); this.camera.far = Math.max(1200, span * 6); this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- model helpers
  bld(id) { return this.data.buildings.find(b => b.id === id); }
  obj(id) { return this.data.objects.find(o => o.id === id); }
  nextId(p) { let i = 1; const ids = new Set([...this.data.buildings, ...this.data.objects, ...this.data.cables].map(x => x.id)); while (ids.has(p + i)) i++; return p + i; }
  floorY(o) { const b = o.b && this.bld(o.b); return b ? (o.floor || 0) * b.fh : 0; }
  roofY(b) { return b.floors * b.fh + 0.15; }
  hostPole(o) {
    if (o.host) { const p = this.obj(o.host); if (p) return p; }
    return this.data.objects.find(p => (p.type === 'pole' || p.type === 'tower') && Math.hypot(p.x - o.x, p.z - o.z) < 1.5);
  }
  baseY(o) {
    const c = CAT[o.type], b = o.b && this.bld(o.b), f = this.floorY(o);
    switch (c.mount) {
      case 'floor': case 'ground': return f;
      case 'desk': return f + 0.75;
      case 'wall': return f + (c.y || 1.6);
      case 'low': return f + 0.3;
      case 'ceiling': return f + (b ? b.fh : 3) - 0.12 - c.size[1];
      case 'pole': { const p = this.hostPole(o); return p ? Math.min(CAT[p.type].size[1] - 1.6, c.y) : c.y; }
      case 'mast': {
        if (b && (o.floor || 0) >= b.floors) return this.roofY(b) + (b.style === 'house' ? HOUSE_ROOF : 0) + 1.6;
        const p = this.hostPole(o); if (p) return CAT[p.type].size[1] - 0.3;
        return f + 6;
      }
    }
    return f;
  }
  port(o) { const c = CAT[o.type]; return new THREE.Vector3(o.x, this.baseY(o) + (c.port || 0) + (c.mount === 'ceiling' ? 0 : 0), o.z); }
  trayY(b, floor) { return floor * b.fh + b.fh - 0.38; }
  riser(b) { return { x: b.x - b.w / 2 + 0.45, z: b.z - b.d / 2 + 0.45 }; }
  inside(b, x, z) { return Math.abs(x - b.x) <= b.w / 2 + 0.01 && Math.abs(z - b.z) <= b.d / 2 + 0.01; }

  // ---------------------------------------------------------------- routing
  indoorTo(o, tx, tz, ty, off) {
    // path from object port up to tray, along tray (x then z) to (tx,tz), at height ty
    const b = this.bld(o.b), p = this.port(o), y = this.trayY(b, o.floor || 0);
    const pts = [p.clone(), new THREE.Vector3(p.x + off, y, p.z + off)];
    if (Math.abs(y - ty) > 0.01) {
      const r = this.riser(b);
      pts.push(new THREE.Vector3(r.x + off, y, p.z + off), new THREE.Vector3(r.x + off, y, r.z + off), new THREE.Vector3(r.x + off, ty, r.z + off));
      pts.push(new THREE.Vector3(tx + off, ty, r.z + off));
    } else pts.push(new THREE.Vector3(tx + off, y, p.z + off));
    pts.push(new THREE.Vector3(tx + off, ty, tz + off));
    return pts;
  }
  entry(b, toward, floor) {
    // point on building wall nearest to a target xz, at tray height of floor
    const hx = b.w / 2, hz = b.d / 2;
    const dx = toward.x - b.x, dz = toward.z - b.z;
    let x, z, ox = 0, oz = 0;
    if (Math.abs(dx) / hx > Math.abs(dz) / hz) { x = b.x + Math.sign(dx) * hx; z = Math.max(b.z - hz + 0.6, Math.min(b.z + hz - 0.6, toward.z)); ox = Math.sign(dx); }
    else { z = b.z + Math.sign(dz) * hz; x = Math.max(b.x - hx + 0.6, Math.min(b.x + hx - 0.6, toward.x)); oz = Math.sign(dz); }
    const y = this.trayY(b, floor);
    return { in: new THREE.Vector3(x, y, z), out: new THREE.Vector3(x + ox * 0.4, y, z + oz * 0.4) };
  }
  sagSpan(a, b, pts) {
    const span = Math.hypot(b.x - a.x, b.z - a.z), sag = Math.max(0.15, span * 0.02);
    const n = Math.max(2, Math.min(16, Math.ceil(span / 4)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t));
    }
  }
  outdoor(P, Q, route, pts, skip) {
    if (route === 'buried') {
      pts.push(new THREE.Vector3(P.x, -0.8, P.z), new THREE.Vector3(Q.x, -0.8, Q.z), Q.clone());
      return;
    }
    // aerial: pass through poles lying near the straight line
    const poles = this.data.objects.filter(o => (o.type === 'pole' || o.type === 'tower') && !skip.includes(o.id)).map(o => {
      const vx = Q.x - P.x, vz = Q.z - P.z, L2 = vx * vx + vz * vz || 1;
      const t = ((o.x - P.x) * vx + (o.z - P.z) * vz) / L2;
      const px = P.x + vx * t, pz = P.z + vz * t;
      return { o, t, d: Math.hypot(o.x - px, o.z - pz) };
    }).filter(p => p.t > 0.04 && p.t < 0.96 && p.d < 9).sort((a, b) => a.t - b.t);
    let cur = P;
    poles.forEach(p => {
      const w = new THREE.Vector3(p.o.x + 0.12, CAT[p.o.type].size[1] - 0.9, p.o.z);
      this.sagSpan(cur, w, pts); cur = w;
    });
    this.sagSpan(cur, Q, pts);
  }
  route(c, idx) {
    const a = this.obj(c.a), b = this.obj(c.b);
    if (!a || !b) return null;
    const off = ((idx % 7) - 3) * 0.035;
    if (c.kind === 'wireless') return [this.port(a), this.port(b)];
    const ba = a.b && this.bld(a.b), bb = b.b && this.bld(b.b);
    const isIn = (o, B) => B && CAT[o.type].mount !== 'mast' && (o.floor || 0) < B.floors;
    const ina = isIn(a, ba), inb = isIn(b, bb);
    if (ina && inb && a.b === b.b) {
      const pb = this.port(b);
      const pts = this.indoorTo(a, pb.x, pb.z, this.trayY(ba, b.floor || 0), off);
      pts.push(pb);
      return pts;
    }
    const route = c.route === 'auto' || !c.route ? (c.kind === 'utp' ? 'buried' : 'aerial') : c.route;
    let start, end, tailB = [];
    const pts = [];
    if (ina) {
      const e = this.entry(ba, inb ? bb : b, a.floor || 0);
      this.indoorTo(a, e.in.x, e.in.z, e.in.y, off).forEach(p => pts.push(p));
      pts.push(e.out.clone()); start = e.out;
    } else { start = this.port(a); pts.push(start.clone()); }
    if (inb) {
      const e = this.entry(bb, ina ? ba : a, b.floor || 0);
      const back = this.indoorTo(b, e.in.x, e.in.z, e.in.y, -off).reverse();
      tailB = [e.out.clone(), ...back]; end = e.out;
    } else end = this.port(b);
    this.outdoor(start, end, route, pts, [a.id, b.id]);
    if (tailB.length) tailB.slice(1).forEach(p => pts.push(p));
    return pts;
  }
  wirelessInfo(c) {
    const a = this.obj(c.a), b = this.obj(c.b), pa = this.port(a), pb = this.port(b);
    const d = dist(pa, pb), km = d / 1000;
    const ghz = +(a.props?.ghz || b.props?.ghz || 5.8), tx = +(a.props?.tx || 23);
    const ga = CAT[a.type].gain || 3, gb = CAT[b.type].gain || 3;
    const fspl = 20 * Math.log10(Math.max(km, 0.001)) + 20 * Math.log10(ghz * 1000) + 32.44;
    const rssi = tx + ga + gb - 2 - fspl;
    const rF = 17.32 * Math.sqrt(Math.max(km, 0.001) / (4 * ghz));
    // LOS & Fresnel vs buildings
    let blocked = false, fres = false;
    const own = new Set([a.b, b.b].filter(Boolean));
    const indoor = (a.type === 'ap' || b.type === 'ap') && a.b && a.b === b.b;
    if (indoor) {
      const floors = Math.abs((a.floor || 0) - (b.floor || 0));
      const walls = 1 + floors * 3;
      const r = 20 + 3 - (40 + 20 * Math.log10(Math.max(d, 1))) - walls * 4;
      return { d, km, ghz: 2.4, rssi: r, fspl: 0, rF: 0, blocked: false, fres: false, indoor: true, q: r >= -65 ? 'Bagus' : r >= -75 ? 'Cukup' : 'Lemah' };
    }
    for (let i = 1; i < 30; i++) {
      const t = i / 30, p = pa.clone().lerp(pb, t);
      const r = rF * Math.sqrt(4 * t * (1 - t)) * 0.6;
      if (p.y - r < 0) fres = true;
      for (const B of this.data.buildings) {
        if (own.has(B.id) && (t < 0.15 || t > 0.85)) continue;
        const top = this.roofY(B) + (B.style === 'house' ? HOUSE_ROOF : 0);
        if (Math.abs(p.x - B.x) <= B.w / 2 && Math.abs(p.z - B.z) <= B.d / 2 && p.y < top - 0.05) blocked = true;
        if (Math.abs(p.x - B.x) <= B.w / 2 + r && Math.abs(p.z - B.z) <= B.d / 2 + r && p.y - r < top) fres = true;
      }
    }
    const q = blocked ? 'Terhalang' : rssi > -30 ? 'Terlalu kuat' : rssi >= -65 ? 'Bagus' : rssi >= -75 ? 'Cukup' : 'Lemah';
    return { d, km, ghz, rssi, fspl, rF, blocked, fres, q };
  }

  // ---------------------------------------------------------------- build scene
  mat(color, opts = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.05 }, opts)); }
  rebuild() {
    const W = this.world;
    W.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    W.clear();
    this.pick = [];
    const maxF = Math.max(1, ...this.data.buildings.map(b => b.floors));
    const fs = this.$('#m3Floor');
    if (fs.options.length !== maxF + 1) fs.innerHTML = '<option value="all">Semua</option>' + Array.from({ length: maxF }, (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
    fs.value = this.showFloor;
    const visF = this.showFloor === 'all' ? 99 : +this.showFloor;
    this.data.buildings.forEach(b => this.drawBuilding(b, visF));
    this.data.objects.forEach(o => this.drawObject(o, visF));
    this.cableInfo = {};
    this.data.cables.forEach((c, i) => this.drawCable(c, i, visF));
    this.panel();
  }
  drawBuilding(b, visF) {
    const g = new THREE.Group(); g.userData = { kind: 'bld', id: b.id };
    const sel = this.sel?.kind === 'bld' && this.sel.id === b.id;
    const wallM = this.mat(b.style === 'house' ? 0xE7DCCB : 0xC8D3E2, { transparent: true, opacity: this.xray ? 0.2 : 0.95, depthWrite: !this.xray });
    const slabM = this.mat(sel ? 0x5C7EA8 : 0x7E8DA3);
    const floors = Math.min(b.floors, visF + 1);
    for (let f = 0; f < floors; f++) {
      const y = f * b.fh;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.15, b.d), slabM);
      slab.position.set(b.x, y + 0.075, b.z); slab.userData = { kind: 'floor', b: b.id, floor: f }; g.add(slab); this.pick.push(slab);
      const h = b.fh - 0.15, t = 0.15;
      [[b.w, h, t, 0, -b.d / 2], [b.w, h, t, 0, b.d / 2], [t, h, b.d, -b.w / 2, 0], [t, h, b.d, b.w / 2, 0]].forEach(([w, hh, d, dx, dz]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), wallM);
        m.position.set(b.x + dx, y + 0.15 + hh / 2, b.z + dz); m.userData = { kind: 'wall', b: b.id }; g.add(m);
      });
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, b.fh, b.d)), new THREE.LineBasicMaterial({ color: sel ? 0xFF9E3D : 0x5D7699 }));
      edges.position.set(b.x, y + b.fh / 2, b.z); g.add(edges);
      if (b.style === 'house') { // interior partition with door gap
        const pm = this.mat(0xD9CDB9, { transparent: true, opacity: this.xray ? 0.15 : 0.9, depthWrite: !this.xray });
        const px = b.x + b.w * 0.1;
        const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, b.d * 0.38), pm); p1.position.set(px, y + 0.15 + h / 2, b.z - b.d * 0.31); g.add(p1);
        const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, b.d * 0.38), pm); p2.position.set(px, y + 0.15 + h / 2, b.z + b.d * 0.31); g.add(p2);
      }
      if (b.floors > 1 && f < b.floors - 1) { // stairs
        const sm = this.mat(0x9A8B7A);
        for (let s = 0; s < 12; s++) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.3), sm);
          st.position.set(b.x + b.w / 2 - 0.7, y + 0.15 + (s + 0.5) * (b.fh / 12), b.z - b.d / 2 + 1.2 + s * 0.28); g.add(st);
        }
      }
      // cable tray outline under ceiling (visual guide)
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), this.mat(0xFFC23D));
      const r = this.riser(b); tray.position.set(r.x, y + b.fh - 0.38, r.z); g.add(tray);
    }
    // riser shaft
    if (b.floors > 1) {
      const r = this.riser(b);
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.25, Math.min(b.floors, floors) * b.fh, 0.25), this.mat(0xFFC23D, { transparent: true, opacity: 0.35 }));
      sh.position.set(r.x, Math.min(b.floors, floors) * b.fh / 2, r.z); g.add(sh);
    }
    if (floors === b.floors) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 0.2, b.d + 0.3), this.mat(b.style === 'house' ? 0x7A4436 : 0x6B7A8F, { transparent: this.xray, opacity: this.xray ? 0.22 : 1, depthWrite: !this.xray }));
      roof.position.set(b.x, this.roofY(b), b.z); roof.userData = { kind: 'roof', b: b.id, floor: b.floors }; g.add(roof); this.pick.push(roof);
      if (b.style === 'house') {
        const geo = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
        const pr = new THREE.Mesh(geo, this.mat(0x9C4F3A, { transparent: this.xray, opacity: this.xray ? 0.16 : 1, depthWrite: !this.xray, flatShading: true }));
        pr.scale.set((b.w + 0.6) / Math.SQRT2, HOUSE_ROOF, (b.d + 0.6) / Math.SQRT2); pr.rotation.y = Math.PI / 4;
        pr.position.set(b.x, this.roofY(b) + HOUSE_ROOF / 2 + 0.1, b.z); pr.userData = { kind: 'roof', b: b.id, floor: b.floors }; g.add(pr); this.pick.push(pr);
      }
    }
    if (this.labels) { const l = labelSprite(b.name, '#FFC23D', 'rgba(10,19,34,.85)', 0.85); l.position.set(b.x, this.roofY(b) + (b.style === 'house' ? HOUSE_ROOF : 0) + 1.5, b.z); g.add(l); }
    this.world.add(g);
  }
  drawObject(o, visF) {
    const c = CAT[o.type]; if (!c) return;
    if (o.b && (o.floor || 0) > visF && (o.floor || 0) < (this.bld(o.b)?.floors || 0)) return;
    const g = new THREE.Group(); g.userData = { kind: 'obj', id: o.id };
    const y = this.baseY(o);
    const sel = this.sel?.kind === 'obj' && this.sel.id === o.id;
    const m = this.mat(c.color, sel ? { emissive: 0xFF9E3D, emissiveIntensity: 0.55 } : {});
    let mesh;
    const [sx, sy, sz] = c.size;
    if (c.lattice) {
      mesh = new THREE.Group();
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, sy, 6), m);
        leg.position.set(dx * sx / 2 * 0.6, sy / 2, dz * sz / 2 * 0.6); leg.rotation.z = -dx * 0.02; leg.rotation.x = dz * 0.02; mesh.add(leg);
      }
      for (let k = 1; k < 9; k++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(sx * 0.42 * (1 - k * 0.04), 0.03, 4, 4), m); ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 4; ring.position.y = k * sy / 9; mesh.add(ring); }
    } else if (c.cyl) {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2 * 1.1, sy, 10), m); mesh.position.y = sy / 2;
    } else if (o.type === 'dish') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(sx / 2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), this.mat(c.color, { side: THREE.DoubleSide, emissive: sel ? 0xFF9E3D : 0, emissiveIntensity: 0.5 }));
      mesh.rotation.x = Math.PI / 2;
      const peer = this.data.cables.find(k => k.kind === 'wireless' && (k.a === o.id || k.b === o.id));
      const wrap = new THREE.Group(); wrap.add(mesh);
      if (peer) { const other = this.obj(peer.a === o.id ? peer.b : peer.a); if (other) wrap.lookAt(new THREE.Vector3(other.x - o.x, this.baseY(other) - y, other.z - o.z)); wrap.rotateY(Math.PI); }
      mesh = wrap;
    } else if (c.round) {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 20), m); mesh.position.y = sy / 2;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); mesh.position.y = sy / 2;
    }
    g.add(mesh);
    if (c.mount === 'desk') { // small desk
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.6), this.mat(0x6B5A48)); desk.position.y = -0.02; g.add(desk);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.72, 0.04), this.mat(0x4A3E32)); leg.position.set(0, -0.4, 0.26); g.add(leg);
    }
    if (c.mount === 'mast' || (c.mount === 'pole' && !this.hostPole(o))) {
      const pole = this.hostPole(o);
      const base = (o.b && (o.floor || 0) >= (this.bld(o.b)?.floors || 0)) ? this.roofY(this.bld(o.b)) + (this.bld(o.b).style === 'house' ? HOUSE_ROOF : 0) : this.floorY(o);
      if (!pole) { const mh = y - base; const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, mh, 6), this.mat(0xAEB8C6)); mast.position.y = -mh / 2; g.add(mast); }
    }
    if (c.mount === 'pole') { const p = this.hostPole(o); if (p) g.position.x += 0.18; }
    g.position.x += o.x; g.position.z += o.z; g.position.y = y;
    g.traverse(x => { if (x.isMesh) { x.userData = { kind: 'obj', id: o.id }; this.pick.push(x); } });
    if (this.labels && (sel || (['rack', 'olt', 'odc', 'odp', 'pole', 'tower', 'dish', 'sector', 'ont', 'router'].includes(o.type) || (this.showFloor !== 'all' && o.type === 'ap')))) {
      const l = labelSprite(o.name, sel ? '#FF9E3D' : '#DCE6F2', 'rgba(10,19,34,.78)', 0.62);
      l.position.set(0, (c.lattice || c.cyl ? sy : Math.max(sy, 0.3)) + 0.45, 0); g.add(l);
    }
    this.world.add(g);
  }
  drawCable(c, i, visF) {
    const pts = this.route(c, i); if (!pts || pts.length < 2) return;
    const K = CABLES[c.kind] || CABLES.utp;
    const sel = this.sel?.kind === 'cable' && this.sel.id === c.id;
    const info = { len: polyLen(pts) };
    if (c.kind === 'wireless') {
      const w = this.wirelessInfo(c); Object.assign(info, w);
      const col = w.blocked ? 0xFF5468 : w.fres ? 0xFFC23D : 0x3BE37A;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: col, dashSize: 0.8, gapSize: 0.5 }));
      line.computeLineDistances(); line.userData = { kind: 'cable', id: c.id }; this.world.add(line);
      if (CAT[this.obj(c.a).type].g === 'wl' && CAT[this.obj(c.b).type].g === 'wl') {
        const mid = pts[0].clone().lerp(pts[1], 0.5), len = pts[0].distanceTo(pts[1]);
        const ell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: sel ? 0.5 : 0.18 }));
        ell.scale.set(w.rF, w.rF, len / 2); ell.position.copy(mid); ell.lookAt(pts[1]); this.world.add(ell);
      }
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, info.len, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(pts[0].clone().lerp(pts[1], 0.5)); hit.lookAt(pts[1]); hit.rotateX(Math.PI / 2); hit.userData = { kind: 'cable', id: c.id }; this.world.add(hit); this.pick.push(hit);
    } else {
      const path = new THREE.CurvePath();
      for (let k = 1; k < pts.length; k++) if (pts[k].distanceTo(pts[k - 1]) > 0.001) path.add(new THREE.LineCurve3(pts[k - 1], pts[k]));
      const seg = Math.min(400, Math.max(8, path.curves.length * 6));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, seg, sel ? K.r * 2.2 : K.r * 1.25, 6, false),
        this.mat(sel ? 0xFF9E3D : K.color, { emissive: sel ? 0xFF9E3D : (c.kind === 'drop' ? 0x222830 : 0x000000), emissiveIntensity: sel ? 0.6 : 0.3 }));
      tube.userData = { kind: 'cable', id: c.id }; this.world.add(tube); this.pick.push(tube);
      // cable tray under indoor horizontal tray-height segments
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k - 1], q = pts[k];
        if (Math.abs(p.y - q.y) < 0.01 && p.y > 0.5 && p.distanceTo(q) > 0.3) {
          const B = this.data.buildings.find(b => this.inside(b, (p.x + q.x) / 2, (p.z + q.z) / 2) && Math.abs(((p.y + 0.38) % b.fh)) < 0.05);
          if (!B) continue;
          const len = p.distanceTo(q);
          const tr = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, len), this.mat(0x8C96A4, { metalness: 0.5 }));
          tr.position.set((p.x + q.x) / 2, p.y - 0.05, (p.z + q.z) / 2); tr.lookAt(q.x, p.y - 0.05, q.z); this.world.add(tr);
        }
      }
    }
    this.cableInfo[c.id] = info;
  }

  // ---------------------------------------------------------------- interaction
  hits(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    return this.ray.intersectObjects([...this.pick, this.ground], false);
  }
  onDown(e) {
    if (e.button !== 0) return;
    this.downAt = [e.clientX, e.clientY];
    const hs = this.hits(e);
    const h = hs[0]; if (!h) return;
    const ud = h.object.userData;
    if (this.tool === 'select' && (ud.kind === 'obj' || ud.kind === 'floor' || ud.kind === 'roof')) {
      const id = ud.kind === 'obj' ? ud.id : ud.b, kind = ud.kind === 'obj' ? 'obj' : 'bld';
      if (this.sel && this.sel.kind === kind && this.sel.id === id) {
        const item = kind === 'obj' ? this.obj(id) : this.bld(id);
        const y = kind === 'obj' ? this.baseY(item) : 0;
        this.drag = { kind, item, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), sx: item.x, sz: item.z, start: h.point.clone(), moved: false };
        this.controls.enabled = false;
      }
    }
  }
  onMove(e) {
    const d = this.drag; if (!d) return;
    const p = new THREE.Vector3();
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    if (!this.ray.ray.intersectPlane(d.plane, p)) return;
    const snap = v => Math.round(v * 10) / 10;
    let nx = snap(d.sx + p.x - d.start.x), nz = snap(d.sz + p.z - d.start.z);
    if (d.kind === 'obj' && d.item.b) { const B = this.bld(d.item.b); nx = Math.max(B.x - B.w / 2 + 0.2, Math.min(B.x + B.w / 2 - 0.2, nx)); nz = Math.max(B.z - B.d / 2 + 0.2, Math.min(B.z + B.d / 2 - 0.2, nz)); }
    if (d.kind === 'bld') { const dx = nx - d.item.x, dz = nz - d.item.z; this.data.objects.forEach(o => { if (o.b === d.item.id) { o.x += dx; o.z += dz; } }); }
    d.item.x = nx; d.item.z = nz; d.moved = true;
    clearTimeout(this.dragT); this.dragT = setTimeout(() => this.rebuild(), 16);
  }
  onUp(e) {
    const moved = this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 4;
    if (this.drag) { const dm = this.drag.moved; this.drag = null; this.controls.enabled = true; if (dm) { this.rebuild(); this.save(); return; } }
    if (moved) return;
    const h = this.hits(e)[0]; if (!h) return;
    const ud = h.object.userData;
    const t = this.tool;
    if (t.startsWith('bld:')) {
      const T = BUILDINGS[t.slice(4)];
      const id = this.nextId('B');
      this.data.buildings.push({ id, name: `${T.label} ${this.data.buildings.length + 1}`, x: Math.round(h.point.x), z: Math.round(h.point.z), w: T.w, d: T.d, floors: T.floors, fh: T.fh, style: T.style });
      this.sel = { kind: 'bld', id }; this.setTool('select'); this.rebuild(); this.save(); return;
    }
    if (t.startsWith('place:')) {
      const type = t.slice(6), c = CAT[type];
      let b = null, floor = 0, x = h.point.x, z = h.point.z;
      if (ud.kind === 'floor' || ud.kind === 'roof') { b = ud.b; floor = ud.floor; }
      else if (ud.kind === 'obj') { const o = this.obj(ud.id); b = o.b; floor = o.floor || 0; x = o.x + 0.4; z = o.z; if (o.type === 'pole' || o.type === 'tower') { b = null; x = o.x; z = o.z; } }
      if (c.mount !== 'mast' && b && floor >= this.bld(b).floors) floor = this.bld(b).floors - 1;
      if (c.g === 'in' && !b && type !== 'olt') { App.toast('Perangkat dalam ruangan harus ditaruh di lantai bangunan', true); return; }
      const B = b && this.bld(b);
      if (B && c.mount === 'wall' || B && c.mount === 'low') { // snap to nearest wall
        const dx = [B.x - B.w / 2 + 0.1 - x, B.x + B.w / 2 - 0.1 - x], dz = [B.z - B.d / 2 + 0.1 - z, B.z + B.d / 2 - 0.1 - z];
        const all = [[Math.abs(dx[0]), 'x', dx[0]], [Math.abs(dx[1]), 'x', dx[1]], [Math.abs(dz[0]), 'z', dz[0]], [Math.abs(dz[1]), 'z', dz[1]]].sort((p, q) => p[0] - q[0]);
        if (all[0][1] === 'x') x += all[0][2]; else z += all[0][2];
      }
      const id = this.nextId('O');
      const n = this.data.objects.filter(o => o.type === type).length + 1;
      const o = { id, type, name: `${c.label.replace(/ \(.*\)/, '')} ${n}`, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, b, floor, props: {} };
      if (type === 'odp' || type === 'odc') o.props.ratio = type === 'odp' ? '1:8' : '1:4';
      if (type === 'olt') o.props.tx = 4;
      if (c.g === 'wl') { o.props.ghz = 5.8; o.props.tx = 23; }
      if (c.mount === 'pole') { const p = this.hostPole(o); if (p) { o.host = p.id; o.x = p.x; o.z = p.z; } }
      this.data.objects.push(o);
      this.sel = { kind: 'obj', id };
      if (!e.shiftKey) this.setTool('select');
      this.rebuild(); this.save(); return;
    }
    if (t === 'cable') {
      if (ud.kind !== 'obj') return;
      if (!this.pendingCable) { this.pendingCable = ud.id; this.hint(`Dari ${this.obj(ud.id).name} → klik perangkat tujuan (Esc batal)`); return; }
      if (this.pendingCable === ud.id) return;
      const a = this.obj(this.pendingCable), b = this.obj(ud.id);
      if (this.cableKind === 'wireless' && !(CAT[a.type].g === 'wl' || CAT[b.type].g === 'wl' || a.type === 'ap' || b.type === 'ap')) { App.toast('Link wireless butuh antena atau access point di salah satu ujung', true); return; }
      const id = this.nextId('K');
      this.data.cables.push({ id, a: a.id, b: b.id, kind: this.cableKind, route: 'auto' });
      this.pendingCable = null; this.sel = { kind: 'cable', id };
      this.setTool('cable'); this.rebuild(); this.save(); this.tab = 'prop'; this.panel();
      return;
    }
    // select
    if (ud.kind === 'obj') this.sel = { kind: 'obj', id: ud.id };
    else if (ud.kind === 'floor' || ud.kind === 'roof' || ud.kind === 'wall') this.sel = { kind: 'bld', id: ud.b };
    else if (ud.kind === 'cable') this.sel = { kind: 'cable', id: ud.id };
    else this.sel = null;
    this.rebuild();
  }
  onDbl(e) {
    const h = this.hits(e)[0]; if (!h || h.object.userData.kind !== 'obj') return;
    const o = this.obj(h.object.userData.id);
    if (o && o.node) { const n = this.ed.nodeById(+o.node); if (n) this.ed.openConsole(n); }
  }
  deleteSel() {
    const s = this.sel; if (!s) return;
    if (s.kind === 'bld') {
      if (!confirm('Hapus bangunan beserta perangkat & kabel di dalamnya?')) return;
      const ids = this.data.objects.filter(o => o.b === s.id).map(o => o.id);
      this.data.objects = this.data.objects.filter(o => o.b !== s.id);
      this.data.cables = this.data.cables.filter(c => !ids.includes(c.a) && !ids.includes(c.b));
      this.data.buildings = this.data.buildings.filter(b => b.id !== s.id);
    } else if (s.kind === 'obj') {
      this.data.objects = this.data.objects.filter(o => o.id !== s.id);
      this.data.cables = this.data.cables.filter(c => c.a !== s.id && c.b !== s.id);
    } else if (s.kind === 'cable') this.data.cables = this.data.cables.filter(c => c.id !== s.id);
    this.sel = null; this.rebuild(); this.save();
  }
  applyTemplate(k) {
    if ((this.data.buildings.length || this.data.objects.length) && !confirm('Ganti seluruh peta 3D dengan template ini?')) return;
    this.data = MAP_TEMPLATES[k][1]();
    this.sel = null; this.rebuild(); this.frameAll(); this.save();
    App.toast('Template dimuat. Klik objek untuk melihat detail, tab Material & Budget untuk perhitungan.');
  }
  save() {
    clearTimeout(this.saveT);
    this.ed.lab.map3d = this.data;
    this.saveT = setTimeout(() => App.api('PUT', `/api/labs/${this.ed.id}/map3d`, { map3d: this.data }), 600);
  }

  // ---------------------------------------------------------------- side panel
  panel() {
    const p = this.$('#m3p'); if (!p) return;
    const fn = { prop: 'panelProp', cable: 'panelCables', bom: 'panelBom', budget: 'panelBudget', tips: 'panelTips' }[this.tab];
    p.innerHTML = this[fn]();
    this.bindPanel(p);
  }
  fld(label, key, val, type = 'text', extra = '') { return `<div class="field"><label>${label}</label><input class="input mono" data-k="${key}" type="${type}" value="${esc3(val ?? '')}" ${extra}></div>`; }
  panelProp() {
    const s = this.sel;
    if (!s) return `<h3>Peta 3D</h3><p class="muted">${this.data.buildings.length} bangunan, ${this.data.objects.length} perangkat, ${this.data.cables.length} kabel.</p>
      <div class="tip"><b>Mulai cepat:</b> pilih template di kiri, atau taruh <b>Rumah 2 lantai</b>, lalu taruh perangkat (router, AP, outlet) di lantainya. Pilih <b>Tarik kabel</b> untuk menyambung: jalur dibuat rapi lewat tray plafon dan riser antar lantai.</div>
      <div class="tip">Klik objek untuk memilih, klik lagi lalu seret untuk memindahkan. Seret kanan/kiri mouse untuk memutar kamera, scroll untuk zoom. Klik ganda perangkat yang terhubung ke node topologi untuk membuka console.</div>`;
    if (s.kind === 'bld') {
      const b = this.bld(s.id); if (!b) return '';
      return `<h3>${esc3(b.name)}</h3>${this.fld('Nama', 'name', b.name)}
        <div class="row">${this.fld('X (m)', 'x', b.x, 'number')}${this.fld('Z (m)', 'z', b.z, 'number')}</div>
        <div class="row">${this.fld('Lebar (m)', 'w', b.w, 'number')}${this.fld('Panjang (m)', 'd', b.d, 'number')}</div>
        <div class="row">${this.fld('Jumlah lantai', 'floors', b.floors, 'number', 'min="1" max="20"')}${this.fld('Tinggi lantai (m)', 'fh', b.fh, 'number', 'step="0.1"')}</div>
        <div class="field"><label>Gaya</label><select class="input" data-k="style"><option value="house" ${b.style === 'house' ? 'selected' : ''}>Rumah (atap pelana)</option><option value="office" ${b.style !== 'house' ? 'selected' : ''}>Gedung (atap datar)</option></select></div>
        <div class="tip">Riser kabel (kuning) ada di sudut barat-laut bangunan. Untuk antena di atap: taruh antena dengan mengklik atap.</div>`;
    }
    if (s.kind === 'obj') {
      const o = this.obj(s.id); if (!o) return '';
      const c = CAT[o.type];
      const nodes = this.ed.lab.nodes;
      let h = `<h3>${esc3(o.name)}</h3><p class="muted">${esc3(c.label)}${o.b ? ` — ${esc3(this.bld(o.b)?.name)} lantai ${(o.floor || 0) + 1}` : ' — luar ruangan'}</p>
        ${this.fld('Nama / label', 'name', o.name)}<div class="row">${this.fld('X', 'x', o.x, 'number', 'step="0.1"')}${this.fld('Z', 'z', o.z, 'number', 'step="0.1"')}</div>`;
      if (o.b) h += `<div class="field"><label>Lantai</label><select class="input" data-k="floor">${Array.from({ length: this.bld(o.b).floors + (c.mount === 'mast' ? 1 : 0) }, (_, i) => `<option value="${i}" ${i === (o.floor || 0) ? 'selected' : ''}>${i === this.bld(o.b).floors ? 'Atap' : 'Lantai ' + (i + 1)}</option>`).join('')}</select></div>`;
      if (['odp', 'odc'].includes(o.type)) h += `<div class="field"><label>Rasio splitter</label><select class="input" data-pk="ratio">${Object.keys(SPLIT_LOSS).map(r => `<option ${r === o.props.ratio ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`;
      if (o.type === 'olt') h += this.fld('Daya kirim OLT (dBm)', 'p:tx', o.props.tx ?? 4, 'number', 'step="0.5"');
      if (c.g === 'wl') h += `<div class="row">${this.fld('Frekuensi (GHz)', 'p:ghz', o.props.ghz ?? 5.8, 'number', 'step="0.1"')}${this.fld('Daya (dBm)', 'p:tx', o.props.tx ?? 23, 'number')}</div><p class="muted" style="font-size:12.5px">Gain antena: ${c.gain} dBi</p>`;
      h += `<div class="field"><label>Hubungkan ke node topologi</label><select class="input" data-k="node"><option value="">—</option>${nodes.map(n => `<option value="${n.id}" ${String(n.id) === String(o.node) ? 'selected' : ''}>${esc3(n.name)}</option>`).join('')}</select></div>`;
      const cs = this.data.cables.filter(k => k.a === o.id || k.b === o.id);
      if (cs.length) h += `<h5>Kabel terhubung</h5><div class="iflist">${cs.map(k => `<div data-selc="${k.id}" style="cursor:pointer"><span>${esc3(CABLES[k.kind].label)}</span><span class="muted">${esc3(this.obj(k.a === o.id ? k.b : k.a)?.name || '')} ${this.lenTxt(k)}</span></div>`).join('')}</div>`;
      return h;
    }
    if (s.kind === 'cable') {
      const k = this.data.cables.find(x => x.id === s.id); if (!k) return '';
      const info = this.cableInfo[k.id] || {}, K = CABLES[k.kind];
      let h = `<h3>${esc3(K.label)}</h3><dl class="kv"><dt>Dari</dt><dd>${esc3(this.obj(k.a)?.name)}</dd><dt>Ke</dt><dd>${esc3(this.obj(k.b)?.name)}</dd>
        <dt>Panjang jalur</dt><dd>${this.lenTxt(k)}</dd>${k.kind !== 'wireless' ? `<dt>Dengan slack</dt><dd>${this.withSlack(k).toFixed(1)} m</dd>` : ''}</dl>`;
      if (k.kind === 'wireless') h += `<dl class="kv" style="margin-top:10px"><dt>Frekuensi</dt><dd>${info.ghz} GHz</dd><dt>FSPL</dt><dd>${info.fspl?.toFixed(1)} dB</dd><dt>RSSI estimasi</dt><dd><b class="${info.q === 'Bagus' ? 'yes' : info.q === 'Cukup' ? '' : 'no'}">${info.rssi?.toFixed(1)} dBm (${info.q})</b></dd>
          ${info.indoor ? '<dt>Jenis</dt><dd>WiFi dalam ruangan (estimasi redaman dinding/lantai)</dd>' : ''}<dt>Line of sight</dt><dd>${info.blocked ? '<span class="no">terhalang bangunan</span>' : '<span class="yes">bersih</span>'}</dd><dt>Fresnel 60%</dt><dd>${info.fres ? '<span style="color:var(--amber)">terganggu — naikkan tiang/antena</span>' : '<span class="yes">bebas</span>'} (r = ${info.rF?.toFixed(2)} m)</dd></dl>`;
      h += `<div class="field" style="margin-top:12px"><label>Jenis</label><select class="input" data-ck="kind">${Object.entries(CABLES).map(([v, c]) => `<option value="${v}" ${v === k.kind ? 'selected' : ''}>${esc3(c.label)}</option>`).join('')}</select></div>`;
      if (k.kind !== 'wireless') h += `<div class="field"><label>Jalur luar ruangan</label><select class="input" data-ck="route">${[['auto', 'Otomatis'], ['aerial', 'Udara (lewat tiang)'], ['buried', 'Tanam (pipa HDPE)']].map(([v, l]) => `<option value="${v}" ${v === (k.route || 'auto') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      h += `<div class="field"><label>Label kabel</label><input class="input mono" data-ck="label" value="${esc3(k.label || '')}" placeholder="mis. L1-R02-P05"></div>`;
      if (k.kind === 'utp' && info.len > 90) h += `<div class="tip"><b class="no">Melebihi 90 m.</b> UTP permanent link maksimal 90 m. Gunakan fiber atau tambahkan switch di tengah.</div>`;
      return h;
    }
    return '';
  }
  lenTxt(k) { const i = this.cableInfo[k.id]; if (!i) return '-'; return k.kind === 'wireless' ? `${(i.len / 1000).toFixed(3)} km` : `${i.len.toFixed(1)} m`; }
  withSlack(k) { const i = this.cableInfo[k.id]; if (!i) return 0; const K = CABLES[k.kind]; return K.slack < 1 ? i.len * (1 + K.slack) + (k.kind === 'fiber' ? 10 : 2) : i.len + K.slack; }
  panelCables() {
    if (!this.data.cables.length) return '<p class="muted">Belum ada kabel. Pilih "Tarik kabel" di toolbar.</p>';
    return `<table class="t"><tr><th>Jenis</th><th>Rute</th><th style="text-align:right">Panjang</th></tr>${this.data.cables.map(k => `<tr data-selc="${k.id}" style="cursor:pointer">
      <td><span class="led" style="background:#${CABLES[k.kind].color.toString(16).padStart(6, '0')}"></span> ${esc3(CABLES[k.kind].label)}${k.label ? `<br><span class="muted mono">${esc3(k.label)}</span>` : ''}</td>
      <td style="font-size:12.5px">${esc3(this.obj(k.a)?.name)} → ${esc3(this.obj(k.b)?.name)}</td><td style="text-align:right" class="mono">${this.lenTxt(k)}</td></tr>`).join('')}</table>
      <div class="ins-actions"><button class="btn sm" id="m3csv">Unduh tabel kabel (CSV)</button></div>`;
  }
  bom() {
    const objs = {}; this.data.objects.forEach(o => objs[CAT[o.type].label] = (objs[CAT[o.type].label] || 0) + 1);
    const cab = {}; let rj45 = 0, sc = 0, trayLen = 0, clamps = 0;
    this.data.cables.forEach(k => {
      if (k.kind === 'wireless') return;
      cab[CABLES[k.kind].label] = (cab[CABLES[k.kind].label] || 0) + this.withSlack(k);
      if (k.kind === 'utp') rj45 += 2;
      if (k.kind === 'fiber' || k.kind === 'drop') sc += 2;
      const pts = this.route(k, 0) || [];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        if (Math.abs(p.y - q.y) < 0.01 && p.y > 0.5 && this.data.buildings.some(b => this.inside(b, (p.x + q.x) / 2, (p.z + q.z) / 2))) trayLen += p.distanceTo(q);
      }
      if (k.kind !== 'utp') clamps += 2 + pts.filter(p => this.data.objects.some(o => o.type === 'pole' && Math.abs(o.x + 0.12 - p.x) < 0.01 && Math.abs(o.z - p.z) < 0.01)).length * 2;
    });
    return { objs, cab, rj45, sc, trayLen: trayLen * 0.6, clamps };
  }
  panelBom() {
    const b = this.bom();
    return `<h5>Perangkat</h5><table class="t">${Object.entries(b.objs).map(([k, v]) => `<tr><td>${esc3(k)}</td><td style="text-align:right">${v} unit</td></tr>`).join('') || '<tr><td class="muted">-</td></tr>'}</table>
      <h5>Kabel (termasuk slack/service loop)</h5><table class="t">${Object.entries(b.cab).map(([k, v]) => `<tr><td>${esc3(k)}</td><td style="text-align:right" class="mono">${v.toFixed(1)} m</td></tr>`).join('') || '<tr><td class="muted">-</td></tr>'}
      ${b.cab['UTP Cat6'] ? `<tr><td class="muted">≈ box UTP 305 m</td><td style="text-align:right">${Math.ceil(b.cab['UTP Cat6'] / 305)} box</td></tr>` : ''}</table>
      <h5>Aksesoris</h5><table class="t"><tr><td>Konektor RJ45</td><td style="text-align:right">${b.rj45} pcs (+10% cadangan: ${Math.ceil(b.rj45 * 1.1)})</td></tr>
      <tr><td>Konektor SC/APC fiber</td><td style="text-align:right">${b.sc} pcs</td></tr><tr><td>Cable tray (estimasi, kabel digabung)</td><td style="text-align:right">${b.trayLen.toFixed(1)} m</td></tr>
      <tr><td>Klem tiang / dead-end</td><td style="text-align:right">${b.clamps} pcs</td></tr><tr><td>Label kabel</td><td style="text-align:right">${this.data.cables.filter(k => k.kind !== 'wireless').length * 2} pcs</td></tr></table>
      <div class="ins-actions"><button class="btn sm" id="m3bom">Unduh daftar material (CSV)</button></div>`;
  }
  budget() {
    const fibers = this.data.cables.filter(k => k.kind === 'fiber' || k.kind === 'drop');
    const adj = {}; fibers.forEach(k => { (adj[k.a] = adj[k.a] || []).push([k.b, k]); (adj[k.b] = adj[k.b] || []).push([k.a, k]); });
    const out = [];
    this.data.objects.filter(o => o.type === 'olt').forEach(olt => {
      const seen = new Set([olt.id]);
      const walk = (id, acc) => {
        (adj[id] || []).forEach(([nx, k]) => {
          if (seen.has(nx)) return; seen.add(nx);
          const o = this.obj(nx), len = (this.cableInfo[k.id]?.len || 0);
          const a = { km: acc.km + len / 1000, split: acc.split + (SPLIT_LOSS[o.props?.ratio] && ['odp', 'odc'].includes(o.type) ? SPLIT_LOSS[o.props.ratio] : 0), con: acc.con + 2, splice: acc.splice + (o.type === 'closure' ? 2 : 0), path: [...acc.path, o.name] };
          if (o.type === 'ont') {
            const loss = a.km * 0.35 + a.con * 0.5 + a.splice * 0.1 + a.split, tx = +(olt.props?.tx ?? 4), rx = tx - loss;
            out.push({ ont: o.name, olt: olt.name, km: a.km, loss, rx, path: a.path, st: rx > -8 ? 'Terlalu kuat' : rx >= -25 ? 'Baik' : rx >= -27 ? 'Kritis' : 'Gagal' });
          }
          walk(nx, a);
        });
      };
      walk(olt.id, { km: 0, split: 0, con: 0, splice: 0, path: [olt.name] });
    });
    return out;
  }
  panelBudget() {
    const fb = this.budget();
    const wl = this.data.cables.filter(k => k.kind === 'wireless').map(k => ({ k, i: this.cableInfo[k.id] || {} }));
    let h = `<h5>Power budget fiber (OLT → ONT)</h5>`;
    h += fb.length ? fb.map(r => `<div class="tip"><b>${esc3(r.ont)}</b> <span class="${r.st === 'Baik' ? 'yes' : 'no'}" style="float:right">${r.rx.toFixed(2)} dBm — ${r.st}</span><br>
      <span class="muted" style="font-size:12px">${esc3(r.path.join(' → '))}</span><br><span class="mono" style="font-size:12px">${(r.km * 1000).toFixed(0)} m fiber, total redaman ${r.loss.toFixed(2)} dB</span></div>`).join('')
      : '<p class="muted">Hubungkan OLT → ODC/ODP → ONT dengan kabel Fiber / Drop untuk melihat perhitungan.</p>';
    h += `<p class="muted" style="font-size:12px">Asumsi: 0,35 dB/km, konektor 0,5 dB, sambungan 0,1 dB, splitter sesuai rasio. Target GPON B+: -8 s/d -27 dBm.</p>`;
    h += `<h5>Link wireless</h5>`;
    h += wl.length ? wl.map(({ k, i }) => `<div class="tip"><b>${esc3(this.obj(k.a)?.name)} ↔ ${esc3(this.obj(k.b)?.name)}</b><br>
      <span class="mono" style="font-size:12px">${((i.len || 0) / 1000).toFixed(3)} km, ${i.ghz} GHz, RSSI ${i.rssi?.toFixed(1)} dBm</span> — <b class="${i.q === 'Bagus' ? 'yes' : i.q === 'Cukup' ? '' : 'no'}">${i.q}</b>${i.fres && !i.blocked ? ' <span style="color:var(--amber)">(Fresnel terganggu)</span>' : ''}</div>`).join('')
      : '<p class="muted">Taruh dua antena (di atap/tiang) lalu tarik kabel jenis Link wireless.</p>';
    return h;
  }
  panelTips() {
    return `<h5>Standar pemasangan yang dipakai peta ini</h5><ul class="g-tips">
      <li>Kabel horizontal naik ke <b>cable tray di bawah plafon</b> (±38 cm dari plafon), berjalan lurus mengikuti sumbu bangunan, lalu turun ke perangkat.</li>
      <li>Perpindahan lantai lewat <b>riser/shaft</b> di sudut bangunan (kuning), bukan menembus lantai sembarangan.</li>
      <li>UTP maks <b>90 m</b> permanent link; slack 3 m (rack + outlet) sudah dihitung di tab Material.</li>
      <li>Kabel paralel diberi jarak kecil sehingga tampak terbundel rapi; di lapangan gunakan velcro tiap 50 cm.</li>
      <li>Fiber udara: jarak tiang 30–50 m, sag ±2% span, klem di tiap tiang; drop cable dari ODP masuk rumah lewat dinding terdekat setinggi plafon.</li>
      <li>Fiber tanam: kedalaman 80 cm dalam pipa HDPE, handhole di belokan.</li>
      <li>Antena PtP: line of sight bersih dan minimal 60% zona Fresnel bebas; elips di peta menunjukkan zona Fresnel.</li>
      <li>Pisahkan jalur data dari listrik minimal 30 cm.</li></ul>
      <button class="btn sm" onclick="Guide.open('cable-management')">Buka panduan manajemen kabel</button>`;
  }
  bindPanel(p) {
    const s = this.sel;
    p.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.k, v = inp.type === 'number' ? +inp.value : inp.value;
      const item = s.kind === 'bld' ? this.bld(s.id) : this.obj(s.id);
      if (s.kind === 'bld' && (k === 'x' || k === 'z')) { const dv = v - item[k]; this.data.objects.forEach(o => { if (o.b === item.id) o[k] += dv; }); }
      if (k === 'floor') item.floor = +v;
      else if (k === 'floors') item.floors = Math.max(1, Math.min(20, Math.round(v)));
      else item[k] = v;
      this.rebuild(); this.save();
    });
    p.querySelectorAll('[data-pk]').forEach(inp => inp.onchange = () => { this.obj(s.id).props[inp.dataset.pk] = inp.value; this.rebuild(); this.save(); });
    p.querySelectorAll('[data-k^="p:"]').forEach(inp => inp.onchange = () => { this.obj(s.id).props[inp.dataset.k.slice(2)] = +inp.value; this.rebuild(); this.save(); });
    p.querySelectorAll('[data-ck]').forEach(inp => inp.onchange = () => { const k = this.data.cables.find(x => x.id === s.id); k[inp.dataset.ck] = inp.value; this.rebuild(); this.save(); });
    p.querySelectorAll('[data-selc]').forEach(r => r.onclick = () => { this.sel = { kind: 'cable', id: r.dataset.selc }; this.tab = 'prop'; this.host.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('act', x.dataset.tab === 'prop')); this.rebuild(); });
    const dl = (name, rows) => { const blob = new Blob(['﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
    const csv = p.querySelector('#m3csv'); if (csv) csv.onclick = () => dl('tabel-kabel.csv', [['ID', 'Label', 'Jenis', 'Dari', 'Ke', 'Panjang (m)', 'Dengan slack (m)'], ...this.data.cables.map(k => [k.id, k.label || '', CABLES[k.kind].label, this.obj(k.a)?.name, this.obj(k.b)?.name, (this.cableInfo[k.id]?.len || 0).toFixed(1), k.kind === 'wireless' ? '' : this.withSlack(k).toFixed(1)])]);
    const bm = p.querySelector('#m3bom'); if (bm) bm.onclick = () => { const b = this.bom(); dl('daftar-material.csv', [['Item', 'Jumlah', 'Satuan'], ...Object.entries(b.objs).map(([k, v]) => [k, v, 'unit']), ...Object.entries(b.cab).map(([k, v]) => [k, v.toFixed(1), 'm']), ['Konektor RJ45', Math.ceil(b.rj45 * 1.1), 'pcs'], ['Konektor SC/APC', b.sc, 'pcs'], ['Cable tray', b.trayLen.toFixed(1), 'm'], ['Klem tiang', b.clamps, 'pcs']]); };
  }
}
