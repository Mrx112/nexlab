"""Translate the supported Packet Tracer logical-topology subset."""
import copy
from functools import lru_cache
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from .pkt import decode_pkt, encode_pkt
from .state import mac_for, new_state, running_config, valid_ip, valid_mask
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

_EXPORT_TEMPLATE_MODELS = {
    'router': '2911',
    'firewall': '2911',
    'switch': '2950T-24',
    'l3switch': '2950T-24',
    'pc': 'PC-PT',
    'laptop': 'PC-PT',
    'server': 'Server-PT',
    'printer': 'Printer-PT',
    'ap': 'AccessPoint-PT',
    'cloud': 'Cloud-PT',
}

_EXPORT_PORTS = {
    'router': {f'GigabitEthernet0/{index}' for index in range(3)},
    'firewall': {f'GigabitEthernet0/{index}' for index in range(3)},
    'switch': ({f'FastEthernet0/{index}' for index in range(1, 25)}
               | {'GigabitEthernet0/1', 'GigabitEthernet0/2'}),
    'l3switch': ({f'GigabitEthernet1/0/{index}' for index in range(1, 25)}
                 | {'GigabitEthernet1/1/1', 'GigabitEthernet1/1/2'}),
    'pc': {'FastEthernet0'},
    'laptop': {'FastEthernet0'},
    'server': {'FastEthernet0'},
    'printer': {'FastEthernet0'},
    'ap': {'GigabitEthernet0'},
    'cloud': {'eth0'},
}

