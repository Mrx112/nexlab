"""Translate the supported Packet Tracer logical-topology subset."""
import copy
import json
import re
import xml.etree.ElementTree as ET

from .pkt import decode_pkt, encode_pkt
from .state import running_config
from .state import new_state
from .templates import PROP_DEFAULTS, TEMPLATES, node_ifaces


_MODEL_TYPES = (
    (('2911', 'Router-PT'), 'router'),
    (('3650', '3560'), 'l3switch'),
    (('2960', '2950', '2950T', 'Switch-PT'), 'switch'),
    (('PC-PT',), 'pc'),
    (('Laptop-PT',), 'laptop'),
    (('Server-PT',), 'server'),
    (('Printer-PT',), 'printer'),
    (('AccessPoint-PT',), 'ap'),
    (('Cloud-PT',), 'cloud'),
    (('Hub-PT',), 'hub'),
    (('IP Phone',), 'ipphone'),
    (('Smartphone-PT',), 'smartphone'),
    (('Tablet-PT',), 'tablet'),
)

_EXPORT_DEVICE_MODELS = {
    'router': ('Router', '2911'),
    'firewall': ('Router', '2911'),
    'switch': ('Switch', '2960-24TT'),
    'l3switch': ('Switch', '3650-24PS'),
    'pc': ('PC', 'PC-PT'),
    'laptop': ('Laptop', 'Laptop-PT'),
    'server': ('Server', 'Server-PT'),
    'printer': ('Printer', 'Printer-PT'),
    'ap': ('AccessPoint', 'AccessPoint-PT'),
    'cloud': ('Cloud', 'Cloud-PT'),
    'hub': ('Hub', 'Hub-PT'),
    'ipphone': ('IP Phone', 'IP Phone'),
    'smartphone': ('Smartphone', 'Smartphone-PT'),
    'tablet': ('Tablet', 'Tablet-PT'),
}

_EXPORT_PORTS = {
    'router': {f'GigabitEthernet0/{index}' for index in range(3)},
    'firewall': {f'GigabitEthernet0/{index}' for index in range(3)},
    'switch': ({f'FastEthernet0/{index}' for index in range(1, 25)}
               | {'GigabitEthernet0/1', 'GigabitEthernet0/2'}),
    'l3switch': ({f'GigabitEthernet1/0/{index}' for index in range(1, 25)}
                 | {f'GigabitEthernet1/1/{index}' for index in range(1, 5)}),
    'pc': {'FastEthernet0'},
    'laptop': {'FastEthernet0'},
    'server': {'FastEthernet0'},
    'printer': {'FastEthernet0'},
    'ap': {'GigabitEthernet0'},
    'cloud': {f'eth{index}' for index in range(8)},
    'hub': {f'Port{index}' for index in range(8)},
    'ipphone': {'FastEthernet0'},
    'smartphone': set(),
    'tablet': set(),
}


def _device_type(engine):
    type_element = engine.find('TYPE')
    if type_element is None:
        return None
    model = type_element.get('model', '')
    for models, node_type in _MODEL_TYPES:
        if any(model == candidate or model.startswith(candidate + '-') for candidate in models):
            return node_type
    return None


def _child_text(element, path, default=''):
    child = element.find(path)
    return (child.text or '').strip() if child is not None else default


