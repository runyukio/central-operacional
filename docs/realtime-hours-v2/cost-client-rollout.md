# Realtime Hours V2 alpha.3 — batching and controlled rollout

## What changes

The Go agent groups compatible activity queue items into one HTTP request, up to500 records and512KiB of encoded JSON. The server contract already supports these limits. Event IDs, capture intervals, identity and individual records are unchanged. No database migration or workstation credential rotation is required for the batching protocol.

The server must return `success:true` and `recordsProcessed` equal to the complete request count. Missing/partial acknowledgement keeps every unacknowledged version. A later retry uses the same event IDs. Updates written locally while a request is in flight remain queued after the older version is accepted. A payload rejection is isolated by splitting persisted items; only the rejected item goes to `failed/`. Network/authentication/deployment errors retain data. Retry backoff starts at30s, caps at5min and respects a later `Retry-After` response. Presence is checked before each activity request, including split requests.

The application still checkpoints observed activity locally at 2 s. The new installer keeps heartbeat/presence at 60 s and ordinary activity dispatch at 30 s, and writes the approved open-checkpoint interval of 240 s. This budgets four minutes for the open interval plus the page's one-minute refresh. A dedicated deadline wakes the uploader without adding another 30 s dispatch tick. Completed segments keep the ordinary dispatch cadence, and a closing update to an already sent segment bypasses the open-only interval. A process restart immediately makes persisted work eligible again. Generic Go defaults remain unchanged for old configuration files: omitted/zero `openCheckpointUploadIntervalSeconds` follows the ordinary dispatch cadence. Updating the backend or binary alone does not edit those files.

Open-checkpoint metadata lives in a `.json.open` sidecar containing the SHA256 of the exact persisted JSON version. Queue JSON remains readable by alpha.2 during rollback. A crash between queue/sidecar writes can make an item eligible sooner; it does not remove observed time. Sidecars are not sent to the API. With the default interval, new sidecars are not needed.

## What is not deployed automatically

The repository has no auto-update mechanism for the executable. The browser has a CRX update endpoint for the signed extension, but that mechanism does not replace the Go daemon or Native Messaging executable. This change adds no remote executable downloader, polling updater or remote command mechanism.

An executable compiled on macOS is not a completed Windows rollout. Workstation installation, reboot, fast user switching, Native Messaging and offline acceptance must run on an authorized managed Windows pilot. Neither the Mac tests nor the CI unit tests prove those conditions on the fleet.

## Updating already installed machines without enrollment

Use `scripts/package-update.py` for an existing per-user V2 installation. This kit takes only the built Windows binary, the checkout and exact source commit; it does not need a deployment authorization or any workstation secret. It includes the executable, a local update script, the existing session helper, one BAT, the upload policy, file hashes and instructions. It never includes enrollment.json or the enrollment script.

The update script verifies hashes, copies the candidate/helper into an administrator/SYSTEM-only staging directory and verifies again before executing them. It accepts only the expected existing V2 task/profile and the existing 2/60/30 cadence. It changes the open-checkpoint setting to 240 s, replaces the two executable files atomically, preserves original ACLs and restarts the same task in the active Windows session. It confirms alpha.3, the effective 2/60/30/240 runtime policy and a new presence acknowledgement before reporting success.

Backups contain the previous executables, machine configuration and install metadata; no profile credentials, DPAPI authorizations or queue files are moved/copied. On failure after stopping, the script attempts file/configuration restoration and task restart, preserving the backup and an explicit warning if automatic recovery is incomplete. A Native Messaging process ending concurrently is tolerated; the bounded check still detects processes that remain alive. Close browsers before the pilot to reduce executable-lock conflicts.

This is a local, operator-initiated update, not a remote updater. It does not fetch an executable or call an enrollment endpoint. A previously expired/missing deployment grant is not required to update an already enrolled profile. It refuses new profiles and requires a running V2 task, an active Windows session and administrative elevation. A management system running as SYSTEM/session0 cannot blindly execute this procedure; TI must use an approved interactive-session rollout or adapt and validate its own deployment process. No Windows workstation was changed while preparing the kit.

