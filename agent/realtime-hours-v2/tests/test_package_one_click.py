import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
import zipfile

spec = importlib.util.spec_from_file_location('package_one_click', Path(__file__).resolve().parents[1] / 'scripts/package-one-click.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        installer = self.root / 'agent/realtime-hours-v2/installer'
        installer.mkdir(parents=True)
        (installer / 'Install-RealtimeHoursV2.ps1').write_text('Write-Host test')
        (installer / 'INSTALAR-REALTIME-HOURS-V2.bat.in').write_text('@echo off\n')
        binary = self.root / 'agent/realtime-hours-v2/dist/RealtimeHoursAgentV2.exe'
        binary.parent.mkdir()
        binary.write_bytes(b'MZ-test-executable')
        public = self.root / 'public/realtime-hours-v2'
        public.mkdir(parents=True)
        self.extension = {'extensionId': 'a' * 32, 'updateUrl': 'https://realtime-hours-v2-homologacao.vercel.app/update.xml', 'sha256': hashlib.sha256(b'test-crx').hexdigest()}
        (public / 'extension-release.json').write_text(json.dumps(self.extension))
        self.authorization = self.root / 'authorization.json'

    def remote(self, url, timeout):
        if '/health' in url:
            return io.BytesIO(json.dumps({'success': True, 'environment': 'homologation', 'extensionId': self.extension['extensionId'], 'fleetEnrollment': True, 'persistentFleetEnrollment': True}).encode())
        return io.BytesIO(b'test-crx' if url.endswith('.crx') else self.extension['extensionId'].encode())

    def build(self, **changes):
        value = {'mode': 'fleet', 'deploymentCode': 'A' * 32, 'expiresAt': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), 'installationLimit': None}
        value.update(changes)
        self.authorization.write_text(json.dumps(value))
        with patch.object(package, 'urlopen', self.remote):
            return package.make_package(self.root, self.authorization, self.root / 'result.zip', '1' * 40)

    def test_fleet_zip_has_one_bat_and_no_machine_count_limit(self):
        result = self.build()
        self.assertIsNone(result['installationLimit'])
        with zipfile.ZipFile(result['output']) as archive:
            self.assertEqual(sum(name.endswith('.bat') for name in archive.namelist()), 1)
            self.assertEqual(json.loads(archive.read('enrollment.json'))['mode'], 'fleet')
            self.assertIn('sem limite de quantidade', archive.read('LEIA-ME.txt').decode())
            self.assertNotIn('ainda nao aparecem', archive.read('LEIA-ME.txt').decode())
            for line in archive.read('SHA256SUMS.txt').decode().splitlines():
                expected, name = line.split('  ', 1)
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), expected)

    def test_expired_authorization_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.build(expiresAt=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())

    def test_non_expiring_fleet_is_explicit_and_has_no_deadline(self):
        result = self.build(expiresAt=None)
        self.assertIsNone(result['expiresAt'])
        self.assertIsNone(result['installationLimit'])
        with zipfile.ZipFile(result['output']) as archive:
            self.assertIsNone(json.loads(archive.read('release.json'))['installerExpiresAt'])
            self.assertIn('SEM DATA DE EXPIRACAO', archive.read('LEIA-ME.txt').decode())

    def test_non_expiring_fleet_requires_matching_published_backend(self):
        original = self.remote
        def dated_server(url, timeout):
            if '/health' in url:
                return io.BytesIO(json.dumps({'success': True, 'environment': 'homologation', 'extensionId': self.extension['extensionId'], 'fleetEnrollment': True}).encode())
            return original(url, timeout)
        self.remote = dated_server
        with self.assertRaisesRegex(ValueError, 'does not support persistent fleet'):
            self.build(expiresAt=None)

    def test_permanent_or_long_authorization_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'seven days'):
            self.build(expiresAt=(datetime.now(timezone.utc) + timedelta(days=8)).isoformat())

    def test_fleet_cannot_embed_a_shared_single_use_code(self):
        with self.assertRaisesRegex(ValueError, 'independent single-use'):
            self.build(enrollmentCode='B' * 32)

    def test_unlimited_mode_does_not_bypass_the_published_server_capability(self):
        original = self.remote
        def old_server(url, timeout):
            if '/health' in url:
                return io.BytesIO(json.dumps({'success': True, 'environment': 'homologation', 'extensionId': self.extension['extensionId']}).encode())
            return original(url, timeout)
        self.remote = old_server
        with self.assertRaisesRegex(ValueError, 'does not support fleet'):
            self.build()


if __name__ == '__main__':
    unittest.main()
