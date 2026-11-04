"""Translate the supported Packet Tracer logical-topology subset."""
import copy
import json
import re
import secrets
import xml.etree.ElementTree as ET

from .pkt import decode_pkt, encode_pkt
from .runtime import kind_of
from .state import new_state
from .templates import PROP_DEFAULTS, TEMPLATES, node_ifaces


_MODEL_TYPES = (
    (('2911', 'Router-PT'), 'router'),
    (('3650', '3560'), 'l3switch'),
    (('2950', '2950T', 'Switch-PT'), 'switch'),
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


def export_pkt(lab):
    meta = lab.get('_packet_tracer')
    if not isinstance(meta, dict) or not meta.get('xml'):
        raise ValueError('Untuk menyimpan sebagai .pkt, impor file Cisco Packet Tracer terlebih dahulu.')
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
