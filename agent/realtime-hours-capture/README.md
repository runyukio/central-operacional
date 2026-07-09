# Realtime Hours Capture - Servidor local, home office e computadores

Este pacote implementa o MVP da captura de horas em tempo real descrita em `docs/REALTIME_HOURS_CAPTURE_README.md`.

Fluxo:

```text
Presencial: Computadores da operacao -> Servidor Windows local -> API /api/realtime-hours/import -> banco do site
Home office: Computadores remotos -> API /api/realtime-hours/agent-snapshot -> banco do site
```

## O que cada parte faz

### Servidor Windows local

Roda um concentrador Node.js na rede local.

Responsabilidades:

- receber snapshots dos computadores em `POST /snapshot`;
- guardar fila local em disco quando o site estiver fora;
- consolidar varios snapshots em batch;
- enviar para `POST /api/realtime-hours/import`;
- manter logs locais.

### Computadores da operacao

Rodam um Agent PowerShell leve.

O Agent pode operar em tres modos:

- `LOCAL`: envia somente para o servidor Windows local;
- `CLOUD`: envia somente direto para o site;
- `AUTO`: tenta servidor local primeiro e, se nao conseguir, tenta o site direto.

Por padrao, captura apenas:

- hostname;
- usuario Windows;
- WB/Login configurado ou inferido do usuario Windows;
- IP interno;
- sessao ativa ou ociosa;
- segundos ocioso;
- horario da ultima atividade;
- versao do agent.

Nao captura tela, teclado, mouse, historico de navegador, URL ou conteudo digitado.

Janela/processo ativo ficam desligados por padrao. Use `-CaptureActiveWindow` somente se isso for aprovado internamente.

## Tokens

Use tres tokens diferentes quando houver home office.

### Token do site

Fica somente no servidor local Windows.

Configure no ambiente do site:

```env
REALTIME_HOURS_IMPORT_TOKEN="um-token-forte-do-site"
```

Esse token autentica o servidor local contra `/api/realtime-hours/import`.

### Token direto dos agentes

Fica no site e nos computadores que podem enviar direto para a nuvem.

Configure no ambiente do site:

```env
REALTIME_HOURS_AGENT_TOKEN="um-token-forte-para-agentes"
```

Esse token autentica os computadores contra `/api/realtime-hours/agent-snapshot`.

### Token local da LAN

Fica no servidor local Windows e nos computadores.

Ele autentica os computadores contra o servidor local.

Gere no PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Nunca coloque o `REALTIME_HOURS_IMPORT_TOKEN` do site nos computadores.

Para computadores, use `REALTIME_HOURS_AGENT_TOKEN` quando precisar enviar direto ao site.

## 1. Instalar no servidor Windows local

Pre-requisitos:

- Windows Server ou Windows sempre ligado na rede da operacao;
- Node.js LTS instalado;
- acesso do firewall liberado para a porta local, por padrao `8787`;
- `REALTIME_HOURS_IMPORT_TOKEN` ja configurado no site;
- migration do banco aplicada.

Copie a pasta:

```text
agent/realtime-hours-capture/server
```

Para o servidor Windows.

Abra PowerShell como Administrador na pasta `server` e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-server-task.ps1 `
  -SiteUrl "https://eastriverbrasil.com" `
  -ImportToken "TOKEN_DO_SITE_REALTIME_HOURS_IMPORT_TOKEN" `
  -LocalToken "TOKEN_LOCAL_DA_LAN" `
  -Port 8787 `
  -UploadIntervalMinutes 5 `
  -AddFirewallRule
```

Onde fica instalado:

```text
C:\ProgramData\CentralOperacional\RealtimeHoursServer
```

Arquivos principais:

- `config.json`: configuracao e tokens;
- `queue\`: snapshots aguardando upload;
- `sent\`: snapshots ja enviados;
- `failed\`: arquivos invalidos;
- `logs\server.log`: logs.

Teste no proprio servidor:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Forcar upload manual:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8787/upload-now `
  -Headers @{ Authorization = "Bearer TOKEN_LOCAL_DA_LAN" }
```

## 2. Instalar em um computador piloto presencial

Copie a pasta:

```text
agent/realtime-hours-capture/workstation
```

Para o computador piloto.

Abra PowerShell como Administrador na pasta `workstation` e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -ServerUrl "http://IP_DO_SERVIDOR:8787" `
  -LocalToken "TOKEN_LOCAL_DA_LAN" `
  -DeliveryMode "LOCAL" `
  -WbLogin "wb_login_do_colaborador" `
  -IdentityConfidence "HIGH" `
  -RunNow
```

Se o usuario Windows ja for igual ao WB/Login, pode omitir `-WbLogin`.

Para maquina compartilhada ou usuario Windows generico, informe `-WbLogin` na instalacao ou mantenha `IdentityConfidence` como `MEDIUM`.

## 3. Instalar em computador home office direto no site

Use este modo para pessoas fora da rede/VPN.

Antes, configure `REALTIME_HOURS_AGENT_TOKEN` no site.

No computador remoto, abra PowerShell como Administrador na pasta `workstation` e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -CloudUrl "https://eastriverbrasil.com" `
  -CloudToken "TOKEN_REALTIME_HOURS_AGENT_TOKEN" `
  -DeliveryMode "CLOUD" `
  -IdentityConfidence "MEDIUM" `
  -RunNow
```

