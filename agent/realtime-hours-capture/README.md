# Realtime Hours Capture 0.4.0

Agente Windows da Central Operacional para captura silenciosa e transparente de presença, ociosidade e atividade da estação.

## Fluxo

```text
Computador -> /api/realtime-hours/agent-snapshot -> presença e horas
Computador -> /api/realtime-hours/agent-activity -> domínio/aplicativo e intervalo
```

O agente roda em segundo plano na sessão interativa do Windows. Não abre PowerShell, Prompt ou notificações durante o uso normal. A tarefa continua visível para TI no Agendador de Tarefas e no Gerenciador de Tarefas.

## Transparência e privacidade

A implantação deve ocorrer somente após comunicação formal aos colaboradores.

O agente captura:

- hostname, usuário Windows e WB/Login;
- IP local, status da sessão e tempo ocioso;
- aplicativo em primeiro plano;
- domínio da aba ativa em navegador compatível;
- início, fim e duração do intervalo;
- versão do agente.

O agente não captura:

- tela, vídeo, teclado, senha, texto digitado ou clipboard;
- conteúdo da página ou de e-mails;
- URL completa, caminho, parâmetros ou título da página;
- histórico anterior à instalação.

Exemplo armazenado:

```text
chatgpt.com | 14:00 - 14:10 | 10 minutos
```

Em janela Incognito, InPrivate ou anônima, registra apenas `Navegação privada`, sem domínio.

## Navegadores suportados no piloto

A captura usa a API de acessibilidade do Windows para ler a barra de endereços da janela em primeiro plano. O valor é sanitizado em memória e somente o hostname é enviado.

- Microsoft Edge
- Google Chrome
- Mozilla Firefox
- Brave
- Opera
- Vivaldi

Quando a barra não está acessível, o navegador é registrado como aplicativo, sem inventar domínio.

## Instalação de um clique

Arquivos na mesma pasta:

```text
Instalar.vbs
instalar-silencioso.bat
install-one-click.ps1
install-workstation-task.ps1
RealtimeHoursAgent.ps1
setup.json
uninstall-workstation-task.ps1
```

1. Copie `setup.example.json` para `setup.json`.
2. Preencha `cloudToken` com o valor de `REALTIME_HOURS_AGENT_TOKEN` da Central.
3. Clique duas vezes em `Instalar.vbs`.
4. Aceite somente a confirmação administrativa do Windows.

Depois disso, a instalação e a execução ficam sem console visível. Por padrão, `setup.json` é removido após a instalação para não deixar o token em texto claro no pacote.

Configuração recomendada:

```json
{
  "cloudUrl": "https://eastriverbrasil.com",
  "cloudToken": "SUBSTITUIR_PELO_TOKEN_DO_AGENT",
  "wbLogin": "",
  "employeeId": "",
  "heartbeatSeconds": 120,
  "activeThresholdSeconds": 300,
  "activityEnabled": true,
  "captureDomains": true,
  "activitySampleSeconds": 5,
  "activityUploadSeconds": 60,
  "activityMaxSegmentSeconds": 3600,
  "identitySource": "windows_user",
  "identityConfidence": "MEDIUM",
  "removeSetupAfterInstall": true
}
```

## Instalação e arquivos locais

```text
C:\ProgramData\CentralOperacional\RealtimeHoursAgent
```

- `config.json`: configuração com token protegido por DPAPI da máquina;
- `queue\`: fila de presença;
- `queue\activity\`: fila de atividade;
- `failed\`: quarentena de payloads recusados;
- `logs\agent.log`: log técnico;
- `logs\installation.log`: log da instalação.

Tarefa criada:

```text
Central Operacional - Realtime Hours Agent
```

## Central Operacional

Página:

```text
/captura-horas/atividade
```

Acesso:

- Supervisor: somente colaboradores vinculados diretamente à sua equipe;
- WFM: visão operacional;
- Gestor, Coordenador e Gerente: visão gerencial;
- Administrador: visão completa.

A tela contém resumo de tempo monitorado, sites, aplicativos, inatividade, tela bloqueada, rankings e timeline por colaborador.

## Retenção

```env
REALTIME_HOURS_ACTIVITY_RETENTION_DAYS=7
```

Padrão: 7 dias. Limite: 1 a 90 dias.

## Teste técnico

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ProgramData\CentralOperacional\RealtimeHoursAgent\RealtimeHoursAgent.ps1" -Mode Once
Get-Content "C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\agent.log" -Tail 100
Get-ScheduledTask -TaskName "Central Operacional - Realtime Hours Agent"
```

## Desinstalação

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-workstation-task.ps1
powershell -ExecutionPolicy Bypass -File .\uninstall-workstation-task.ps1 -RemoveData
```

## Rollout recomendado

1. Comunicar formalmente a política de monitoramento.
2. Rotacionar tokens antigos expostos em documentos ou pacotes.
3. Aplicar a migração e publicar a Central.
4. Instalar em uma máquina piloto.
5. Validar presença, domínio, ociosidade, bloqueio e fila offline.
6. Ampliar para 5 a 10 máquinas.
7. Expandir em lotes após validação operacional, técnica e jurídica.
