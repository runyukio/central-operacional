# Arquitetura V2

```text
Chrome / Edge extension
  | somente domínio + foco + horário
  v
Native Messaging Host (mesmo binário Go)
  | escrita atômica em ProgramData
  v
Windows Agent V2
  | amostra local 2s
  | segmentos locais
  | fila offline
  | HMAC por dispositivo
  v
Next.js API V2
  | autenticação + validação Zod
  | idempotência por eventId
  v
PostgreSQL / Supabase
  | CurrentState: upsert por device
  | ActivitySegment: mudança de contexto
  | DailySummary: agregado
```

## Componentes

### Agente Windows

Go, binário único, `windowsgui`, sem console. Executa na sessão interativa por tarefa agendada.
Usa Win32 para foreground process, inatividade e bloqueio. Mantém fila em arquivos com rename atômico.

### Native Messaging

O mesmo executável é copiado com nome de host nativo. O modo é inferido pelo nome do executável ou passado por parâmetro.
O host recebe mensagens length-prefixed do Chromium e grava estado sanitizado em `ProgramData`.

### Extensão

Manifest V3 sem content script. Usa somente eventos de abas/janelas e `nativeMessaging`.
A URL é reduzida a hostname em memória antes de sair da extensão.

### Backend

Endpoints separados de enrollment, heartbeat e activity. Cada dispositivo usa segredo próprio derivado de uma chave mestre do servidor.
Requests são assinados com HMAC-SHA256.

### Persistência

- `WorkstationDeviceV2`: inventário e revogação.
- `WorkstationCurrentStateV2`: visão atual, uma linha por dispositivo.
- `WorkstationActivitySegmentV2`: histórico de contexto.
- `WorkstationDailySummaryV2`: agregação de longo prazo.

## Por que não PowerShell como runtime

PowerShell continua útil para instalação administrativa, mas não é adequado como runtime principal porque políticas, codificação,
contexto elevado, StrictMode, tarefa agendada e dependências de UI Automation geraram falhas repetidas. O runtime novo é compilado,
testado e independente da shell.
