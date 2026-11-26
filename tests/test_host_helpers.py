import os
import subprocess
import unittest
from unittest import mock

from server import real, sysinfo


class AccelerationTests(unittest.TestCase):
    def setUp(self):
        self.saved = dict(real._accel)
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop('NEXLAB_ACCEL', None)

    def tearDown(self):
        real._accel.update(self.saved)
        self.env.stop()

    def test_auto_uses_whpx_only_when_available(self):
        real.set_accel_preference('auto')
        with mock.patch.object(real, 'OS', 'windows'), mock.patch.object(real, 'whpx_available', return_value=True):
            self.assertEqual(real.accel_args()[1], 'WHPX (Hyper-V)')
        with mock.patch.object(real, 'OS', 'windows'), mock.patch.object(real, 'whpx_available', return_value=False):
            self.assertEqual(real.accel_args(), real.TCG_ARGS)

    def test_tcg_preference_and_environment_override(self):
        real.set_accel_preference('tcg')
        with mock.patch.object(real, 'OS', 'windows'), mock.patch.object(real, 'whpx_available', return_value=True):
            self.assertEqual(real.accel_args()[0], real.TCG_ARGS[0])
            os.environ['NEXLAB_ACCEL'] = 'whpx'
            self.assertEqual(real.accel_preference(), 'whpx')
            self.assertEqual(real.accel_args()[1], 'WHPX (Hyper-V)')

    def test_unknown_preference_falls_back_to_auto(self):
        real.set_accel_preference('turbo')
        self.assertEqual(real.accel_preference(), 'auto')


IPCONFIG = """
Windows IP Configuration

Wireless LAN adapter Local Area Connection* 1:

   Media State . . . . . . . . . . . : Media disconnected
   Description . . . . . . . . . . . : Microsoft Wi-Fi Direct Virtual Adapter
   Physical Address. . . . . . . . . : BC-09-1B-F6-E9-ED

Wireless LAN adapter Wi-Fi:

   Description . . . . . . . . . . . : Intel(R) Wi-Fi 6 AX201 160MHz
   Physical Address. . . . . . . . . : DA-28-ED-CC-9B-60
   IPv4 Address. . . . . . . . . . . : 10.101.210.51(Preferred)
   Default Gateway . . . . . . . . . : 10.101.0.1

Ethernet adapter Ethernet:

   Media State . . . . . . . . . . . : Media disconnected
   Description . . . . . . . . . . . : Realtek USB GbE Family Controller
   Physical Address. . . . . . . . . : 00-E0-4C-68-00-01
"""

ARP = """
Interface: 10.101.210.51 --- 0x5
  Internet Address      Physical Address      Type
  10.101.0.1            00-11-22-33-44-55     dynamic
"""


class WindowsNetworkTests(unittest.TestCase):
    def test_adapter_names_are_clean_and_virtual_noise_hidden(self):
        def fake_run(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, IPCONFIG if args[0] == 'ipconfig' else ARP, '')
        with mock.patch.object(sysinfo, 'OS', 'windows'), mock.patch.object(sysinfo.subprocess, 'run', fake_run):
            info = sysinfo.windows_network_info()
        names = [i['name'] for i in info['interfaces']]
        self.assertEqual(names, ['Wi-Fi', 'Ethernet'])          # Wi-Fi Direct virtual adapter hidden
        wifi = info['interfaces'][0]
        self.assertEqual((wifi['kind'], wifi['status'], wifi['addresses']), ('Wi-Fi', 'Up', ['10.101.210.51']))
        self.assertEqual(wifi['description'], 'Intel(R) Wi-Fi 6 AX201 160MHz')
        self.assertEqual(info['interfaces'][1]['status'], 'Disconnected')   # physical NIC stays visible
        self.assertEqual(info['neighbors'][0]['interface'], 'Wi-Fi')


if __name__ == '__main__':
    unittest.main()
