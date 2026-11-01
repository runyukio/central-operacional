#!/usr/bin/env python3
"""Sign a managed Chrome/Edge CRX3 using a stable external ECDSA key."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import zipfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


def varint(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(number, value):
    return varint(number << 3 | 2) + varint(len(value)) + value


def package(source, key_path, output, update_url):
    if not update_url.startswith('https://'):
        raise ValueError('extension updates must use HTTPS')
    key_path = Path(key_path).expanduser().resolve()
    source = Path(source).resolve()
    output = Path(output).resolve()
    if key_path.is_relative_to(source) or key_path.is_relative_to(output):
        raise ValueError('the signing key must remain outside the source and output folders')
    if not key_path.exists():
        key_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        private_key = ec.generate_private_key(ec.SECP256R1())
        data = private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        with os.fdopen(os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
            handle.write(data)
    private_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    if not isinstance(private_key, ec.EllipticCurvePrivateKey) or not isinstance(private_key.curve, ec.SECP256R1):
        raise ValueError('expected an ECDSA P-256 signing key')
    public_key = private_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    crx_id = hashlib.sha256(public_key).digest()[:16]
    extension_id = ''.join(chr(ord('a') + int(c, 16)) for c in crx_id.hex())
    manifest = json.loads((source / 'manifest.json').read_text())
    manifest['key'] = base64.b64encode(public_key).decode()
    manifest['update_url'] = update_url
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in [('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode()), ('background.js', (source / 'background.js').read_bytes())]:
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    archive_bytes = archive_buffer.getvalue()
    signed_header = field(1, crx_id)
    signed_data = b'CRX3 SignedData\x00' + struct.pack('<I', len(signed_header)) + signed_header + archive_bytes
    signature = private_key.sign(signed_data, ec.ECDSA(hashes.SHA256()))
    # Verify the exact bytes that browsers will verify before publishing.
    private_key.public_key().verify(signature, signed_data, ec.ECDSA(hashes.SHA256()))
    header = field(3, field(1, public_key) + field(2, signature)) + field(10000, signed_header)
    crx = b'Cr24' + struct.pack('<II', 3, len(header)) + header + archive_bytes
    output.mkdir(parents=True, exist_ok=True)
    (output / 'extension.crx').write_bytes(crx)
    metadata = {'extensionId': extension_id, 'version': manifest['version'], 'sha256': hashlib.sha256(crx).hexdigest(), 'updateUrl': update_url}
    (output / 'extension-release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--key', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--update-url', required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.source, args.key, args.output, args.update_url), indent=2))
