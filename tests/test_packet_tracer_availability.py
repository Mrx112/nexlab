import unittest

from server.app import has_packet_tracer_source


class PacketTracerAvailabilityTests(unittest.TestCase):
    def test_native_lab_cannot_be_exported_as_packet_tracer(self):
        self.assertFalse(has_packet_tracer_source({'nodes': [], 'links': []}))

    def test_imported_packet_tracer_lab_can_be_exported(self):
        self.assertTrue(has_packet_tracer_source({'_packet_tracer': {'xml': '<PACKETTRACER5 />'}}))

    def test_invalid_packet_tracer_source_is_not_exportable(self):
        self.assertFalse(has_packet_tracer_source({'_packet_tracer': []}))


if __name__ == '__main__':
    unittest.main()