def _parse_ios_config(node_type, name, text):
    if node_type not in ('router', 'firewall', 'switch', 'l3switch'):
        return None
    props = copy.deepcopy(PROP_DEFAULTS.get(node_type, {}))
    state = new_state(node_type, name, node_ifaces(node_type, props))
    current_iface = None
    current_pool = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line == '!':
            current_iface = current_pool = None
            continue
        parts = line.split()
        if parts[0] == 'hostname' and len(parts) > 1:
            state['hostname'] = ' '.join(parts[1:])
        elif parts[0] == 'interface' and len(parts) > 1:
            current_iface = ' '.join(parts[1:])
            state['ifaces'].setdefault(current_iface, {'shutdown': False})
            current_pool = None
        elif parts[:3] == ['ip', 'dhcp', 'pool'] and len(parts) > 3:
            current_pool = ' '.join(parts[3:])
            state['dhcp_pools'].setdefault(current_pool, {})
            current_iface = None
        elif current_iface:
            iface = state['ifaces'][current_iface]
            if parts[:2] == ['ip', 'address'] and len(parts) >= 4:
                iface.update(ip=parts[2], mask=parts[3])
            elif parts[:2] == ['encapsulation', 'dot1Q'] and len(parts) >= 3:
                iface['encap'] = int(parts[2])
            elif parts[:2] == ['switchport', 'mode'] and len(parts) >= 3:
                iface['mode'] = parts[2]
            elif parts[:2] == ['switchport', 'access'] and len(parts) >= 4 and parts[2] == 'vlan':
                iface['vlan'] = int(parts[3])
            elif parts[0] == 'description' and len(parts) > 1:
                iface['description'] = ' '.join(parts[1:])
            elif parts == ['shutdown']:
                iface['shutdown'] = True
            elif parts == ['no', 'shutdown']:
                iface['shutdown'] = False
        elif current_pool:
            pool = state['dhcp_pools'][current_pool]
            if parts[0] == 'network' and len(parts) >= 3:
                pool.update(network=parts[1], mask=parts[2])
            elif parts[0] == 'default-router' and len(parts) > 1:
                pool['gw'] = parts[1]
            elif parts[0] == 'dns-server' and len(parts) > 1:
                pool['dns'] = parts[1]
        elif parts == ['ip', 'routing']:
            state['ip_routing'] = True
        elif parts == ['no', 'ip', 'routing']:
            state['ip_routing'] = False
        elif parts[:2] == ['ip', 'route'] and len(parts) >= 5:
            state['routes'].append({'network': parts[2], 'mask': parts[3], 'via': parts[4]})
        elif parts[:2] == ['ip', 'dhcp'] and len(parts) >= 3 and parts[2] == 'excluded-address':
            state['dhcp_excluded'].append(parts[3:5])
        elif parts[0] == 'vlan' and len(parts) > 1:
            state['vlans'].setdefault(parts[1], '')
    return state


def _packet_device_rows(root):
    rows = []
    ref_to_node = {}
    warnings = []
    unsupported = 0
    for device in root.findall('./NETWORK/DEVICES/DEVICE'):
        engine = device.find('ENGINE')
        if engine is None:
            unsupported += 1
            continue
        node_type = _device_type(engine)
        if node_type is None or node_type not in TEMPLATES:
            unsupported += 1
            continue
        name = _child_text(engine, 'NAME', f'{TEMPLATES[node_type]["prefix"]}{len(rows) + 1}')[:40]
        props = copy.deepcopy(PROP_DEFAULTS.get(node_type, {}))
        nid = len(rows) + 1
        ifaces = node_ifaces(node_type, props)
        node = {'id': nid, 'type': node_type, 'name': name, 'props': props,
                'ifaces': ifaces, 'x': 0, 'y': 0, 'size': 1, 'lpos': 'bottom'}
        coords = engine.find('COORD_SETTINGS')
        if coords is not None:
            for key, field in (('X_COORD', 'x'), ('Y_COORD', 'y')):
                try:
                    node[field] = float(_child_text(coords, key, '0'))
                except ValueError:
                    node[field] = 0
        cfg = '\n'.join(x.text or '' for x in engine.findall('./RUNNINGCONFIG/LINE'))
        state = _parse_ios_config(node_type, name, cfg)
        if state is not None:
            node['state'] = state
        ref = _child_text(engine, 'SAVE_REF_ID')
        if not ref:
            unsupported += 1
            continue
        ref_to_node[ref] = node
        node['_pkt_ref'] = ref
        rows.append(node)
    if unsupported:
        warnings.append(f'{unsupported} perangkat khusus/tidak didukung tidak ditampilkan di NexLab; tetap dipertahankan pada ekspor .pkt.')
    return rows, ref_to_node, warnings


def _port_for(node, port, occupied):
    if port in node['ifaces'] and (node['id'], port) not in occupied:
        return port
    aliases = {'Gi': 'GigabitEthernet', 'Fa': 'FastEthernet', 'Eth': 'Ethernet',
               'Te': 'TenGigabitEthernet', 'Wl': 'Wireless', 'Ethernet': 'eth'}
    candidates = []
    for short, full in aliases.items():
        if port.startswith(short):
            expanded = full + port[len(short):]
            candidates.append(expanded)
    match = re.match(r'(FastEthernet|GigabitEthernet)\d+/\d+', port)
    if match:
        candidates.extend(iface for iface in node['ifaces'] if iface.startswith(match.group(1)))
    if node['type'] == 'ap' and port == 'Port 0':
        candidates.append('GigabitEthernet0')
    for candidate in candidates:
        if candidate in node['ifaces'] and (node['id'], candidate) not in occupied:
            return candidate
    return None


