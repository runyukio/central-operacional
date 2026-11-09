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
- amostragem local preservada em dois segundos; o instalador atual configura presença a cada 60 segundos e despacho de atividade a cada 30 segundos;
- atividades compatíveis agrupadas em pedidos de até 500 registros e 512 KiB, com confirmação do lote completo;
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


## Interactive sessions (agent 1.0.0-alpha.2)

The shared scheduled task runs as the INTERACTIVE group. It starts on any user's logon, console connection, remote connection and unlock; StopExisting keeps a single collector across session switches. The process stops collecting when its own WTS session is no longer active. The installer starts the task explicitly in the logged-on session, including when UAC uses another administrator account.

Program files and the DPAPI machine-protected enrollment authorization remain in ProgramData with read-only access for interactive users. Each Windows profile enrolls automatically on its first online start and keeps its own device credential (DPAPI CurrentUser), queue and logs in LocalAppData. Browser state is also separated by Windows session ID. Existing profile credentials are reused after reboot and reconnect. The installer migrates the legacy owner's pending queue and credential before replacing the task; it does not attribute that queue to the user performing the upgrade.

Sampling persists observed checkpoints independently of network upload. A successful acknowledgement removes only the exact queued version it accepted, preserving a newer checkpoint written during the request. Resume gaps are closed at the last observation and start a fresh interval; suspended or powered-off time is not charged as website activity. Automatic task re-registration and credential rollback run in the same interactive session on installation failure.

CI validates the actual Windows Task Scheduler group, triggers and single-instance policy, both DPAPI scopes and profile isolation. A physical reboot, fast user switch and browser capture acceptance run still requires the user's Windows pilot.

## Upload batching (agent 1.0.0-alpha.3)

The uploader groups compatible persisted activity items without mixing Windows users, device envelopes or agent versions. It preserves event IDs and every record field. A successful response must acknowledge the exact number of records sent; incomplete acknowledgements, transport failures, authorization failures and throttling keep the queue for an idempotent retry. A permanent payload rejection is split to isolate a bad persisted item instead of quarantining healthy siblings. Heartbeats take priority between activity requests.

Retries back off from 30 seconds to five minutes and respect a later server Retry-After deadline. Normal sampling, presence and dispatch intervals are unchanged. New observations continue to be persisted while network requests are in flight; acknowledging an older version cannot delete the updated checkpoint.

The optional machine-config field `openCheckpointUploadIntervalSeconds` controls only remote uploads of the still-open activity segment. Omitted or zero preserves the existing dispatch cadence for older configurations. The alpha.3 installer now writes the approved value of 240 seconds: four minutes for an open checkpoint plus the page's one-minute refresh budget. A dedicated deadline wakes the uploader without waiting for another ordinary 30-second dispatch tick. Closed segments remain eligible at the ordinary dispatch interval; local two-second checkpoints and 60-second presence continue. Network errors can extend visibility delay while the queue remains durable. Deploying backend code or replacing the binary alone does not silently edit old configurations. Local version-bound `.open` sidecars keep queue JSON compatible with the older agent during rollback.

There is no executable auto-update mechanism. Updating the signed browser extension does not update the Go agent. The local `scripts/package-update.py` kit updates existing per-user V2 installations without enrollment authorization, preserving credentials and queues. It requires a trusted package, administrative elevation and an active Windows session; no executable is downloaded remotely. See [cost-client-rollout.md](../../docs/realtime-hours-v2/cost-client-rollout.md) for packaging, Windows acceptance and rollback requirements.
