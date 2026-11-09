import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    'package_update', Path(__file__).resolve().parents[1] / 'scripts/package-update.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class UpdatePackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        installer = self.root / 'agent/realtime-hours-v2/installer'
        installer.mkdir(parents=True)
        for name in ('Update-RealtimeHoursV2.ps1', 'Sessions-RealtimeHoursV2.ps1'):
            (installer / name).write_text('Write-Host test')
        (installer / 'ATUALIZAR-REALTIME-HOURS-V2.bat.in').write_text('@echo off\n')
        # A private enrollment file elsewhere in the checkout must never enter
        # this existing-installation update kit.
        (installer / 'Enrollment-RealtimeHoursV2.ps1').write_text('PRIVATE-DO-NOT-PACK')
        (self.root / 'enrollment.json').write_text('PRIVATE-DO-NOT-PACK')
        data = bytearray(256)
        data[:2] = b'MZ'
        struct.pack_into('<I', data, 0x3C, 128)
        data[128:132] = b'PE\x00\x00'
        struct.pack_into('<H', data, 132, 0x8664)
        struct.pack_into('<H', data, 152, 0x20B)
        struct.pack_into('<H', data, 220, 2)
        self.binary = self.root / 'agent.exe'
        self.binary.write_bytes(data)
        self.output = self.root / 'update.zip'

    def build(self, commit='1' * 40):
        return package.make_update_package(self.root, self.binary, self.output, commit)

    def test_existing_install_update_has_policy_hashes_and_no_enrollment(self):
        result = self.build()
        self.assertFalse(result['enrollmentRequired'])
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(len(archive.namelist()), 7)
            self.assertEqual(sum(name.endswith('.bat') for name in archive.namelist()), 1)
            self.assertNotIn('enrollment.json', archive.namelist())
            self.assertNotIn('Enrollment-RealtimeHoursV2.ps1', archive.namelist())
            self.assertFalse(any(b'PRIVATE-DO-NOT-PACK' in archive.read(name) for name in archive.namelist()))
            manifest = json.loads(archive.read('update-release.json'))
            self.assertEqual(manifest['kind'], 'realtime-hours-v2-update')
            self.assertEqual(manifest['activityUploadPolicy']['openCheckpointUploadIntervalSeconds'], 240)
            self.assertEqual(manifest['activityUploadPolicy']['heartbeatIntervalSeconds'], 60)
            self.assertFalse(manifest['remoteExecutableDownload'])
            self.assertTrue(manifest['windowsPilotRequired'])
            for name, expected in manifest['files'].items():
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), expected)
            for line in archive.read('SHA256SUMS.txt').decode().splitlines():
                expected, name = line.split('  ', 1)
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), expected)

    def test_rejects_wrong_architecture(self):
        data = bytearray(self.binary.read_bytes())
        struct.pack_into('<H', data, 132, 0xAA64)
        self.binary.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'amd64'):
            self.build()

    def test_rejects_console_or_invalid_executable(self):
        data = bytearray(self.binary.read_bytes())
        struct.pack_into('<H', data, 220, 3)
        self.binary.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'GUI'):
            self.build()
        self.binary.write_bytes(b'not an executable')
        with self.assertRaisesRegex(ValueError, 'Windows executable'):
            self.build()

    def test_requires_source_commit(self):
        with self.assertRaisesRegex(ValueError, 'source commit'):
            self.build('main')


if __name__ == '__main__':
    unittest.main()

