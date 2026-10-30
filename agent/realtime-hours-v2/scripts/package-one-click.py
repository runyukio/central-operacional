#!/usr/bin/env python3
"""Package an isolated homologation pilot after verifying the published API and CRX."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse
from urllib.request import urlopen
import zipfile


def make_package(root, enrollment_file, output, commit):
    root, output = Path(root).resolve(), Path(output).resolve()
    enrollment = json.loads(Path(enrollment_file).read_text())
    fleet = enrollment.get('mode') == 'fleet'
    field = 'deploymentCode' if fleet else 'enrollmentCode'
    if not re.fullmatch(r'[A-Za-z0-9_-]{32}', enrollment.get(field, '')):
        raise ValueError('invalid temporary enrollment authorization')
    if not fleet and enrollment.get('maxUses') != 1:
        raise ValueError('expected a single-use enrollment')
    if fleet and ('enrollmentCode' in enrollment or enrollment.get('installationLimit') is not None):
        raise ValueError('fleet packages require independent single-use codes without a machine limit')
    if 'expiresAt' not in enrollment or (not fleet and enrollment['expiresAt'] is None):
        raise ValueError('explicit enrollment lifetime is required')
    expires = datetime.fromisoformat(enrollment['expiresAt'].replace('Z', '+00:00')) if enrollment['expiresAt'] is not None else None
    if expires is not None and (expires - datetime.now(timezone.utc)).total_seconds() > 7 * 24 * 3600:
        raise ValueError('dated enrollment authorization cannot exceed seven days')
    if expires is not None and expires <= datetime.now(timezone.utc):
        raise ValueError('expired enrollment')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('a source commit is required')
    extension = json.loads((root / 'public/realtime-hours-v2/extension-release.json').read_text())
    update_url = extension['updateUrl']
    endpoint = urlparse(update_url)
    if endpoint.scheme != 'https' or endpoint.hostname != 'realtime-hours-v2-homologacao.vercel.app':
        raise ValueError('only the isolated homologation URL is accepted')
    base_url = 'https://' + endpoint.hostname
    with urlopen(base_url + '/api/realtime-hours/v2/health', timeout=30) as response:
        health = json.load(response)
    if health.get('success') is not True or health.get('environment') != 'homologation' or health.get('extensionId') != extension['extensionId']:
        raise ValueError('homologation did not confirm this extension and schema')
    if fleet and health.get('fleetEnrollment') is not True:
        raise ValueError('the server does not support fleet enrollment')
    if fleet and expires is None and health.get('persistentFleetEnrollment') is not True:
        raise ValueError('the server does not support persistent fleet enrollment')
    with urlopen(update_url, timeout=30) as response:
        if extension['extensionId'] not in response.read().decode():
            raise ValueError('extension update identity mismatch')
    with urlopen(base_url + '/realtime-hours-v2/extension.crx', timeout=30) as response:
        remote_crx = response.read()
    if hashlib.sha256(remote_crx).hexdigest() != extension['sha256']:
        raise ValueError('published CRX mismatch')
    agent = root / 'agent/realtime-hours-v2'
    binary = (agent / 'dist/RealtimeHoursAgentV2.exe').read_bytes()
    if binary[:2] != b'MZ':
        raise ValueError('expected a Windows executable')
    files = {p.name: p.read_bytes() for p in (agent / 'installer').glob('*.ps1')}
    files.update({'RealtimeHoursAgentV2.exe': binary, 'extension.crx': remote_crx})
    release = {'schemaVersion': 1, 'environment': 'homologation', 'baseUrl': base_url,
               'extensionId': extension['extensionId'], 'extensionUpdateUrl': update_url,
               'commit': commit, 'pilot': True, 'installerExpiresAt': enrollment['expiresAt'], 'enrollmentMode': 'fleet' if fleet else 'single-use',
               'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files['release.json'] = (json.dumps(release, indent=2) + '\n').encode()
    files['enrollment.json'] = (json.dumps(enrollment, indent=2) + '\n').encode()
    files['INSTALAR-REALTIME-HOURS-V2.bat'] = (agent / 'installer/INSTALAR-REALTIME-HOURS-V2.bat.in').read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    usage = 'Este ZIP pode instalar varias maquinas, sem limite de quantidade.\nCada instalacao recebe automaticamente um codigo individual de uso unico.\n' if fleet else 'Este ZIP cadastra UMA maquina.\n'
    validity = 'SEM DATA DE EXPIRACAO. Autorizacao de cadastro reutilizavel e revogavel na Central.' if expires is None else 'Valida ate (UTC): ' + enrollment['expiresAt']
    files['LEIA-ME.txt'] = ('''REALTIME HOURS V2 - PACOTE CORPORATIVO (HOMOLOGACAO)

1. Extraia todos os arquivos do ZIP para uma pasta.
2. Execute INSTALAR-REALTIME-HOURS-V2.bat como administrador.
3. O cadastro e automatico. Nao digite token, codigo ou Extension ID.

''' + usage + '''Autorizacao para NOVAS instalacoes: ''' + validity + '''
Internet necessaria na primeira instalacao. O agente mantem fila local durante falhas de conexao.
Destino: servidor V2 de homologacao com envio autorizado para a Central Operacional.
Maquinas ja instaladas continuam funcionando apos o vencimento deste ZIP.
Para instalar em outra maquina, extraia novamente o ZIP original nessa maquina.

A coleta inclui dominio da aba ativa e presenca. Nao coleta caminho da URL, conteudo ou senha.
A autorizacao e apagada da pasta extraida apos o cadastro da maquina.
Nao publique este ZIP: distribua somente entre os computadores autorizados da empresa.
A autorizacao deste ZIP serve somente para cadastrar novas maquinas.
Cada maquina recebe uma credencial exclusiva protegida pelo Windows.
Token global de envio, service role do Supabase e chave mestra do servidor nao estao neste ZIP.

DIAGNOSTICO
Apos instalar, envie RealtimeHoursV2-Diagnostico.json da area de trabalho publica para validar o piloto.
Ele nao inclui credenciais. Logs: C:\\ProgramData\\CentralOperacional\\RealtimeHoursV2-Installer
Para coletar novamente: botao direito em Collect-RealtimeHoursV2Diagnostics.ps1 > Executar com PowerShell.

DESINSTALACAO
Configuracoes do Windows > Aplicativos > Central Operacional - Realtime Hours V2 (Homologacao).

PENDENTES NO WINDOWS
Instalacao limpa, upgrade, reinicio, Chrome, Edge, desconexao/reconexao e desinstalacao.
Este pacote e piloto. A aprovacao final depende desses testes.
Em falha apos o consumo do cadastro, envie o log para receber outro pacote.
Se faltar rede durante o rollback, a restauracao remota pode exigir revisao na Central.
''').encode()
    if sum(name.lower().endswith('.bat') for name in files) != 1:
        raise ValueError('expected exactly one main BAT')
    for name, data in files.items():
        if name.endswith('.exe') or name == 'extension.crx':
            continue
        if b'BEGIN PRIVATE KEY' in data or b'AQAAANCMnd8BFdER' in data:
            raise ValueError('unexpected permanent credential in package')
    files['SHA256SUMS.txt'] = ''.join(hashlib.sha256(data).hexdigest() + '  ' + name + '\n' for name, data in sorted(files.items())).encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as staging:
        target = Path(staging) / output.name
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                archive.writestr(name, data)
        with zipfile.ZipFile(target) as archive:
            if archive.testzip() is not None:
                raise ValueError('ZIP integrity verification failed')
        target.replace(output)
    return {'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'expiresAt': enrollment['expiresAt'], 'installationLimit': None if fleet else 1, 'fileCount': len(files), 'pilot': True, 'mode': 'fleet' if fleet else 'single-use'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--enrollment', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    print(json.dumps(make_package(args.root, args.enrollment, args.output, args.commit), indent=2))
