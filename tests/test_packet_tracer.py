import unittest
import xml.etree.ElementTree as ET

from server.packet_tracer import export_pkt, import_pkt
from server.pkt import decode_pkt, encode_pkt


_XML = b'''<?xml version="1.0" encoding="utf-8"?>
<PACKETTRACER5>
  <VERSION>9.0.0.0810</VERSION>
  <NETWORK>
    <DEVICES>
      <DEVICE><ENGINE>
        <TYPE model="Router-PT-Empty">Router</TYPE><NAME>R1</NAME><POWER>true</POWER>
        <SAVE_REF_ID>save-ref-id:101</SAVE_REF_ID><SYS_NAME>R1</SYS_NAME>
        <COORD_SETTINGS><X_COORD>120</X_COORD><Y_COORD>80</Y_COORD></COORD_SETTINGS>
        <RUNNINGCONFIG><LINE>hostname R1</LINE><LINE>interface GigabitEthernet0/0</LINE>
          <LINE>ip address 10.0.0.1 255.255.255.0</LINE><LINE>no shutdown</LINE></RUNNINGCONFIG>
      </ENGINE></DEVICE>
      <DEVICE><ENGINE>
        <TYPE model="PC-PT">PC</TYPE><NAME>PC1</NAME><POWER>true</POWER>
        <SAVE_REF_ID>save-ref-id:202</SAVE_REF_ID><SYS_NAME>PC1</SYS_NAME>
        <COORD_SETTINGS><X_COORD>240</X_COORD><Y_COORD>80</Y_COORD></COORD_SETTINGS>
      </ENGINE></DEVICE>
    </DEVICES>
    <LINKS><LINK><TYPE>eCopper</TYPE><CABLE/><FROM>save-ref-id:101</FROM>
      <PORT>GigabitEthernet1/0</PORT><TO>save-ref-id:202</TO><PORT>FastEthernet0</PORT>
      <TYPE>eStraightThrough</TYPE></LINK></LINKS>
    <SHAPETESTS/>
  </NETWORK>
</PACKETTRACER5>'''


class PacketTracerCodecTests(unittest.TestCase):
    def test_round_trip_and_reject_tampering(self):
        packet = encode_pkt(_XML)
        self.assertEqual(decode_pkt(packet), _XML)
        corrupted = packet[:-1] + bytes([packet[-1] ^ 1])
        with self.assertRaises(ValueError):
            decode_pkt(corrupted)

    def test_import_edit_export_preserves_native_topology(self):
        data, warnings = import_pkt(encode_pkt(_XML))
        self.assertFalse(warnings)
        self.assertEqual([node['type'] for node in data['nodes']], ['router', 'pc'])
        self.assertEqual(len(data['links']), 1)
        self.assertEqual(data['links'][0]['a']['iface'], 'GigabitEthernet0/0')

        data['nodes'][0]['name'] = 'Core'
        exported = decode_pkt(export_pkt(data))
        root = ET.fromstring(exported)
        devices = root.findall('./NETWORK/DEVICES/DEVICE/ENGINE/NAME')
        self.assertEqual([element.text for element in devices], ['Core', 'PC1'])
        link = root.find('./NETWORK/LINKS/LINK')
        self.assertEqual(link.findtext('FROM'), 'save-ref-id:101')
        self.assertEqual(link.findtext('TO'), 'save-ref-id:202')
        self.assertEqual(link.findall('PORT')[0].text, 'GigabitEthernet1/0')

    def test_export_rejects_changed_ios_configuration(self):
        data, _ = import_pkt(encode_pkt(_XML))
        data['nodes'][0]['state']['ifaces']['GigabitEthernet0/0']['ip'] = '10.0.0.2'
        with self.assertRaisesRegex(ValueError, 'perubahan konfigurasi IOS'):
            export_pkt(data)

    def test_export_rejects_rewired_connections(self):
        data, _ = import_pkt(encode_pkt(_XML))
        data['links'][0]['a']['iface'] = 'GigabitEthernet0/2'
        with self.assertRaisesRegex(ValueError, 'perubahan port atau ujung koneksi'):
            export_pkt(data)

    def test_export_requires_packet_tracer_source(self):
        with self.assertRaisesRegex(ValueError, 'impor file Cisco Packet Tracer'):
            export_pkt({'nodes': [], 'links': []})


if __name__ == '__main__':
    unittest.main()
