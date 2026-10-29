[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)][string]$AgentExe,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [Parameter(Mandatory = $true)][string]$ExtensionUpdateUrl,
  [string]$EnrollmentCode,
  [string]$EnrollmentFile,
  [string]$BaseUrl = "https://eastriverbrasil.com",
  [string]$InstallDir = "$env:ProgramData\CentralOperacional\RealtimeHoursV2"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ExpectedVersion = "1.0.0-alpha.1"
$TaskName = "Central Operacional - Realtime Hours V2"
$HostName = "com.centraloperacional.realtimehours.v2"
$StagingDir = "$InstallDir.staging.$([guid]::NewGuid().ToString('N'))"
$BackupDir = "$InstallDir.rollback.$(Get-Date -Format 'yyyyMMddHHmmss')"
$TaskBackupDir = Join-Path $env:TEMP "RealtimeHoursV2-tasks-$([guid]::NewGuid().ToString('N'))"
$CreatedFinalInstall = $false
$StoppedTasks = @()
$LocalMutationStarted = $false
$RegistrySnapshot = @()
$secretBytes = $null
$enroll = $null
$enrollBody = $null

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $encoding = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute o instalador como Administrador."
  }
}

function Get-InteractiveUser {
  $value = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Nenhum usuario interativo foi identificado." }
  try {
    $account = [Security.Principal.NTAccount]::new($value)
    [void]$account.Translate([Security.Principal.SecurityIdentifier])
  } catch {
    throw "O usuario interativo '$value' nao pode ser validado."
  }
  return $value.Trim()
}

function Get-RelatedTasks {
  return @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $arguments = @($_.Actions | ForEach-Object {
      $property = $_.PSObject.Properties['Arguments']
      if ($property) { [string]$property.Value } else { '' }
    }) -join ' '
    $_.TaskName -match '(?i)Central Operacional.*Realtime Hours' -or
    $arguments -match '(?i)RealtimeHoursAgent|RealtimeHoursV2'
  })
}

function Backup-And-StopTasks {
  New-Item -ItemType Directory -Path $TaskBackupDir -Force | Out-Null
  $metadata = @()
  foreach ($task in @(Get-RelatedTasks)) {
    $safeName = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($task.TaskPath)|$($task.TaskName)")).TrimEnd('=').Replace('/', '_').Replace('+', '-')
    $xmlPath = Join-Path $TaskBackupDir "$safeName.xml"
    Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Set-Content -LiteralPath $xmlPath -Encoding Unicode
    $metadata += [pscustomobject]@{ Name = $task.TaskName; Path = $task.TaskPath; Xml = $xmlPath; WasRunning = ($task.State -eq "Running") }
    $script:StoppedTasks = @($metadata)
    Stop-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
  }
  $script:StoppedTasks = @($metadata)
}

function Restore-Tasks {
  foreach ($task in @($script:StoppedTasks)) {
    if (-not (Test-Path -LiteralPath $task.Xml)) { continue }
    try {
      Register-ScheduledTask -TaskName $task.Name -TaskPath $task.Path -Xml (Get-Content -LiteralPath $task.Xml -Raw) -Force | Out-Null
      if ($task.WasRunning) { Start-ScheduledTask -TaskName $task.Name -TaskPath $task.Path -ErrorAction Stop }
    } catch {
      Write-Warning "Nao foi possivel restaurar a tarefa $($task.Name): $($_.Exception.Message)"
    }
  }
}

function Stop-RelatedProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      ([string]$_.CommandLine -match '(?i)(RealtimeHoursAgent|RealtimeHoursV2\.exe.*-mode daemon|RealtimeHoursNativeHost)')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