_EXPORT_MODEL_PORTS = {
    '2911': _EXPORT_PORTS['router'],
    '2950T-24': _EXPORT_PORTS['switch'],
    'PC-PT': _EXPORT_PORTS['pc'],
    'Server-PT': _EXPORT_PORTS['server'],
    'Printer-PT': _EXPORT_PORTS['printer'],
    'AccessPoint-PT': {'Port 0'},
    'Cloud-PT': {'Ethernet6'},
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


def _parse_host_config(engine, node_type, name):
    state = new_state(node_type, name, node_ifaces(node_type, PROP_DEFAULTS.get(node_type, {})))
    port = next(iter(engine.findall('./MODULE//PORT')), None)
    if port is not None:
        ip = _child_text(port, 'IP')
        mask = _child_text(port, 'SUBNET')
        if valid_ip(ip) and valid_mask(mask):
            state.update(ip=ip, mask=mask)
        state['gw'] = _child_text(port, 'PORT_GATEWAY') or _child_text(engine, 'GATEWAY')
        state['dns'] = _child_text(port, 'PORT_DNS') or _child_text(engine, 'DNS_CLIENT/SERVER_IP')
        state['dhcp'] = _child_text(port, 'PORT_DHCP_ENABLE').lower() == 'true'
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
        if state is None and node_type in ('pc', 'laptop', 'server', 'printer'):
            state = _parse_host_config(engine, node_type, name)
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


@lru_cache(maxsize=1)
def _packet_tracer_seed():
    path = Path(__file__).resolve().parent.parent / 'static' / 'data' / 'packet-tracer-seed.pkt'
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ValueError(f'Template perangkat Cisco Packet Tracer tidak dapat dibaca: {exc}') from exc
    try:
        root = ET.fromstring(decode_pkt(data))
    except (ValueError, ET.ParseError) as exc:
        raise ValueError(f'Template perangkat Cisco Packet Tracer tidak valid: {exc}') from exc
    if root.tag != 'PACKETTRACER5':
        raise ValueError('Template perangkat bukan file Cisco Packet Tracer yang valid.')
    return root


def _packet_tracer_port(node_type, iface):
    if node_type == 'l3switch':
        match = re.fullmatch(r'GigabitEthernet1/0/(\d+)', iface)
        if match:
            return f'FastEthernet0/{match.group(1)}'
        match = re.fullmatch(r'GigabitEthernet1/1/([12])', iface)
        if match:
            return f'GigabitEthernet0/{match.group(1)}'
    if node_type == 'ap' and iface == 'GigabitEthernet0':
        return 'Port 0'
    if node_type == 'cloud' and iface == 'eth0':
        return 'Ethernet6'
    return iface


def _set_config(engine, tag, lines):
    config = engine.find(tag)
    if config is None:
        config = ET.SubElement(engine, tag)
    for child in list(config):
        config.remove(child)
    for line in lines:
        ET.SubElement(config, 'LINE').text = line


def _packet_ios_config(node, connected_ifaces, warnings):
    source_type = node.get('type')
    output_type = 'switch' if source_type == 'l3switch' else 'router' if source_type == 'firewall' else source_type
    source_state = node.get('state')
    if not isinstance(source_state, dict):
        source_state = new_state(source_type, node.get('name', ''), node.get('ifaces') or [])
    state = copy.deepcopy(source_state)
    state['hostname'] = node.get('name') or state.get('hostname') or 'NexLab'
    if source_type in ('firewall',):
        output_ports = _EXPORT_PORTS['router']
    elif source_type == 'l3switch':
        output_ports = _EXPORT_PORTS['switch']
    else:
        output_ports = _EXPORT_PORTS.get(source_type, set())

    translated = {}
    omitted_interfaces = False
    for iface, details in state.get('ifaces', {}).items():
        target_iface = _packet_tracer_port(source_type, iface)
        if target_iface not in output_ports and not (
            output_type == 'router' and any(target_iface.startswith(f'{port}.') for port in output_ports)
        ):
            if details.get('ip') or details.get('mode') == 'routed' or iface in connected_ifaces:
                omitted_interfaces = True
            continue
        translated_details = copy.deepcopy(details)
        if source_type == 'l3switch' and (
            translated_details.get('mode') == 'routed' or translated_details.get('ip')
        ):
            translated_details.pop('ip', None)
            translated_details.pop('mask', None)
            translated_details['mode'] = 'access'
            translated_details['vlan'] = translated_details.get('vlan') or 1
            omitted_interfaces = True
        if iface in connected_ifaces:
            translated_details['shutdown'] = False
        translated[target_iface] = translated_details
    state['ifaces'] = translated

    if source_type == 'l3switch':
        state.update(ip_routing=False, routes=[], ospf=None, rip=None, dhcp_pools={}, dhcp_excluded=[])

    state['enable_secret'] = None
    state['enable_password'] = None
    state['users'] = {}
    for line_config in state.get('lines', {}).values():
        line_config['password'] = None
        line_config['login'] = False

    if omitted_interfaces:
        warnings.append(
            f'{node.get("name", "Perangkat")} memiliki antarmuka/konfigurasi yang tidak ada pada model Packet Tracer hasil konversi.'
        )
    if source_type == 'l3switch':
        warnings.append(
            f'{node.get("name", "Switch L3")} dikonversi menjadi switch Layer 2; routing antarsubnet tidak ikut dikonversi.'
        )
    lines = running_config(output_type, state).splitlines()
    if output_type == 'router':
        for iface in connected_ifaces:
            heading = f'interface {_packet_tracer_port(source_type, iface)}'
            try:
                start = lines.index(heading)
                end = lines.index('!', start)
            except ValueError:
                continue
            if ' no shutdown' not in lines[start:end]:
                lines.insert(end, ' no shutdown')
    return lines


def _packet_host_config(engine, node, warnings):
    host_state = node.get('state') or node.get('host') or {}
    module_ports = engine.findall('./MODULE//PORT')
    port = next((candidate for candidate in module_ports
                 if (candidate.findtext('TYPE') or '').startswith('eCopper')), None)
    if port is None:
        warnings.append(f'Antarmuka kabel {node.get("name", "perangkat")} tidak ditemukan; alamat IP dilewati.')
        return

    ip = str(host_state.get('ip') or '')
    mask = str(host_state.get('mask') or '')
    if ip and (not valid_ip(ip) or not valid_mask(mask)):
        warnings.append(f'Alamat IP/mask {node.get("name", "perangkat")} tidak valid dan tidak dikonversi.')
        ip = mask = ''
    for tag, value in (
        ('IP', ip), ('SUBNET', mask), ('PORT_GATEWAY', host_state.get('gw') or ''),
        ('PORT_DNS', host_state.get('dns') or ''),
        ('PORT_DHCP_ENABLE', 'true' if host_state.get('dhcp') else 'false'),
    ):
        _replace_text(port, tag, value)
    _replace_text(engine, 'GATEWAY', host_state.get('gw') or '')
    dns_client = engine.find('DNS_CLIENT')
    if dns_client is not None:
        _replace_text(dns_client, 'SERVER_IP', host_state.get('dns') or '')

    for index, candidate in enumerate(module_ports):
        address = mac_for('pkt', node.get('id'), index).upper()
        _replace_text(candidate, 'MACADDRESS', address)
        _replace_text(candidate, 'BIA', address)

    if node.get('type') == 'laptop':
        warnings.append(
            f'{node.get("name", "Laptop")} ditampilkan sebagai PC berkabel; konfigurasi Wi-Fi tidak ikut dikonversi.'
        )
    services = host_state.get('services') or {}
    if node.get('type') == 'server' and any(
        (services.get(key) or {}).get('enabled') for key in ('dhcp', 'dns', 'http')
    ):
        warnings.append(
            f'Layanan DHCP/DNS/HTTP NexLab pada {node.get("name", "server")} tidak dikonversi; hanya IP dan gateway yang disalin.'
        )
    if not ip and not host_state.get('dhcp'):
        warnings.append(
            f'{node.get("name", "Perangkat")} belum memiliki IP statis atau DHCP; atur IP di Packet Tracer agar dapat ping.'
        )


def _trim_physical_workspace(root, devices):
    physical = root.find('PHYSICALWORKSPACE')
    if physical is None:
        raise ValueError('Template Packet Tracer tidak memiliki PHYSICALWORKSPACE.')
    used_leaf_ids = set()
    for device in devices:
        workspace = device.find('WORKSPACE')
        path = _child_text(workspace, 'PHYSICAL') if workspace is not None else ''
        if path:
            used_leaf_ids.add(path.split(',')[-1].strip().strip('{}'))
    for node in list(physical.iter('NODE')):
        if node.findtext('TYPE') != '6' or node.findtext('UUID_STR', '').strip('{}') in used_leaf_ids:
            continue
        for parent in physical.iter():
            children = parent.find('CHILDREN')
            if children is not None and node in list(children):
                children.remove(node)
                break


def _export_new_pkt(lab, warnings):
    root = copy.deepcopy(_packet_tracer_seed())
    network = root.find('NETWORK')
    device_container = network.find('DEVICES') if network is not None else None
    link_container = network.find('LINKS') if network is not None else None
    if device_container is None or link_container is None or not link_container.findall('LINK'):
        raise ValueError('Template Packet Tracer tidak memiliki struktur perangkat/kabel yang diperlukan.')

    templates = {}
    for device in device_container.findall('DEVICE'):
        engine = device.find('ENGINE')
        type_element = engine.find('TYPE') if engine is not None else None
        model = type_element.get('model') if type_element is not None else None
        if model:
            templates[model] = device
    link_template = link_container.find('LINK')
    nodes = lab.get('nodes', [])
    nodes_by_id = {int(node['id']): node for node in nodes}
    exported_nodes = {}
    unsupported_types = set()
    skipped_devices = 0
    device_container.clear()
    for index, node in enumerate(nodes):
        node_type = node.get('type')
        model = _EXPORT_TEMPLATE_MODELS.get(node_type)
        template = templates.get(model)
        if template is None:
            skipped_devices += 1
            unsupported_types.add(str(node_type or 'unknown'))
            continue
        device = copy.deepcopy(template)
        engine = device.find('ENGINE')
        name = node.get('name') or f'{node_type}{node["id"]}'
        _replace_text(engine, 'NAME', name)
        _replace_text(engine, 'SYS_NAME', name)
        _replace_text(engine, 'POWER', 'true')
        _replace_text(engine, 'SAVE_REF_ID', f'save-ref-id:{10000 + index}')
        coords = engine.find('COORD_SETTINGS')
        if coords is not None:
            _replace_text(coords, 'X_COORD', node.get('x', 0))
            _replace_text(coords, 'Y_COORD', node.get('y', 0))
        workspace = device.find('WORKSPACE')
        logical = workspace.find('LOGICAL') if workspace is not None else None
        if logical is not None:
            _replace_text(logical, 'X', node.get('x', 0))
            _replace_text(logical, 'Y', node.get('y', 0))
        for port_index, port in enumerate(engine.findall('./MODULE//PORT')):
            address = mac_for('pkt', node.get('id'), port_index).upper()
            _replace_text(port, 'MACADDRESS', address)
            _replace_text(port, 'BIA', address)
        device_container.append(device)
        exported_nodes[int(node['id'])] = (node, device)

    connected_ifaces = {}
    occupied_ports = set()
    skipped_links = 0
    changed_fiber_links = 0
    converted_links = []
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
        mapped = tuple(
            (node_id, _packet_tracer_port(nodes_by_id[node_id]['type'], iface))
            for node_id, iface in endpoints
        )
        if any(
            mapped_iface not in _EXPORT_MODEL_PORTS.get(_EXPORT_TEMPLATE_MODELS[nodes_by_id[node_id]['type']], set())
            for node_id, mapped_iface in mapped
        ):
            skipped_links += 1
            continue
        occupied_ports.update(endpoints)
        for node_id, iface in endpoints:
            connected_ifaces.setdefault(node_id, set()).add(iface)
        converted_links.append((link, endpoints, mapped))
        if link.get('style') == 'fiber':
            changed_fiber_links += 1

    for node_id, (node, device) in exported_nodes.items():
        node_type = node.get('type')
        engine = device.find('ENGINE')
        if node_type in ('router', 'firewall', 'switch', 'l3switch'):
            lines = _packet_ios_config(node, connected_ifaces.get(node_id, set()), warnings)
            _set_config(engine, 'RUNNINGCONFIG', lines)
            _set_config(engine, 'STARTUPCONFIG', lines)
        elif node_type in ('pc', 'laptop', 'server', 'printer'):
            _packet_host_config(engine, node, warnings)

    link_container.clear()
    for source_link, endpoints, mapped in converted_links:
        link_element = copy.deepcopy(link_template)
        cable = _link_connection(link_element)
        cable_ports = cable.findall('PORT')
        if cable.find('FROM') is None or cable.find('TO') is None or len(cable_ports) < 2:
            raise ValueError('Template kabel Packet Tracer tidak memiliki FROM/TO/PORT yang diperlukan.')
        ref_a = exported_nodes[endpoints[0][0]][1].findtext('ENGINE/SAVE_REF_ID')
        ref_b = exported_nodes[endpoints[1][0]][1].findtext('ENGINE/SAVE_REF_ID')
        _replace_text(cable, 'FROM', ref_a)
        _replace_text(cable, 'TO', ref_b)
        cable_ports[0].text = mapped[0][1]
        cable_ports[1].text = mapped[1][1]
        for tag in ('FROM_DEVICE_MEM_ADDR', 'TO_DEVICE_MEM_ADDR', 'FROM_PORT_MEM_ADDR', 'TO_PORT_MEM_ADDR'):
            _replace_text(cable, tag, '1')
        _replace_text(link_element, 'TYPE', 'eCopper')
        _replace_text(cable, 'TYPE', 'eStraightThrough')
        link_container.append(link_element)

    devices = device_container.findall('DEVICE')
    _trim_physical_workspace(root, devices)
    if skipped_devices:
        warnings.append(
            f'{skipped_devices} perangkat tidak didukung dan tidak dimasukkan ke .pkt '
            f'({", ".join(sorted(unsupported_types))}).'
        )
    if skipped_links:
        warnings.append(f'{skipped_links} koneksi tidak kompatibel dilewati saat konversi .pkt.')
    if changed_fiber_links:
        warnings.append(
            f'{changed_fiber_links} koneksi fiber dikonversi menjadi kabel copper karena model perangkat hasil ekspor memakai port copper.'
        )
    if any(node.get('type') == 'firewall' for node in nodes):
        warnings.append('Firewall NexLab direpresentasikan sebagai router; aturan firewall khusus mungkin tidak ikut dikonversi.')
    if any(node.get('type') == 'ap' for node in nodes):
        warnings.append('Perangkat Wi-Fi dikonversi sebagai access point kabel; SSID dan keamanan Wi-Fi perlu diatur ulang di Packet Tracer.')
    if any(node.get('type') == 'cloud' for node in nodes):
        warnings.append('Cloud NexLab dikonversi sebagai Cloud-PT; mode cloud NexLab tidak ikut dikonversi.')
    if any(node.get('type') == 'laptop' for node in nodes):
        warnings.append('Laptop NexLab dikonversi sebagai PC berkabel; fitur nirkabel tidak ikut dikonversi.')
    if lab.get('notes') or lab.get('workbook') or lab.get('map3d') or lab.get('timer') or lab.get('configsets'):
        warnings.append('Catatan, workbook, timer, config set, dan peta 3D NexLab tidak tersedia dalam format .pkt.')
    if exported_nodes:
        warnings.append(
            'Topologi dan konfigurasi IP/IOS yang kompatibel telah dikonversi. Uji ping di Packet Tracer; IP harus satu subnet atau memiliki gateway/rute yang sesuai.'
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