def _link_connection(link):
    cable = link.find('CABLE')
    return cable if cable is not None and cable.find('FROM') is not None else link


def import_pkt(data):
    try:
        xml = decode_pkt(data)
        root = ET.fromstring(xml)
    except (ValueError, ET.ParseError) as exc:
        raise ValueError(f'File .pkt tidak dapat dibaca: {exc}') from exc
    if root.tag != 'PACKETTRACER5':
        raise ValueError('File ini bukan topologi Cisco Packet Tracer (.pkt)')
    nodes, ref_to_node, warnings = _packet_device_rows(root)
    links = []
    link_refs = {}
    baseline_links = {}
    occupied = set()
    source_link_count = len(root.findall('./NETWORK/LINKS/LINK'))
    for index, link in enumerate(root.findall('./NETWORK/LINKS/LINK')):
        cable = _link_connection(link)
        refs = (_child_text(cable, 'FROM'), _child_text(cable, 'TO'))
        ends = []
        for ref, port in zip(refs, cable.findall('PORT')):
            node = ref_to_node.get(ref)
            iface = _port_for(node, (port.text or '').strip(), occupied) if node is not None else None
            if node is None or not iface:
                ends = []
                break
            ends.append({'node': node['id'], 'iface': iface})
        if len(ends) != 2 or ends[0] == ends[1] or any((e['node'], e['iface']) in occupied for e in ends):
            continue
        occupied.update((e['node'], e['iface']) for e in ends)
        link_id = f'pkt-{index}'
        packet_type = _child_text(link, 'TYPE')
        links.append({'id': link_id, 'a': ends[0], 'b': ends[1],
                      'style': 'fiber' if 'Fiber' in packet_type else 'copper'})
        link_refs[link_id] = index
        baseline_links[link_id] = copy.deepcopy({'a': ends[0], 'b': ends[1],
                                                 'style': 'fiber' if 'Fiber' in packet_type else 'copper'})

    packet_meta = {
        'xml': xml.decode('utf-8'),
        'version': _child_text(root, 'VERSION'),
        'device_refs': {str(n['id']): n.pop('_pkt_ref') for n in nodes if n.get('_pkt_ref')},
        'link_refs': link_refs,
        'baseline_links': baseline_links,
        'baseline_states': {str(n['id']): copy.deepcopy(n.get('state')) for n in nodes if n.get('state')},
        'warnings': warnings,
    }
    if not links and root.find('./NETWORK/LINKS/LINK') is not None:
        warnings.append('Sebagian koneksi tidak dapat dipetakan ke port NexLab dan tidak muncul di kanvas.')
    elif len(links) < source_link_count:
        warnings.append(f'{source_link_count - len(links)} koneksi tidak dapat dipetakan ke port NexLab; tetap dipertahankan pada ekspor .pkt.')
    data_out = {'nodes': nodes, 'links': links, 'notes': [], '_packet_tracer': packet_meta}
    return data_out, warnings


def _replace_text(parent, tag, value):
    element = parent.find(tag)
    if element is None:
        element = ET.SubElement(parent, tag)
    element.text = str(value)
    return element


def _packet_tracer_port(node, iface):
    if node['type'] == 'cloud':
        return re.sub(r'^eth(\d+)$', r'Ethernet\1', iface)
    if node['type'] == 'hub':
        return re.sub(r'^Port(\d+)$', r'Port \1', iface)
    if node['type'] == 'ap' and iface == 'GigabitEthernet0':
        return 'Port 0'
    return iface


