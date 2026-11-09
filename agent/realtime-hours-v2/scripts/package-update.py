#!/usr/bin/env python3
"""Build an offline update kit for existing V2 installations; no enrollment."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import tempfile
import zipfile

POLICY = {
    "sampleIntervalSeconds": 2,
    "heartbeatIntervalSeconds": 60,
    "uploadIntervalSeconds": 30,
    "openCheckpointUploadIntervalSeconds": 240,
    "batchMaxRecords": 500,
    "batchMaxBytes": 512 * 1024,
}
VERSION = "1.0.0-alpha.3"


def verify_windows_binary(data):
    if len(data) < 256 or data[:2] != b"MZ":
        raise ValueError("expected a Windows executable")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if pe + 94 > len(data) or data[pe:pe + 4] != b"PE\x00\x00":
        raise ValueError("invalid PE header")
    if struct.unpack_from("<H", data, pe + 4)[0] != 0x8664:
        raise ValueError("expected Windows amd64")
    optional = pe + 24
    if struct.unpack_from("<H", data, optional)[0] != 0x20B or struct.unpack_from("<H", data, optional + 68)[0] != 2:
        raise ValueError("expected a 64-bit Windows GUI executable")


def make_update_package(root, binary, output, commit):
    root, binary, output = Path(root).resolve(), Path(binary).resolve(), Path(output).resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("a source commit is required")
    data = binary.read_bytes()
    verify_windows_binary(data)
    installer = root / "agent/realtime-hours-v2/installer"
    files = {name: (installer / name).read_bytes() for name in (
        "Update-RealtimeHoursV2.ps1", "Sessions-RealtimeHoursV2.ps1")}
    files["RealtimeHoursAgentV2.exe"] = data
    files["ATUALIZAR-REALTIME-HOURS-V2.bat"] = (
        installer / "ATUALIZAR-REALTIME-HOURS-V2.bat.in").read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    files["LEIA-ME.txt"] = """ATUALIZACAO DO COLETOR V2 - 1.0.0-alpha.3

Este kit atualiza somente a instalacao V2 existente por perfil Windows.
Nao inclui autorizacao de cadastro, token ou credencial nova.
Nao altera as credenciais dos perfis nem as filas locais.
Nao atualiza computadores automaticamente e nao baixa/executa programas remotos.

1. TI deve validar a origem e os hashes deste kit e aprovar a distribuicao.
2. Entre em um perfil Windows que ja use o coletor V2 e mantenha internet.
3. Feche Chrome e Edge para evitar que o Native Host prenda o executavel.
4. Extraia todos os arquivos e execute ATUALIZAR-REALTIME-HOURS-V2.bat.
5. Aceite a elevacao de administrador. A instalacao existente deve estar ativa.
6. Aguarde a confirmacao de versao, politica e presenca na sessao atual.

A captura local continua a cada 2 segundos; presenca, a cada 60 segundos.
Atividades encerradas seguem o despacho normal de 30 segundos.
O intervalo aberto e enviado em 4 minutos por prazo proprio, sem outro tick de 30 segundos.
A tela atualiza em ate 1 minuto. Rede/falhas podem aumentar o atraso; a fila preserva os dados.

A troca usa backup local e substituicao atomica dos arquivos. Em falha de confirmacao,
o script tenta restaurar arquivos/configuracao anteriores e reiniciar a tarefa.
Se o retorno nao for confirmado, o backup e preservado e a mensagem orienta acionar TI.
Nao apague a pasta do banco, os perfis ou as filas para tentar novamente.

O kit nao cadastra novos usuarios. Se ainda nao houver credencial V2 nesse perfil,
use o instalador corporativo apropriado. Um executavel atualizado nao reconfigura
outras maquinas: o kit precisa ser aplicado pelo processo aprovado da empresa.

Os hashes verificam integridade; nao substituem assinatura Authenticode e distribuicao
confiavel. O packager nao assina nem verifica a confianca de certificados do executavel.
O piloto real Windows (atualizacao, reinicio, troca de usuario, offline e retorno)
continua obrigatorio antes da expansao. Nenhum computador foi atualizado ao gerar este ZIP.
""".encode()
    manifest = {
        "schemaVersion": 1, "kind": "realtime-hours-v2-update", "agentVersion": VERSION,
        "sourceCommit": commit, "target": "windows/amd64", "activityUploadPolicy": POLICY,
        "enrollmentRequired": False, "remoteExecutableDownload": False,
        "binarySigningStatus": "not-verified-by-packager", "windowsPilotRequired": True,
        "files": {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())},
    }
    files["update-release.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    files["SHA256SUMS.txt"] = "".join(
        hashlib.sha256(content).hexdigest() + "  " + name + "\n"
        for name, content in sorted(files.items())).encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as staging:
        target = Path(staging) / output.name
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in sorted(files.items()):
                archive.writestr(name, content)
        with zipfile.ZipFile(target) as archive:
            if archive.testzip() is not None:
                raise ValueError("ZIP integrity verification failed")
        target.replace(output)
    return {"output": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "fileCount": len(files), "agentVersion": VERSION, "enrollmentRequired": False,
            "windowsPilotRequired": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    print(json.dumps(make_update_package(args.root, args.binary, args.output, args.commit), indent=2))