function Remove-ExtensionPolicyValue {
  param([string]$BrowserPath)
  $forceList = Join-Path $BrowserPath 'ExtensionInstallForcelist'
  $item = Get-ItemProperty -Path $forceList -ErrorAction SilentlyContinue
  if (-not $item) { return }
  foreach ($property in @($item.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' })) {
    if ([string]$property.Value -match "^$([regex]::Escape($ExtensionId));") {
      Remove-ItemProperty -Path $forceList -Name $property.Name -ErrorAction SilentlyContinue
    }
  }
}

function Set-ExtensionPolicy {
  param([string]$BrowserPath)
  $forceList = Join-Path $BrowserPath 'ExtensionInstallForcelist'
  New-Item -Path $forceList -Force | Out-Null
  Remove-ExtensionPolicyValue -BrowserPath $BrowserPath
  $item = Get-ItemProperty -Path $forceList -ErrorAction SilentlyContinue
  $usedNames = if ($item) {
    @($item.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object { $_.Name })
  } else { @() }
  $slot = 1
  while ($usedNames -contains [string]$slot) { $slot++ }
  New-ItemProperty -Path $forceList -Name ([string]$slot) -Value "$ExtensionId;$ExtensionUpdateUrl" -PropertyType String -Force | Out-Null
}


function Backup-RegistryArtifacts {
  foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
    $native = "HKLM:\SOFTWARE\$browser\NativeMessagingHosts\$HostName"
    $policy = "HKLM:\SOFTWARE\Policies\$browser\ExtensionInstallForcelist"
    $values = @()
    if (Test-Path $policy) {
      $values = @((Get-ItemProperty $policy).PSObject.Properties | Where-Object {
        $_.Name -match '^\d+$' -and [string]$_.Value -match "^$([regex]::Escape($ExtensionId));"
      } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Value = $_.Value } })
    }
    $script:RegistrySnapshot += [pscustomobject]@{
      Native = $native; Existed = (Test-Path $native)
      Default = if (Test-Path $native) { (Get-Item $native).GetValue('') } else { $null }
      Policy = $policy; Values = $values
    }
  }
}

function Restore-RegistryArtifacts {
  foreach ($entry in $script:RegistrySnapshot) {
    if ($entry.Existed) {
      New-Item -Path $entry.Native -Force | Out-Null
      Set-Item -Path $entry.Native -Value $entry.Default
    }
    foreach ($value in $entry.Values) {
      New-Item -Path $entry.Policy -Force | Out-Null
      New-ItemProperty -Path $entry.Policy -Name $value.Name -Value $value.Value -PropertyType String -Force | Out-Null
    }
  }
}