Example after the final commit and rebuild:

```sh
python3 -B agent/realtime-hours-v2/scripts/package-update.py \
  --root /path/to/checkout \
  --binary /path/to/RealtimeHoursAgentV2.exe \
  --commit <exact-40-character-source-commit> \
  --output /private/output/RealtimeHoursV2-update.zip
```

The packager verifies the amd64 GUI PE format and hashes. It does not sign or establish Authenticode trust. The Windows update script checks the executable's reported version before replacing installed files. Trusted distribution/signing and the real Windows pilot remain required.

## Full installation packaging route

1. Commit/review the exact source and build the Windows amd64 GUI binary with `CGO_ENABLED=0`, `-trimpath` and `-ldflags "-s -w -H=windowsgui"`. The Go version constant and `Install-RealtimeHoursV2.ps1` expected version must both be1.0.0-alpha.3.
2. For a complete corporate package, place the binary at `agent/realtime-hours-v2/dist/RealtimeHoursAgentV2.exe` and run the existing `scripts/package-one-click.py` using the source commit and a private, valid fleet enrollment authorization. Never commit that authorization or ZIP to a public repository. Do not create another device credential merely to build the executable.
3. The existing launcher checks package SHA256 hashes and the homologation health/extension identity; the installer checks the executable's reported version. These are integrity/version checks, **not an Authenticode trust check**. No Authenticode signature is added by the cross-build. Use the organization's trusted software-distribution/signing process before fleet rollout; do not label a hash-only unsigned executable as signed.
4. The existing installer stages binaries, retains local rollback backups, keeps each Windows profile's DPAPI-protected credential/queue and checks successful presence acknowledgement in the active session. Reusing an existing profile does not require a new enrollment. The fleet authorization remains necessary for new profiles.
5. Use a pilot with known pending activity and at least two Windows profiles. Confirm there is exactly one daemon, unchanged device credentials, successful heartbeat, all pending event IDs accepted, preserved open-segment duration, offline recovery and browser capture. Confirm metadata reports alpha.3. Test local rollback to alpha.2 with pending queue JSON; stale sidecars are ignored by that version.
6. Distribute through the existing approved Windows management/installation process, in small batches. Verify version/last-seen and queue health after each batch. Do not remove the V2 backend, alias or database while clients still use them.

## Choosing an open-checkpoint interval

The user accepted up to five minutes of normal activity-screen delay. The alpha.3 package manifest declares `activityUploadPolicy`, its launcher passes the 240 s setting explicitly, and the installer writes `openCheckpointUploadIntervalSeconds` into the machine `config.json`. Existing installations receive it only when the updated package/configuration is actually applied. For per-user installs, bootstrap copies this machine setting into each loaded profile; device IDs, secrets and queue paths remain unchanged. Do not change `sampleIntervalSeconds`, `heartbeatIntervalSeconds` or the existing timeline gap/extrapolation rules for this optimization.

Omitted/0 preserves the current remote behavior. The approved 240 s setting uses a separate upload deadline, so it does not add the ordinary 30 s tick; the screen still refreshes every 60 s. Processing/network delays, offline periods and retry backoff can exceed the normal five-minute visibility budget. Locally persisted observed time is retained, including recovery after a process/power interruption. Closed intervals remain eligible at the installed 30 s dispatch cadence. Measure real visibility latency before expanding rollout.

## Validation performed for this change

- Go tests with race detection across all packages.
- Go vet and Windows amd64 cross-compilation.
- Tests cover10 records in1request;500-record and512KiB limits; separate profile/version envelopes; whole-batch acknowledgement; offline/auth/throttle retention; bad-item isolation; exact-version acknowledgement while sampling continues; presence priority; bounded retry/Retry-After; deferred open checkpoints; closed-segment priority; crash/restart recovery; omitted-setting compatibility.
- Eleven Python tests cover both the full package and the enrollment-free update kit, including architecture/GUI validation, policy, hashes and absence of enrollment/private files.

Windows execution/Authenticode signing, pilot acceptance and fleet distribution remain separate, inspectable deployment steps. No workstation was changed while preparing this code.
