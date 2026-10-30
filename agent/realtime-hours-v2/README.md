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


## Corporate fleet package

A fleet ZIP can enroll any number of managed Windows computers without a count limit or expiration date when issued with `never`. The ZIP contains a reusable, revocable enrollment-only authorization. Anyone holding it can enroll computers; it must be distributed internally. It contains no global upload token, Supabase service role or device master key. At installation time it exchanges the deployment authorization for a ten-minute, single-use enrollment ticket bound to the computer and interactive Windows user. Enrollment consumes that ticket atomically and issues the machine's individual DPAPI-protected credential.

The extracted authorization file is removed after enrollment. Use the original ZIP on each new computer. Expiry or revocation of the deployment authorization stops new enrollment; already installed machines keep using their individual credentials. Device revocation remains independent.

Apply `20261030144500_realtime_hours_v2_fleet_enrollment` , `20261030153000_realtime_hours_v2_persistent_fleet` and `20261030154000_realtime_hours_v2_fleet_runtime` only to the homologation database before deploying this backend. The old single-use installer remains supported. Production Central tables and calculation rules are unchanged. Delivery is enabled only for devices belonging to an operator-authorized deployment grant or the existing explicit pilot allowlist, and still requires the server delivery switches.

An operator can run `tsx scripts/create-realtime-hours-v2-deployment.ts /private/path/authorization.json never --central-delivery` with the homologation environment already configured. The script creates a private output file without printing its authorization code. Pass that file to `package-one-click.py`, then remove the private input file after verifying the ZIP. Never commit the file or the generated ZIP.
