# Windows Real Time Automation

Este guia migra a automacao KAP Real Time do Mac para um notebook Windows ligado 24h.

## O que roda no Windows

- Baixa a base KAP de filas.
- Baixa a base KAP de agentes/auditor.
- Gera um unico arquivo consolidado: `%USERPROFILE%\KAP\realtime_kap.xlsx`.
- Sobe o arquivo para o site via `POST /api/realtime/import`.
- Roda nos minutos fixos `00,10,20,30,40,50`.
- Continua sobrescrevendo o bloco de `ciclo_download` de 30 minutos:
  - `09:00`, `09:10`, `09:20` entram no ciclo `09:00`.
  - `09:30`, `09:40`, `09:50` entram no ciclo `09:30`.
- CEC fica desligado por enquanto.

## Requisitos

1. Instalar Node.js LTS.
2. Instalar Git.
3. Clonar o projeto no Windows.
4. Rodar `npm install` dentro do projeto.

Exemplo:

```powershell
cd "$HOME\Documents"
git clone https://github.com/runyukio/central-operacional.git
cd ".\central-operacional"
npm install
```

## Arquivos locais necessarios

Crie estes arquivos no perfil do usuario Windows:

```powershell
notepad "$HOME\.kap_cookie"
notepad "$HOME\.kap_body.json"
notepad "$HOME\.kap_auditor_body.json"
notepad "$HOME\.kap_env"
```

Conteudo esperado:

- `.kap_cookie`: valor completo do header `Cookie` do KAP.
- `.kap_body.json`: body JSON da exportacao de filas.
- `.kap_auditor_body.json`: body JSON da exportacao de agentes/auditor.
- `.kap_env`: configuracao local.

Modelo de `.kap_env`:

```env
REALTIME_SITE_URL=https://eastriverbrasil.com
REALTIME_IMPORT_TOKEN=COLE_O_TOKEN_AQUI
KAP_UPLOAD_ENABLED=true
KAP_OUTPUT_DIR=C:\Users\SEU_USUARIO\KAP
KAP_ALLOWED_MINUTES=00,10,20,30,40,50
KAP_ENFORCE_ALLOWED_MINUTE_SLOTS=true
KAP_COOKIE_MAX_AGE_HOURS=72
KAP_RUN_CEC=false
```

## Teste manual

Antes de agendar, rode manualmente:

```powershell
cd "C:\caminho\do\projeto"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\download-kap.ps1"
```

Resultado esperado:

```text
Downloading queue...
queue download complete
Downloading auditor...
auditor download complete
Building Real Time workbook...
Real Time workbook: C:\Users\...\KAP\realtime_kap.xlsx
Uploading Real Time workbook...
{"success":true,...}
```

## Instalar no Agendador de Tarefas

No PowerShell:

```powershell
cd "C:\caminho\do\projeto"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-kap-task.ps1"
```

O instalador cria 6 tarefas:

- `KAP Real Time Download 00`
- `KAP Real Time Download 10`
- `KAP Real Time Download 20`
- `KAP Real Time Download 30`
- `KAP Real Time Download 40`
- `KAP Real Time Download 50`

Isso evita horarios quebrados quando o computador reinicia.

## Validar se esta rodando

```powershell
Get-ScheduledTask | Where-Object TaskName -like "KAP Real Time Download*"
Get-Content "$HOME\KAP\logs\kap-download.out.log" -Tail 80
Get-Content "$HOME\KAP\logs\kap-download.err.log" -Tail 80
```

## Remover automacao

```powershell
cd "C:\caminho\do\projeto"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\uninstall-kap-task.ps1"
```

## Atualizar cookie

A cada 3 dias:

1. Abra o KAP no navegador.
2. Faca uma exportacao manual.
3. Copie o header `Cookie`.
4. Substitua o conteudo de:

```powershell
notepad "$HOME\.kap_cookie"
```

5. Rode um teste manual:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\download-kap.ps1"
```