def _export_new_pkt(lab, warnings):
    root = ET.Element('PACKETTRACER5')
    _replace_text(root, 'VERSION', '9.0.0.0810')
    network = ET.SubElement(root, 'NETWORK')
    devices = ET.SubElement(network, 'DEVICES')
    links = ET.SubElement(network, 'LINKS')
    ET.SubElement(network, 'SHAPETESTS')

    nodes_by_id = {int(node['id']): node for node in lab.get('nodes', [])}
    exported_nodes = {}
    unsupported_types = set()
    skipped_devices = 0
    skipped_config = 0

    for node in lab.get('nodes', []):
        node_type = node.get('type')
        model = _EXPORT_DEVICE_MODELS.get(node_type)
        if model is None:
            skipped_devices += 1
            unsupported_types.add(str(node_type or 'unknown'))
            continue

        node_id = int(node['id'])
        ref = f'save-ref-id:{node_id}'
        exported_nodes[node_id] = (node, ref)
        device = ET.SubElement(devices, 'DEVICE')
        engine = ET.SubElement(device, 'ENGINE')
        type_element = ET.SubElement(engine, 'TYPE', {'model': model[1]})
        type_element.text = model[0]
        _replace_text(engine, 'NAME', node.get('name') or f'{model[0]}{node_id}')
        _replace_text(engine, 'POWER', 'true')
        _replace_text(engine, 'SAVE_REF_ID', ref)
        _replace_text(engine, 'SYS_NAME', node.get('name') or f'{model[0]}{node_id}')
        coords = ET.SubElement(engine, 'COORD_SETTINGS')
        _replace_text(coords, 'X_COORD', node.get('x', 0))
        _replace_text(coords, 'Y_COORD', node.get('y', 0))

        if node_type in ('router', 'firewall', 'switch', 'l3switch'):
            config = ET.SubElement(engine, 'RUNNINGCONFIG')
            state = node.get('state')
            if isinstance(state, dict):
                for line in running_config(node_type, state).splitlines():
                    ET.SubElement(config, 'LINE').text = line
            else:
                skipped_config += 1
        elif node_type in ('pc', 'laptop', 'server', 'printer', 'ipphone', 'smartphone', 'tablet'):
            host_state = node.get('state') or node.get('host') or {}
            if (
                any(host_state.get(key) for key in ('ip', 'mask', 'gw', 'dns', 'wifi', 'services', 'scripts'))
                or host_state.get('dhcp')
            ):
                skipped_config += 1
        elif node_type in ('ap', 'cloud') and node.get('props'):
            skipped_config += 1

    skipped_links = 0
    occupied_ports = set()
    represented_firewalls = sum(1 for node in lab.get('nodes', []) if node.get('type') == 'firewall')
    for link in lab.get('links', []):
        try:
            node_a, iface_a = int(link['a']['node']), str(link['a']['iface'])
            node_b, iface_b = int(link['b']['node']), str(link['b']['iface'])
        except (KeyError, TypeError, ValueError):
            skipped_links += 1
            continue
        endpoints = ((node_a, iface_a), (node_b, iface_b))
        if (
            node_a == node_b
            or any(node_id not in exported_nodes for node_id, _ in endpoints)
            or any(iface not in _EXPORT_PORTS.get(nodes_by_id[node_id].get('type'), set())
                   for node_id, iface in endpoints)
            or any(endpoint in occupied_ports for endpoint in endpoints)
        ):
            skipped_links += 1
            continue
        occupied_ports.update(endpoints)

        link_element = ET.SubElement(links, 'LINK')
        ET.SubElement(link_element, 'TYPE').text = 'eFiber' if link.get('style') == 'fiber' else 'eCopper'
        ET.SubElement(link_element, 'CABLE')
        ET.SubElement(link_element, 'FROM').text = exported_nodes[node_a][1]
        ET.SubElement(link_element, 'PORT').text = _packet_tracer_port(nodes_by_id[node_a], iface_a)
        ET.SubElement(link_element, 'TO').text = exported_nodes[node_b][1]
        ET.SubElement(link_element, 'PORT').text = _packet_tracer_port(nodes_by_id[node_b], iface_b)
        ET.SubElement(link_element, 'TYPE').text = 'eStraightThrough'

    if skipped_devices:
        warnings.append(
            f'{skipped_devices} perangkat tidak didukung dan tidak dimasukkan ke file .pkt '
            f'({", ".join(sorted(unsupported_types))}).'
        )
    if skipped_links:
        warnings.append(f'{skipped_links} koneksi tidak kompatibel dilewati saat konversi .pkt.')
    if skipped_config:
        warnings.append(
            f'Konfigurasi atau layanan dari {skipped_config} perangkat akhir tidak ikut dikonversi; '
            'konfigurasi IOS router/switch yang didukung tetap disertakan.'
        )
    if represented_firewalls:
        warnings.append(
            f'{represented_firewalls} firewall NexLab direpresentasikan sebagai router; fitur firewall khusus mungkin hilang.'
        )
    map3d = lab.get('map3d') or {}
    has_map_content = any(map3d.get(key) for key in ('buildings', 'objects', 'cables', 'settings'))
    if lab.get('notes') or lab.get('workbook') or has_map_content or lab.get('timer') or lab.get('configsets'):
        warnings.append('Catatan, workbook, timer, config set, dan peta 3D NexLab tidak tersedia dalam format .pkt.')
    if exported_nodes:
        warnings.append(
            'File .pkt baru dibuat dari perangkat dan koneksi yang kompatibel; periksa kembali hasilnya di Cisco Packet Tracer.'
        )
    return encode_pkt(ET.tostring(root, encoding='utf-8', xml_declaration=True))


