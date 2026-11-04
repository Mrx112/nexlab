import unittest

from server.app import lab_export_data


class LabExportDataTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            'nodes': [{'id': 1, 'state': {'hostname': 'R1'}, 'startup': {'hostname': 'R1'}, 'power': 'on'}],
            'links': [{'id': 'L1'}],
            'notes': [{'id': 1, 'text': 'note'}],
            'configsets': {'Default': {'saved': 1, 'nodes': {'1': {'hostname': 'R1'}}}},
            'workbook': {'title': 'Exercise'},
            'map3d': {'objects': []},
            'timer': {'minutes': 20, 'started': 1},
            '_packet_tracer': {'source': 'native'},
        }

    def test_selective_export_omits_unselected_content_without_mutating_lab(self):
        exported = lab_export_data(self.data, {
            'topology': False, 'configs': False, 'notes': False,
            'workbook': False, 'map3d': False, 'timer': False,
        })

        self.assertEqual(exported['nodes'], [])
        self.assertEqual(exported['links'], [])
        self.assertEqual(exported['notes'], [])
        self.assertNotIn('configsets', exported)
        self.assertNotIn('workbook', exported)
        self.assertNotIn('map3d', exported)
        self.assertNotIn('timer', exported)
        self.assertNotIn('_packet_tracer', exported)
        self.assertEqual(self.data['nodes'][0]['state']['hostname'], 'R1')
        self.assertIn('configsets', self.data)

    def test_config_exclusion_keeps_topology(self):
        exported = lab_export_data(self.data, {
            'topology': True, 'configs': False, 'notes': True,
            'workbook': True, 'map3d': True, 'timer': True,
        })

        self.assertEqual(len(exported['nodes']), 1)
        self.assertEqual(len(exported['links']), 1)
        self.assertNotIn('state', exported['nodes'][0])
        self.assertNotIn('startup', exported['nodes'][0])
        self.assertNotIn('power', exported['nodes'][0])
        self.assertNotIn('configsets', exported)


if __name__ == '__main__':
    unittest.main()
