# Realtime Hours Agent V2

Reescrita do agente Windows com foco em confiabilidade, segurança, observabilidade e custo previsível.

## Decisões principais

- executável único em Go, sem depender de PowerShell durante a operação;
- execução invisível na sessão interativa do usuário;
- extensão Manifest V3 para Chrome e Edge;
- Native Messaging usando o mesmo executável em modo host;
- nenhuma URL completa é persistida ou enviada, apenas hostname;
- fila local transacional baseada em arquivos e escrita atômica;
- autenticação HMAC por dispositivo, sem token global dentro do instalador;
- heartbeat e atividade enviados em lote a cada cinco minutos;
- uma linha de estado atual por dispositivo no backend e histórico apenas por mudança de contexto;
- instalação idempotente e remoção explícita do legado.

## Modos

```text
-mode daemon       monitora contexto e envia lotes
-mode once         captura e envia uma amostra imediata
-mode diagnose     imprime JSON de diagnóstico
-mode native-host  recebe mensagens da extensão via stdin/stdout
-mode version      imprime a versão
```

## Build local

```bash
go test ./...
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui" -o dist/RealtimeHoursAgentV2.exe ./cmd/realtime-hours-agent
```

O binário deve ser assinado antes da distribuição corporativa.