def export_pkt(lab, warnings=None):
    meta = lab.get('_packet_tracer')
    if not isinstance(meta, dict) or not meta.get('xml'):
        if warnings is None:
            warnings = []
        return _export_new_pkt(lab, warnings)
    try:
        root = ET.fromstring(meta['xml'])
    except ET.ParseError as exc:
        raise ValueError(f'Template .pkt di lab tidak valid: {exc}') from exc

    device_container = root.find('./NETWORK/DEVICES')
    link_container = root.find('./NETWORK/LINKS')
    if device_container is None or link_container is None:
        raise ValueError('Struktur NETWORK perangkat/koneksi tidak ditemukan dalam file .pkt.')
    refs = meta.setdefault('device_refs', {})
    nodes_by_id = {int(n['id']): n for n in lab.get('nodes', [])}
    unmapped_nodes = [node['id'] for node in nodes_by_id.values() if str(node['id']) not in refs]
    if unmapped_nodes:
        raise ValueError('Ekspor .pkt belum mendukung perangkat baru di NexLab. Perangkat yang ditambahkan: ' +
                         ', '.join(map(str, unmapped_nodes)))
    current_refs = {refs.get(str(nid)) for nid in nodes_by_id}
    removed_refs = {ref for ref in refs.values() if ref not in current_refs}
    for device in list(device_container.findall('DEVICE')):
        engine = device.find('ENGINE')
        ref = _child_text(engine, 'SAVE_REF_ID') if engine is not None else ''
        if ref in removed_refs:
            device_container.remove(device)
            continue
        nid = next((int(key) for key, value in refs.items() if value == ref), None)
        node = nodes_by_id.get(nid) if nid is not None else None
        if node is None or engine is None:
            continue
        _replace_text(engine, 'NAME', node['name'])
        _replace_text(engine, 'SYS_NAME', node['name'])
        coords = engine.find('COORD_SETTINGS')
        if coords is not None:
            _replace_text(coords, 'X_COORD', node.get('x', 0))
            _replace_text(coords, 'Y_COORD', node.get('y', 0))
        baseline = meta.get('baseline_states', {}).get(str(nid))
        if baseline is not None and node.get('state') != baseline and node['type'] in ('router', 'firewall', 'switch', 'l3switch'):
            raise ValueError('Ekspor .pkt belum mendukung perubahan konfigurasi IOS; konfigurasi asli tetap dipertahankan.')

    source_links = meta.setdefault('link_refs', {})
    links_by_id = {str(link['id']): link for link in lab.get('links', [])}
    unmapped_links = [link_id for link_id in links_by_id if link_id not in source_links]
    if unmapped_links:
        raise ValueError('Ekspor .pkt belum mendukung koneksi baru di NexLab.')
    source_link_elements = list(link_container.findall('LINK'))
    source_ids = {index: link_id for link_id, index in source_links.items()}
    for index, element in enumerate(source_link_elements):
        cable = _link_connection(element)
        endpoint_refs = {_child_text(cable, 'FROM'), _child_text(cable, 'TO')}
        link_id = source_ids.get(index)
        if link_id is not None and link_id not in links_by_id:
            link_container.remove(element)
        elif endpoint_refs & removed_refs:
            link_container.remove(element)
        elif link_id is not None:
            link = links_by_id[link_id]
            baseline = meta.get('baseline_links', {}).get(link_id)
            if baseline is None or baseline.get('a') != link.get('a') or baseline.get('b') != link.get('b'):
                raise ValueError('Ekspor .pkt belum mendukung perubahan port atau ujung koneksi yang sudah ada.')
            packet_type = element.find('TYPE')
            if packet_type is not None and link.get('style') != baseline.get('style'):
                packet_type.text = 'eFiber' if link.get('style') == 'fiber' else 'eCopper'

    return encode_pkt(ET.tostring(root, encoding='utf-8', xml_declaration=True))


def filename_for(name):
    safe = re.sub(r'[^A-Za-z0-9_-]+', '_', str(name)).strip('_') or 'NexLab'
    return safe[:80] + '.pkt'