function Set-InstallPermissions {
  param([string]$InteractiveUser, [string[]]$RuntimeDirectories, [string]$SecretPath)
  & icacls.exe $InstallDir /inheritance:r /grant:r `
    '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "${InteractiveUser}:(OI)(CI)RX" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao proteger a pasta de instalacao." }
  foreach ($directory in $RuntimeDirectories) {
    & icacls.exe $directory /inheritance:r /grant:r `
      '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "${InteractiveUser}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao proteger os dados de execucao." }
  }
  & icacls.exe $SecretPath /inheritance:r /grant:r `
    '*S-1-5-18:F' '*S-1-5-32-544:F' "${InteractiveUser}:R" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao proteger a credencial do dispositivo." }
}

function Invoke-AgentMode {
  param([string]$Exe, [string]$Mode, [string]$ConfigPath, [string]$OutputPath = '')
  $arguments = @('-mode', $Mode)
  if ($ConfigPath) { $arguments += @('-config', ('"{0}"' -f $ConfigPath)) }
  if ($OutputPath) { $arguments += @('-output', ('"{0}"' -f $OutputPath)) }
  $process = Start-Process -FilePath $Exe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Agent mode '$Mode' terminou com codigo $($process.ExitCode)." }
}

function Test-ExtensionEndpoint {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $ExtensionUpdateUrl -TimeoutSec 30
  if ($response.StatusCode -ne 200 -or [string]$response.Content -notmatch [regex]::Escape($ExtensionId)) {
    throw "O endpoint de atualizacao da extensao nao confirmou o ExtensionId informado."
  }
}

function Remove-V2Artifacts {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  foreach ($registryPath in @(
    "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName"
  )) { Remove-Item -Path $registryPath -Recurse -Force -ErrorAction SilentlyContinue }
}

Assert-Administrator
if (-not (Test-Path -LiteralPath $AgentExe -PathType Leaf)) { throw "AgentExe nao encontrado: $AgentExe" }
if ($BaseUrl -notmatch '^https://') { throw "BaseUrl deve usar HTTPS." }
if ($ExtensionUpdateUrl -notmatch '^https://') { throw "ExtensionUpdateUrl deve usar HTTPS." }
if ($EnrollmentFile) {
  $enrollment = Get-Content -LiteralPath $EnrollmentFile -Raw | ConvertFrom-Json
  if ([DateTimeOffset]::Parse([string]$enrollment.expiresAt) -le [DateTimeOffset]::UtcNow) { throw "Este pacote de instalacao expirou. Solicite um novo pacote." }
  $EnrollmentCode = [string]$enrollment.enrollmentCode
}
if ([string]::IsNullOrWhiteSpace($EnrollmentCode)) { throw "EnrollmentCode e obrigatorio." }

$interactiveUser = Get-InteractiveUser
$windowsUser = ($interactiveUser -split '\\')[-1].Trim().ToLowerInvariant()
$versionOutput = Join-Path $env:TEMP "RealtimeHoursV2-version-$([guid]::NewGuid().ToString('N')).txt"
$diagnosticOutput = Join-Path $env:TEMP "RealtimeHoursV2-diagnostic-$([guid]::NewGuid().ToString('N')).json"
$finalDiagnostic = Join-Path $env:TEMP "RealtimeHoursV2-final-$([guid]::NewGuid().ToString('N')).json"

try {
  if (-not $PSCmdlet.ShouldProcess($InstallDir, 'Instalar Realtime Hours V2')) { return }

  Test-ExtensionEndpoint
  Invoke-AgentMode -Exe $AgentExe -Mode 'version' -ConfigPath '' -OutputPath $versionOutput
  $reportedVersion = (Get-Content -LiteralPath $versionOutput -Raw).Trim()
  if ($reportedVersion -ne $ExpectedVersion) { throw "Versao inesperada do binario: $reportedVersion" }

  New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
  $stageExe = Join-Path $StagingDir 'RealtimeHoursAgentV2.exe'
  $stageNative = Join-Path $StagingDir 'RealtimeHoursNativeHostV2.exe'
  Copy-Item -LiteralPath $AgentExe -Destination $stageExe -Force
  Copy-Item -LiteralPath $AgentExe -Destination $stageNative -Force

  $enrollBody = @{
    enrollmentCode = $EnrollmentCode
    hostname = $env:COMPUTERNAME
    windowsUser = $windowsUser
    agentVersion = $ExpectedVersion
  } | ConvertTo-Json -Compress
  $enroll = Invoke-RestMethod -Method Post -Uri "$($BaseUrl.TrimEnd('/'))/api/realtime-hours/v2/enroll" -ContentType 'application/json' -Body $enrollBody -TimeoutSec 30
  if (-not $enroll.success -or [string]::IsNullOrWhiteSpace([string]$enroll.deviceId) -or [string]::IsNullOrWhiteSpace([string]$enroll.deviceSecret)) {
    throw "A Central recusou o enrollment do dispositivo."
  }

  $encodedSecret = ([string]$enroll.deviceSecret).Replace('-', '+').Replace('_', '/')
  while (($encodedSecret.Length % 4) -ne 0) { $encodedSecret += '=' }
  try { $secretBytes = [Convert]::FromBase64String($encodedSecret) }
  catch { throw "A Central retornou um segredo de dispositivo invalido." }
  if ($secretBytes.Length -lt 32) { throw "O segredo de dispositivo retornado e muito curto." }
  $stageSecret = Join-Path $StagingDir 'device-secret.dpapi'
  $protected = [Security.Cryptography.ProtectedData]::Protect($secretBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllBytes($stageSecret, $protected)
  # Only the single-use enrollment lives in the extracted package. The device
  # credential is generated by the server and protected on this Windows machine.
  if ($EnrollmentFile) { Remove-Item -LiteralPath $EnrollmentFile -Force -ErrorAction Stop }
  $EnrollmentCode = $null
  $enrollBody = $null
  $enrollment = $null

  $stageState = Join-Path $StagingDir 'browser-state'
  $stageQueue = Join-Path $StagingDir 'queue'
  $stageFailed = Join-Path $StagingDir 'failed'
  $stageLogs = Join-Path $StagingDir 'logs'
  New-Item -ItemType Directory -Path $stageState, $stageQueue, $stageFailed, $stageLogs -Force | Out-Null
  $stageConfig = Join-Path $StagingDir 'config.json'
  [ordered]@{
    schemaVersion = 1; baseUrl = $BaseUrl.TrimEnd('/'); deviceId = [string]$enroll.deviceId
    secretFile = $stageSecret; stateDir = $stageState; queueDir = $stageQueue; failedDir = $stageFailed; logDir = $stageLogs
    sampleIntervalSeconds = 2; heartbeatIntervalSeconds = 300; uploadIntervalSeconds = 300
    idleThresholdSeconds = 300; maxSegmentSeconds = 3600; browserStateMaxAgeSeconds = 45
  } | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Utf8NoBom -Path $stageConfig -Content $_ }
  Invoke-AgentMode -Exe $stageExe -Mode 'diagnose' -ConfigPath $stageConfig -OutputPath $diagnosticOutput
  $diagnostic = Get-Content -LiteralPath $diagnosticOutput -Raw | ConvertFrom-Json
  if (-not $diagnostic.success -or $diagnostic.agentVersion -ne $ExpectedVersion -or -not $diagnostic.credentialOk) {
    throw "O diagnostico de pre-instalacao do agente falhou."
  }

  Backup-RegistryArtifacts
  $LocalMutationStarted = $true
  Backup-And-StopTasks
  Stop-RelatedProcesses
  if (Test-Path -LiteralPath $InstallDir) { Move-Item -LiteralPath $InstallDir -Destination $BackupDir -Force }
  Move-Item -LiteralPath $StagingDir -Destination $InstallDir -Force
  $CreatedFinalInstall = $true

  $exeTarget = Join-Path $InstallDir 'RealtimeHoursAgentV2.exe'
  $nativeTarget = Join-Path $InstallDir 'RealtimeHoursNativeHostV2.exe'
  $secretPath = Join-Path $InstallDir 'device-secret.dpapi'
  $configPath = Join-Path $InstallDir 'config.json'
  $stateDir = Join-Path $InstallDir 'browser-state'
  $queueDir = Join-Path $InstallDir 'queue'
  $failedDir = Join-Path $InstallDir 'failed'
  $logDir = Join-Path $InstallDir 'logs'

  [ordered]@{
    schemaVersion = 1; baseUrl = $BaseUrl.TrimEnd('/'); deviceId = [string]$enroll.deviceId
    secretFile = $secretPath; stateDir = $stateDir; queueDir = $queueDir; failedDir = $failedDir; logDir = $logDir
    sampleIntervalSeconds = 2; heartbeatIntervalSeconds = 300; uploadIntervalSeconds = 300
    idleThresholdSeconds = 300; maxSegmentSeconds = 3600; browserStateMaxAgeSeconds = 45
  } | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Utf8NoBom -Path $configPath -Content $_ }

  [ordered]@{
    schemaVersion = 1
    installedVersion = $ExpectedVersion
    extensionId = $ExtensionId
    extensionUpdateUrl = $ExtensionUpdateUrl
    taskName = $TaskName
    nativeHostName = $HostName
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Utf8NoBom -Path (Join-Path $InstallDir 'install-metadata.json') -Content $_ }

  $hostManifest = Join-Path $InstallDir "$HostName.json"
  [ordered]@{
    name = $HostName; description = 'Central Operacional Realtime Hours V2'; path = $nativeTarget
    type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/")
  } | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Utf8NoBom -Path $hostManifest -Content $_ }

  Set-InstallPermissions -InteractiveUser $interactiveUser -RuntimeDirectories @($stateDir, $queueDir, $failedDir, $logDir) -SecretPath $secretPath

  foreach ($registryPath in @(
    "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName"
  )) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $hostManifest
  }
  Set-ExtensionPolicy -BrowserPath 'HKLM:\SOFTWARE\Policies\Google\Chrome'
  Set-ExtensionPolicy -BrowserPath 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'

  $arguments = "-mode daemon -config `"$configPath`""
  $action = New-ScheduledTaskAction -Execute $exeTarget -Argument $arguments -WorkingDirectory $InstallDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $interactiveUser
  $principal = New-ScheduledTaskPrincipal -UserId $interactiveUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Central Operacional Realtime Hours V2' -Force | Out-Null

  # Activate the pending device and validate the API before starting the daemon.
  Invoke-AgentMode -Exe $exeTarget -Mode 'once' -ConfigPath $configPath
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 5

  Invoke-AgentMode -Exe $exeTarget -Mode 'diagnose' -ConfigPath $configPath -OutputPath $finalDiagnostic
  $diagnostic = Get-Content -LiteralPath $finalDiagnostic -Raw | ConvertFrom-Json
  if (-not $diagnostic.success -or $diagnostic.agentVersion -ne $ExpectedVersion -or -not $diagnostic.credentialOk) {
    throw "O diagnostico final do agente falhou."
  }

  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    [string]$_.ExecutablePath -ieq $exeTarget -and [string]$_.CommandLine -match '(?i)-mode\s+daemon'
  })
  $remainingTasks = @(Get-RelatedTasks)
  if ($remainingTasks.Count -ne 1 -or $remainingTasks[0].TaskName -ne $TaskName) {
    throw "Era esperada exatamente uma tarefa V2; encontrado: $($remainingTasks.Count)."
  }
  if ($processes.Count -ne 1) { throw "Era esperado exatamente um processo daemon, encontrado: $($processes.Count)." }

  if (Test-Path -LiteralPath $BackupDir) { Remove-Item -LiteralPath $BackupDir -Recurse -Force }
  Remove-Item -LiteralPath $TaskBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Instalacao concluida. Reinicie Chrome e Edge para carregar a politica da extensao." -ForegroundColor Green
}
catch {
  $installationError = $_
  Write-Warning $installationError.Exception.Message
  if (-not $LocalMutationStarted) { throw $installationError }
  try { Remove-V2Artifacts } catch {}
  try {
    Remove-ExtensionPolicyValue -BrowserPath 'HKLM:\SOFTWARE\Policies\Google\Chrome'
    Remove-ExtensionPolicyValue -BrowserPath 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
  } catch {}
  try { Stop-RelatedProcesses } catch {}
  if ($CreatedFinalInstall -and (Test-Path -LiteralPath $InstallDir)) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $BackupDir) {
    Move-Item -LiteralPath $BackupDir -Destination $InstallDir -Force -ErrorAction SilentlyContinue
    $restoredManifest = Join-Path $InstallDir "$HostName.json"
    if (Test-Path -LiteralPath $restoredManifest) {
      foreach ($registryPath in @(
        "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName",
        "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName"
      )) {
        New-Item -Path $registryPath -Force | Out-Null
        Set-Item -Path $registryPath -Value $restoredManifest
      }
    }
  }
  Restore-RegistryArtifacts
  Restore-Tasks
  throw $installationError
}
finally {
  $EnrollmentCode = $null
  $enrollBody = $null
  if ($null -ne $secretBytes) { [Array]::Clear($secretBytes, 0, $secretBytes.Length) }
  $enroll = $null
  Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $versionOutput, $diagnosticOutput, $finalDiagnostic -Force -ErrorAction SilentlyContinue
}
