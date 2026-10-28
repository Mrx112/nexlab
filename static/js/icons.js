/* Device glyphs (48x48, Cisco/PNETLab style: filled body, white symbol) and UI icons */
const ICON_COLORS = {
  router: '#2A7AC0', firewall: '#C0392B', switch: '#2A7AC0', l3switch: '#1B5A93', pc: '#5D6D7E', laptop: '#5D6D7E',
  server: '#6C7A89', cloud: '#5BA4DE', qemu: '#6A55C9', netns: '#1E2A36', remote: '#34495E',
  hub: '#2A7AC0', ap: '#2A7AC0', olt: '#2C3E50', odp: '#95A5A6', ont: '#95A5A6', printer: '#7F8C8D', ipphone: '#34495E',
  cctv: '#7F8C8D', smartphone: '#2C3E50', tablet: '#2C3E50', iot: '#27AE60'
};
const _B = '#2A7AC0', _BT = '#5BA4DE', _BD = '#1B5A93', _SCR = '#7FB3E0';
function _arr(x1, y1, x2, y2, c = '#fff', w = 1.8, h = 3) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
  const bx = x2 - ux * h * 1.3, by = y2 - uy * h * 1.3, f = v => v.toFixed(1);
  return `<path d="M${f(x1)} ${f(y1)}L${f(bx)} ${f(by)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/><path d="M${f(x2)} ${f(y2)}L${f(bx + px * h)} ${f(by + py * h)}L${f(bx - px * h)} ${f(by - py * h)}Z" fill="${c}"/>`;
}
function _box(y, h, top) {
  // perspective box: front, top, side
  return `<rect x="4" y="${y}" width="34" height="${h}" fill="${_B}" stroke="${_BD}"/><path d="M4 ${y}L${4 + top} ${y - top}H${38 + top}L38 ${y}Z" fill="${_BT}" stroke="${_BD}"/><path d="M38 ${y}L${38 + top} ${y - top}V${y + h - top}L38 ${y + h}Z" fill="${_BD}"/>`;
}
function deviceIcon(type, size) {
  const s = size || 48;
  let g = '';
  switch (type) {
    case 'router':
      g = `<path d="M5 20v9c0 4.4 8.5 8 19 8s19-3.6 19-8v-9z" fill="${_B}" stroke="${_BD}"/><ellipse cx="24" cy="20" rx="19" ry="8" fill="${_BT}" stroke="${_BD}"/>
        ${_arr(21, 18.8, 12.5, 16.2)}${_arr(27, 21.2, 35.5, 23.8)}${_arr(36, 16.4, 28, 19)}${_arr(12, 23.6, 20, 21)}`;
      break;
    case 'switch':
      g = `${_box(22, 14, 7)}${_arr(13, 16.8, 23, 16.8, '#fff', 1.5, 2.2)}${_arr(29, 16.8, 39, 16.8, '#fff', 1.5, 2.2)}${_arr(20, 19.8, 10, 19.8, '#fff', 1.5, 2.2)}${_arr(36, 19.8, 26, 19.8, '#fff', 1.5, 2.2)}`;
      break;
    case 'l3switch':
      g = `${_box(22, 15, 7)}${_arr(13, 16.8, 23, 16.8, '#fff', 1.5, 2.2)}${_arr(29, 16.8, 39, 16.8, '#fff', 1.5, 2.2)}${_arr(20, 19.8, 10, 19.8, '#fff', 1.5, 2.2)}${_arr(36, 19.8, 26, 19.8, '#fff', 1.5, 2.2)}
        <text x="21" y="33.5" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="9">L3</text>`;
      break;
    case 'firewall':
      g = `<rect x="6" y="14" width="30" height="24" fill="#C0392B" stroke="#8E2A20"/><path d="M6 14L12 8H42L36 14Z" fill="#E05A4A" stroke="#8E2A20"/><path d="M36 14L42 8V32L36 38Z" fill="#8E2A20"/>
        <path d="M6 20h30M6 26h30M6 32h30M16 14v6M26 14v6M11 20v6M21 20v6M31 20v6M16 26v6M26 26v6M11 32v6M21 32v6M31 32v6" stroke="#F5C6C0" stroke-width="1"/>`;
      break;
    case 'pc':
      g = `<rect x="6" y="7" width="36" height="26" rx="2" fill="#5D6D7E"/><rect x="9" y="10" width="30" height="20" fill="${_SCR}"/><path d="M9 10h30l-18 20H9z" fill="#fff" opacity=".18"/>
        <path d="M20 33h8l2 5H18z" fill="#4A5866"/><rect x="13" y="38" width="22" height="3" rx="1" fill="#5D6D7E"/>`;
      break;
    case 'laptop':
      g = `<rect x="9" y="9" width="30" height="22" rx="2" fill="#5D6D7E"/><rect x="11.5" y="11.5" width="25" height="17" fill="${_SCR}"/><path d="M4 32h40l-3 6H7z" fill="#85929E" stroke="#5D6D7E"/>`;
      break;
    case 'server':
      g = `<path d="M35 8l4-3v36l-4 3z" fill="#4A5866"/><path d="M13 8l4-3h22l-4 3z" fill="#8C99A6"/><rect x="13" y="8" width="22" height="36" rx="1.5" fill="#6C7A89" stroke="#4A5866"/>
        <rect x="16" y="12" width="16" height="3" fill="#AEB6BF"/><rect x="16" y="17" width="16" height="3" fill="#AEB6BF"/><rect x="16" y="22" width="16" height="3" fill="#AEB6BF"/><circle cx="29" cy="38" r="1.7" fill="#2ECC71"/>`;
      break;
    case 'cloud':
      g = `<path d="M14 36h21a8 8 0 0 0 1-16 11 11 0 0 0-21-2 9 9 0 0 0-1 18z" fill="#E3EEF8" stroke="${_B}" stroke-width="2"/>`;
      break;
    case 'qemu':
      g = `<path d="M24 6L40 14L24 22L8 14Z" fill="#9B8AE6"/><path d="M8 14L24 22V42L8 34Z" fill="#6A55C9"/><path d="M24 22L40 14V34L24 42Z" fill="#4B3A9E"/><path d="M24 9.5l9 4.5-9 4.5-9-4.5z" fill="none" stroke="#fff" stroke-width="1.3" opacity=".7"/>`;
      break;
    case 'netns':
      g = `<rect x="5" y="9" width="38" height="30" rx="3" fill="#1E2A36" stroke="#0F161D"/><path d="M5 15V12a3 3 0 0 1 3-3h32a3 3 0 0 1 3 3v3z" fill="#34495E"/>
        <path d="M11 21l5 4-5 4" fill="none" stroke="#2ECC71" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 30h10" stroke="#2ECC71" stroke-width="2.2" stroke-linecap="round"/>`;
      break;
    case 'remote':
      g = `<rect x="4" y="15" width="40" height="18" rx="2" fill="#34495E" stroke="#22313F"/>${[9, 14, 19, 24, 29].map(x => `<rect x="${x}" y="21" width="3.6" height="5" fill="#ECF0F1"/>`).join('')}
        <circle cx="37" cy="21" r="1.6" fill="#2ECC71"/><circle cx="37" cy="27" r="1.6" fill="#F39C12"/>`;
      break;
    case 'hub':
      g = `${_box(25, 10, 6)}${_arr(22, 21.5, 12, 21.5, '#fff', 1.5, 2.2)}${_arr(24, 21.5, 36, 21.5, '#fff', 1.5, 2.2)}`;
      break;
    case 'ap':
      g = `<path d="M7 28v4c0 3.9 7.6 7 17 7s17-3.1 17-7v-4z" fill="${_B}" stroke="${_BD}"/><ellipse cx="24" cy="28" rx="17" ry="7" fill="${_BT}" stroke="${_BD}"/><circle cx="24" cy="28" r="2" fill="#fff"/>
        <path d="M17 17a10 10 0 0 1 14 0M13 12a16 16 0 0 1 22 0" fill="none" stroke="${_B}" stroke-width="2.4" stroke-linecap="round"/>`;
      break;
    case 'olt':
      g = `<rect x="4" y="12" width="40" height="24" rx="2" fill="#2C3E50" stroke="#1A252F"/><path d="M4 18h40" stroke="#1A252F"/>
        ${[8, 13, 18, 23, 28, 33].map(x => `<rect x="${x}" y="22" width="3.6" height="4" fill="${_SCR}"/><rect x="${x}" y="29" width="3.6" height="4" fill="${_SCR}"/>`).join('')}
        <circle cx="9" cy="15" r="1.4" fill="#2ECC71"/><circle cx="13" cy="15" r="1.4" fill="#2ECC71"/><circle cx="17" cy="15" r="1.4" fill="#F39C12"/><circle cx="40" cy="27" r="1.6" fill="#2ECC71"/>`;
      break;
    case 'odp':
      g = `<rect x="11" y="7" width="26" height="34" rx="3" fill="#95A5A6" stroke="#707B7C"/><path d="M24 12v7M24 19l-7 8M24 19l7 8M24 19v8M17 27v8M31 27v8M24 27v8" fill="none" stroke="#E67E22" stroke-width="1.9" stroke-linecap="round"/>`;
      break;
    case 'ont':
      g = `<path d="M33 18l3-9" stroke="#7F8C8D" stroke-width="2" stroke-linecap="round"/><rect x="6" y="18" width="36" height="16" rx="4" fill="#ECF0F1" stroke="#95A5A6"/>
        <circle cx="13" cy="26" r="1.8" fill="#2ECC71"/><circle cx="19" cy="26" r="1.8" fill="#2ECC71"/><circle cx="25" cy="26" r="1.8" fill="#F39C12"/><path d="M30 26h7" stroke="#95A5A6" stroke-width="2"/>`;
      break;
    case 'printer':
      g = `<rect x="13" y="8" width="22" height="11" fill="#fff" stroke="#95A5A6"/><rect x="6" y="18" width="36" height="15" rx="2" fill="#7F8C8D"/><rect x="12" y="28" width="24" height="12" fill="#fff" stroke="#95A5A6"/>
        <path d="M16 32h16M16 36h12" stroke="#BDC3C7"/><circle cx="37" cy="22" r="1.5" fill="#2ECC71"/>`;
      break;
    case 'ipphone':
      g = `<rect x="12" y="11" width="28" height="29" rx="3" fill="#34495E"/><rect x="6" y="9" width="7" height="31" rx="3" fill="#22313F"/><rect x="17" y="15" width="18" height="7" rx="1" fill="${_SCR}"/>
        ${[18, 25, 32].map(x => [26, 31, 36].map(y => `<rect x="${x - 1.4}" y="${y - 1.2}" width="2.8" height="2.4" rx=".6" fill="#ECF0F1"/>`).join('')).join('')}`;
      break;
    case 'cctv':
      g = `<path d="M20 25l3 8h-9M14 33v6" fill="none" stroke="#7F8C8D" stroke-width="2" stroke-linecap="round"/><path d="M7 15l26-6 5 10-26 6z" fill="#ECF0F1" stroke="#7F8C8D" stroke-width="1.5"/><circle cx="33" cy="15" r="2.6" fill="#2C3E50"/>`;
      break;
    case 'smartphone':
      g = `<rect x="15" y="5" width="18" height="38" rx="3.5" fill="#2C3E50"/><rect x="17" y="9" width="14" height="27" fill="${_SCR}"/><circle cx="24" cy="39.5" r="1.5" fill="#95A5A6"/>`;
      break;
    case 'tablet':
      g = `<rect x="8" y="7" width="32" height="34" rx="3.5" fill="#2C3E50"/><rect x="11" y="10" width="26" height="26" fill="${_SCR}"/><circle cx="24" cy="38.5" r="1.4" fill="#95A5A6"/>`;
      break;
    case 'iot':
      g = `<circle cx="24" cy="29" r="10" fill="#27AE60"/><rect x="20" y="25" width="8" height="8" rx="1" fill="#fff"/><path d="M17 14a10 10 0 0 1 14 0M13 9a16 16 0 0 1 22 0" fill="none" stroke="#27AE60" stroke-width="2.4" stroke-linecap="round"/>`;
      break;
    default:
      g = `<circle cx="24" cy="24" r="15" fill="${_B}" stroke="${_BD}"/>`;
  }
  return `<svg viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">${g}</svg>`;
}
const _ui = (p, fill) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${p}</svg>`;
const UI = {
  play: _ui('<path d="M7 5l12 7-12 7z"/>', 1),
  stop: _ui('<rect x="6" y="6" width="12" height="12" rx="1.5"/>', 1),
  cable: _ui('<path d="M4 18c5 0 4-12 9-12h7M4 18h3M17 6v-2M20 6V4"/><circle cx="4" cy="18" r="2"/>'),
  term: _ui('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>'),
  note: _ui('<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>'),
  back: _ui('<path d="M15 5l-7 7 7 7"/>'),
  plus: _ui('<path d="M12 5v14M5 12h14"/>'),
  down: _ui('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  up: _ui('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  fit: _ui('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  ping: _ui('<path d="M3 7h14l-3-3M21 17H7l3 3"/>'),
  wipe: _ui('<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>'),
  addobj: _ui('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  nodes: _ui('<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="15" width="7" height="6" rx="1"/><path d="M6.5 10v2.5h11V10M12 12.5V15"/>'),
  links: _ui('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 7.5l8 9M8.5 6h7"/>'),
  file: _ui('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>'),
  cube: _ui('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  more: _ui('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>', 1),
  refresh: _ui('<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5"/>'),
  gauge: _ui('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/><circle cx="12" cy="17" r="1.3"/>'),
  info: _ui('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  help: _ui('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17v.5"/>'),
  close: _ui('<path d="M6 6l12 12M18 6L6 18"/>'),
  door: _ui('<path d="M14 4H6v16h8M10 12h10M17 9l3 3-3 3"/>'),
  logout: _ui('<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H10"/>'),
  edit: _ui('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: _ui('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  user: _ui('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  lock: _ui('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  folder: _ui('<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'),
  lab: _ui('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><circle cx="9" cy="13" r="1.5"/><circle cx="15" cy="13" r="1.5"/><circle cx="12" cy="17.5" r="1.5"/><path d="M10.5 13h3M9.8 14.3l1.4 2M14.2 14.3l-1.4 2"/>'),
  home: _ui('<path d="M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5"/>'),
  users: _ui('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
  search: _ui('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  caret: _ui('<path d="M7 10l5 5 5-5"/>', 1),
  plug: _ui('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>'),
  eye: _ui('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  spark: _ui('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  check: _ui('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  mail: _ui('<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>'),
  mailplus: _ui('<rect x="2" y="6" width="15" height="11" rx="1.5"/><path d="M2.5 7l7 5.5 7-5.5M20 4v6M17 7h6"/>'),
  book: _ui('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16M8 7h7M8 11h5"/>'),
  sim: _ui('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  clock: _ui('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  moon: _ui('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  pointer: _ui('<path d="M5 3l14 8-6 1.5L10 19z"/>'),
  rect: _ui('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: _ui('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  line: _ui('<path d="M5 19L19 5"/>'),
  image: _ui('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
};
