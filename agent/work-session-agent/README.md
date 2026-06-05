# Central Operacional Work Session Agent

Agent Windows para o modulo **Monitoramento de Jornada**.

Ele roda em background, identifica o colaborador pelo login do Windows, cruza com `EmployeeProfile.wbLogin` no backend, guarda eventos offline em disco e sincroniza quando a internet voltar.

## O que ele captura

- `LOGIN`
- `HEARTBEAT`
- `LOCK`
- `UNLOCK`
- `SLEEP`
- `WAKE`
- `LOGOUT` quando enviado manualmente ou por encerramento controlado

Ele tambem envia:

- WB/Login detectado no Windows
- hostname
- versao do Agent
- timezone
- sistema operacional

Ele **nao captura** tela, teclado, mouse, sites, aplicativos, arquivos ou conteudo da estacao.

## Pre-requisito no servidor

Configure uma chave de matricula no ambiente do site:

```bash
WORK_SESSION_AGENT_ENROLLMENT_KEY="uma-chave-forte-aqui"
```

Essa chave e usada somente para matricular o dispositivo pela primeira vez. O Agent nao usa `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` nem qualquer segredo do Supabase.

Depois de alterar variaveis de ambiente, faca novo deploy do site.

## Instalacao no Windows

Abra PowerShell como Administrador na pasta `agent/work-session-agent` e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ApiBaseUrl "https://seu-site.vercel.app" -EnrollmentKey "uma-chave-forte-aqui"
```

Por padrao, o Agent usa `$env:USERNAME` como WB/Login. Exemplo: se o login do Windows for `wb_ana`, ele envia `wb_ana` e o backend procura `EmployeeProfile.wbLogin = wb_ana`.

Se o login do Windows for diferente do WB/Login cadastrado, informe manualmente:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ApiBaseUrl "https://seu-site.vercel.app" -EnrollmentKey "uma-chave-forte-aqui" -WbLogin "wb_ana"
```

Se o computador estiver sem internet durante a instalacao, a tarefa ainda sera criada. O Agent tenta matricular o dispositivo e sincronizar a fila quando a API voltar a responder.

## Onde fica instalado

Padrao:

```text
C:\ProgramData\CentralOperacional\WorkSessionAgent
```

Arquivos:

- `config.json`: configuracao local, `deviceId` e `deviceToken`
- `queue\`: eventos pendentes quando estiver offline
- `logs\agent.log`: logs locais do Agent

## Como funciona offline

Cada evento vira um arquivo `.json` em `queue\`.

Se a API estiver indisponivel ou sem internet, o arquivo permanece na fila. Quando a conexao voltar, o Agent envia os eventos em ordem e remove os arquivos sincronizados.

## Tarefas agendadas criadas

- `Central Operacional - WorkSession Agent`: inicia no logon e envia heartbeat
- `Central Operacional - WorkSession Lock`: envia `LOCK` quando Windows registrar evento 4800
- `Central Operacional - WorkSession Unlock`: envia `UNLOCK` quando Windows registrar evento 4801
- `Central Operacional - WorkSession Logout`: envia `LOGOUT` quando Windows registrar evento 4647
- `Central Operacional - WorkSession Shutdown`: envia `SHUTDOWN` quando Windows registrar evento 1074

Observacao: eventos 4800/4801/4647 dependem da politica de auditoria do Windows. Mesmo sem eles, o Agent continua enviando `LOGIN`, `HEARTBEAT`, `SLEEP` e `WAKE` por deteccao de intervalo.

## Teste manual

Enviar um evento unico:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\CentralOperacional\WorkSessionAgent\WorkSessionAgent.ps1" -Mode Event -EventType HEARTBEAT
```

Forcar sincronizacao da fila:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\CentralOperacional\WorkSessionAgent\WorkSessionAgent.ps1" -Mode Flush
```

## Desinstalacao

Remover tarefas, mantendo config/fila/logs:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Remover tarefas e apagar dados locais:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveData
```