Nesse modo, o computador nao precisa estar na mesma rede do servidor `192.168.x.x`; precisa apenas ter internet.

## 4. Instalar computador hibrido presencial/home office

Use este modo para notebooks que as pessoas usam tanto presencialmente quanto em home office.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -ServerUrl "http://IP_DO_SERVIDOR:8787" `
  -LocalToken "TOKEN_LOCAL_DA_LAN" `
  -CloudUrl "https://eastriverbrasil.com" `
  -CloudToken "TOKEN_REALTIME_HOURS_AGENT_TOKEN" `
  -DeliveryMode "AUTO" `
  -IdentityConfidence "MEDIUM" `
  -RunNow
```

O `AUTO` tenta:

1. servidor local;
2. site direto;
3. se nenhum responder, guarda em `queue\` e tenta novamente depois.

Onde fica instalado:

```text
C:\ProgramData\CentralOperacional\RealtimeHoursAgent
```

Arquivos principais:

- `config.json`: servidor local, token local e WB/Login;
- `queue\`: snapshots pendentes se o servidor local estiver fora;
- `logs\agent.log`: logs.

Teste manual no computador:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\CentralOperacional\RealtimeHoursAgent\RealtimeHoursAgent.ps1" -Mode Once
```

Depois confira no servidor:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

E confira no site:

```powershell
Invoke-RestMethod `
  -Uri "https://eastriverbrasil.com/api/realtime-hours/status" `
  -Headers @{ Authorization = "Bearer TOKEN_DO_SITE_REALTIME_HOURS_IMPORT_TOKEN" }
```

Para computador em modo `CLOUD`, confira direto no site ou no log local:

```powershell
Get-Content "C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\agent.log" -Tail 50
```

Procure por:

```text
Snapshot enviado para site direto
```

## 5. Rollout para os demais computadores

Depois do piloto funcionar:

1. Defina IP fixo ou DNS interno para o servidor local, para maquinas presenciais.
2. Confirme que computadores presenciais acessam `http://IP_DO_SERVIDOR:8787/health`.
3. Confirme que computadores home office acessam `https://eastriverbrasil.com`.
4. Instale o Agent em lotes pequenos, por exemplo 5 a 10 maquinas.
5. Monitore `queue\` e `logs\` no computador, no servidor e no site.
6. So depois instale nas 120 maquinas.

Comando base presencial:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -ServerUrl "http://IP_DO_SERVIDOR:8787" `
  -LocalToken "TOKEN_LOCAL_DA_LAN" `
  -DeliveryMode "LOCAL" `
  -RunNow
```

Comando base hibrido:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -ServerUrl "http://IP_DO_SERVIDOR:8787" `
  -LocalToken "TOKEN_LOCAL_DA_LAN" `
  -CloudUrl "https://eastriverbrasil.com" `
  -CloudToken "TOKEN_REALTIME_HOURS_AGENT_TOKEN" `
  -DeliveryMode "AUTO" `
  -RunNow
```

Comando base home office:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -CloudUrl "https://eastriverbrasil.com" `
  -CloudToken "TOKEN_REALTIME_HOURS_AGENT_TOKEN" `
  -DeliveryMode "CLOUD" `
  -RunNow
```

## 6. Tarefas agendadas

Servidor:

```text
Central Operacional - Realtime Hours Server
```

Computadores:

```text
Central Operacional - Realtime Hours Agent
```

## 7. Desinstalacao

Servidor:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-server-task.ps1
```

Servidor removendo dados locais:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-server-task.ps1 -RemoveData -RemoveFirewallRule
```

Computador:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-workstation-task.ps1
```

Computador removendo dados locais:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-workstation-task.ps1 -RemoveData
```

## 8. Checklist de piloto

- API do site responde em `/api/realtime-hours/status`.
- `REALTIME_HOURS_IMPORT_TOKEN` esta configurado no site.
- `REALTIME_HOURS_AGENT_TOKEN` esta configurado no site, se houver envio direto/cloud.
- Servidor local responde em `/health`.
- Computador piloto presencial consegue enviar `-Mode Once`.
- Computador piloto home office consegue enviar para `site direto`.
- `queue\` do computador fica vazia depois do envio.
- `queue\` do servidor fica vazia depois do upload.
- `GET /api/realtime-hours/status` mostra o ultimo batch.
- Janela/processo ativo estao desligados, salvo aprovacao explicita.

## 9. Problemas comuns

### Computador nao envia para servidor

Verifique:

- IP/porta do servidor;
- firewall do servidor;
- `LocalToken` igual nos dois lados;
- log em `C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\agent.log`.

### Computador home office nao envia para o site

Verifique:

- internet do computador;
- `CloudUrl`;
- `CloudToken` igual ao `REALTIME_HOURS_AGENT_TOKEN` do site;
- se a rota `/api/realtime-hours/agent-snapshot` ja esta publicada;
- log em `C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\agent.log`.

### Servidor recebe, mas nao sobe para o site

Verifique:

- `SiteUrl`;
- `ImportToken`;
- internet do servidor;
- log em `C:\ProgramData\CentralOperacional\RealtimeHoursServer\logs\server.log`;
- se ha arquivos acumulando em `queue\`.

### Muitas identidades UNKNOWN/MEDIUM

Feche o de/para:

- usuario Windows -> WB/Login;
- hostname -> colaborador esperado;
- maquinas compartilhadas -> regra de login operacional.
