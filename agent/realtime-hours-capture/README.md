# Realtime Hours Capture - instalacao direta no site

Este pacote instala o agente de captura de horas diretamente nos computadores da operacao, sem servidor Windows local.

Fluxo atual:

```text
Computador do colaborador -> https://eastriverbrasil.com/api/realtime-hours/agent-snapshot -> banco do site
```

O computador precisa apenas de internet. Nao precisa estar na mesma rede da empresa e nao precisa acessar `192.168.x.x`.

## O que o agente captura

Por padrao, captura apenas:

- hostname;
- usuario Windows;
- WB/Login configurado ou inferido do usuario Windows;
- IP da maquina;
- sessao ativa ou ociosa;
- segundos ocioso;
- horario da ultima atividade;
- versao do agente.

Nao captura tela, teclado, mouse, historico de navegador, URL ou conteudo digitado.

Janela/processo ativo ficam desligados por padrao. Use `-CaptureActiveWindow` somente se isso for aprovado internamente.

## Token necessario

Configure no ambiente de producao do site:

```env
REALTIME_HOURS_AGENT_TOKEN="um-token-forte-para-agentes"
```

Esse token autentica os computadores contra:

```text
/api/realtime-hours/agent-snapshot
```

Gere o token no PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Use esse valor como `CloudToken` na instalacao das maquinas.

## Arquivos para copiar

Copie a pasta:

```text
agent/realtime-hours-capture/workstation
```

Para cada computador, por exemplo:

```text
C:\Server\workstation
```

Dentro da pasta precisam existir:

```text
C:\Server\workstation\install-workstation-task.ps1
C:\Server\workstation\RealtimeHoursAgent.ps1
```

## Instalacao em cada maquina

Abra PowerShell como Administrador na maquina do colaborador.

Entre na pasta:

```powershell
cd "C:\Server\workstation"
```

Rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -CloudUrl "https://eastriverbrasil.com" `
  -CloudToken "TOKEN_REALTIME_HOURS_AGENT_TOKEN" `
  -IdentityConfidence "MEDIUM" `
  -RunNow
```

Se precisar informar o WB/Login manualmente:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
  -CloudUrl "https://eastriverbrasil.com" `
  -CloudToken "TOKEN_REALTIME_HOURS_AGENT_TOKEN" `
  -WbLogin "wb_login_do_colaborador" `
  -IdentityConfidence "HIGH" `
  -RunNow
```

Se o usuario Windows ja for igual ao WB/Login, pode omitir `-WbLogin`.

## Onde fica instalado

```text
C:\ProgramData\CentralOperacional\RealtimeHoursAgent
```

Arquivos principais:

- `config.json`: URL do site, token do agente e parametros;
- `queue\`: snapshots pendentes quando o site/internet estiver fora;
- `logs\agent.log`: logs locais.

## Tarefa agendada

O instalador cria a tarefa:

```text
Central Operacional - Realtime Hours Agent
```

Ela inicia no logon do usuario Windows. Se o computador for desligado, a captura para; quando ligar e o usuario logar, ela volta automaticamente.

## Teste manual

Na maquina do colaborador:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\CentralOperacional\RealtimeHoursAgent\RealtimeHoursAgent.ps1" -Mode Once
```

Confira o log:

```powershell
Get-Content "C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\agent.log" -Tail 50
```

Procure por:

```text
Snapshot enviado para site direto
```

Se aparecer `Snapshot mantido em fila`, o agente capturou, mas nao conseguiu enviar naquele momento. Ele tenta novamente no proximo ciclo.

## Rollout

1. Configure `REALTIME_HOURS_AGENT_TOKEN` no Vercel/ambiente de producao.
2. Aguarde o redeploy do site.
3. Instale em 1 maquina piloto.
4. Confirme o log com `Snapshot enviado para site direto`.
5. Confirme a maquina na tela `/captura-horas`.
6. Instale em lotes pequenos, por exemplo 5 a 10 maquinas.
7. Depois instale nas demais.

## Desinstalacao

Na maquina:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-workstation-task.ps1
```

Removendo dados locais:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-workstation-task.ps1 -RemoveData
```

## Problemas comuns

### O site recusa o envio

Verifique:

- `REALTIME_HOURS_AGENT_TOKEN` configurado em producao;
- `CloudToken` igual ao token do site;
- redeploy feito depois de criar a variavel;
- rota publicada em `/api/realtime-hours/agent-snapshot`.

### Nao aparece no site

Verifique:

- log em `C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\agent.log`;
- arquivos acumulados em `C:\ProgramData\CentralOperacional\RealtimeHoursAgent\queue`;
- se a maquina tem internet;
- se a tarefa agendada esta ativa.

### Conferir tarefa agendada

```powershell
Get-ScheduledTask -TaskName "Central Operacional - Realtime Hours Agent"
Get-ScheduledTaskInfo -TaskName "Central Operacional - Realtime Hours Agent"
```

Se estiver parada:

```powershell
Start-ScheduledTask -TaskName "Central Operacional - Realtime Hours Agent"
```

## Legado

A pasta `server/` ainda existe no repositorio para historico e rollback, mas nao faz parte do fluxo atual. O rollout atual usa somente `workstation/` e envio direto para o site.
