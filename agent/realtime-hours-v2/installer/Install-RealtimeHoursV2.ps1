[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)][string]$AgentExe,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [Parameter(Mandatory = $true)][string]$ExtensionUpdateUrl,
  [string]$EnrollmentCode,
  [string]$EnrollmentFile,
  [string]$BaseUrl = "https://eastriverbrasil.com",
  [ValidateRange(0, 1800)][int]$OpenCheckpointUploadIntervalSeconds = 240,
  [string]$InstallDir = "$env:ProgramData\CentralOperacional\RealtimeHoursV2"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
if ($OpenCheckpointUploadIntervalSeconds -gt 0 -and $OpenCheckpointUploadIntervalSeconds -lt 30) { throw 'O intervalo de checkpoint deve ser zero ou pelo menos 30 segundos.' }

$ExpectedVersion = "1.0.0-alpha.3"
$TaskName = "Central Operacional - Realtime Hours V2"
$HostName = "com.centraloperacional.realtimehours.v2"
$LegacyHostName = "com.eastriver.realtime_hours"
$LegacyExtensionId = "dchmgegaidpaimhadfacbejjjamkaeah"
$StagingDir = "$InstallDir.staging.$([guid]::NewGuid().ToString('N'))"
$BackupDir = "$InstallDir.rollback.$(Get-Date -Format 'yyyyMMddHHmmss')"
$TaskBackupDir = Join-Path $env:TEMP "RealtimeHoursV2-tasks-$([guid]::NewGuid().ToString('N'))"
$CreatedFinalInstall = $false
$StoppedTasks = @()
$LocalMutationStarted = $false
$RegistrySnapshot = @()
$secretBytes = $null
$enrollment = $null
$OldPersistence = @()
$OldStartupBackup = $null

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
  param([string]$BrowserPath, [string]$TargetId = $ExtensionId)
  $forceList = Join-Path $BrowserPath 'ExtensionInstallForcelist'
  $item = Get-ItemProperty -Path $forceList -ErrorAction SilentlyContinue
  if (-not $item) { return }
  foreach ($property in @($item.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' })) {
    if ([string]$property.Value -match "^$([regex]::Escape($TargetId));") {
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
    $legacyNative = "HKLM:\SOFTWARE\$browser\NativeMessagingHosts\$LegacyHostName"
    $policy = "HKLM:\SOFTWARE\Policies\$browser\ExtensionInstallForcelist"
    $values = @()
    if (Test-Path $policy) {
      $values = @((Get-ItemProperty $policy).PSObject.Properties | Where-Object {
        $_.Name -match '^\d+$' -and [string]$_.Value -match "^($([regex]::Escape($ExtensionId))|$LegacyExtensionId);"
      } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Value = $_.Value } })
    }
    $script:RegistrySnapshot += [pscustomobject]@{
      Native = $native; Existed = (Test-Path $native)
      Default = if (Test-Path $native) { (Get-Item $native).GetValue('') } else { $null }
      Policy = $policy; Values = $values
      LegacyNative = $legacyNative; LegacyExisted = (Test-Path $legacyNative)
      LegacyDefault = if (Test-Path $legacyNative) { (Get-Item $legacyNative).GetValue('') } else { $null }
      SettingsPath = "HKLM:\SOFTWARE\Policies\$browser"
      Settings = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\$browser" -Name ExtensionSettings -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ExtensionSettings -ErrorAction SilentlyContinue)
    }
  }
}

function Restore-RegistryArtifacts {
  foreach ($entry in $script:RegistrySnapshot) {
    if ($entry.Existed) {
      New-Item -Path $entry.Native -Force | Out-Null
      Set-Item -Path $entry.Native -Value $entry.Default
    }
    if ($entry.LegacyExisted) {
      New-Item -Path $entry.LegacyNative -Force | Out-Null
      Set-Item -Path $entry.LegacyNative -Value $entry.LegacyDefault
    }
    if ($entry.Settings) {
      New-ItemProperty -Path $entry.SettingsPath -Name ExtensionSettings -Value $entry.Settings -PropertyType String -Force | Out-Null
    }
    foreach ($value in $entry.Values) {
      New-Item -Path $entry.Policy -Force | Out-Null
      New-ItemProperty -Path $entry.Policy -Name $value.Name -Value $value.Value -PropertyType String -Force | Out-Null
    }
  }
}

function Remove-LegacyBrowserArtifacts {
  foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
    $browserPath = "HKLM:\SOFTWARE\Policies\$browser"
    Remove-ExtensionPolicyValue -BrowserPath $browserPath -TargetId $LegacyExtensionId
    Remove-Item -Path "HKLM:\SOFTWARE\$browser\NativeMessagingHosts\$LegacyHostName" -Recurse -Force -ErrorAction SilentlyContinue
    $settingsValue = Get-ItemProperty -Path $browserPath -Name ExtensionSettings -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ExtensionSettings -ErrorAction SilentlyContinue
    if ($settingsValue) {
      $settings = $settingsValue | ConvertFrom-Json
      $settings.PSObject.Properties.Remove($LegacyExtensionId)
      New-ItemProperty -Path $browserPath -Name ExtensionSettings -Value ($settings | ConvertTo-Json -Depth 20 -Compress) -PropertyType String -Force | Out-Null
    }
  }
}

function Remove-LegacyPersistence {
  $runPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
  $name = 'CentralOperacionalRealtimeHoursAgent'
  $item = Get-ItemProperty -Path $runPath -ErrorAction SilentlyContinue
  if ($item -and $item.PSObject.Properties[$name]) {
    $script:OldPersistence += [pscustomobject]@{ Path = $runPath; Name = $name; Value = $item.$name }
    Remove-ItemProperty -Path $runPath -Name $name -ErrorAction Stop
  }
  $startup = Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'CentralOperacionalRealtimeHoursAgent.vbs'
  if (Test-Path -LiteralPath $startup) {
    $backup = Join-Path $TaskBackupDir 'legacy-startup.vbs'
    $script:OldStartupBackup = [pscustomobject]@{ Source = $startup; Backup = $backup }
    Move-Item -LiteralPath $startup -Destination $backup -ErrorAction Stop
  }
}

function Restore-LegacyPersistence {
  foreach ($item in $script:OldPersistence) {
    New-ItemProperty -Path $item.Path -Name $item.Name -Value $item.Value -PropertyType String -Force | Out-Null
  }
  if ($script:OldStartupBackup -and (Test-Path -LiteralPath $script:OldStartupBackup.Backup)) {
    Copy-Item -LiteralPath $script:OldStartupBackup.Backup -Destination $script:OldStartupBackup.Source -Force
  }
}

function Set-InstallPermissions {
  param([string]$SecretPath)
  & icacls.exe $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-4:(OI)(CI)RX' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger a pasta do programa.' }
  & icacls.exe $SecretPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-4:R' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger a autorizacao local de cadastro.' }
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
  Remove-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\CentralOperacionalRealtimeHoursV2' -Recurse -Force -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  foreach ($registryPath in @(
    "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName"
  )) { Remove-Item -Path $registryPath -Recurse -Force -ErrorAction SilentlyContinue }
}

Assert-Administrator
. (Join-Path $PSScriptRoot 'Windows-CredentialProtection.ps1')
. (Join-Path $PSScriptRoot 'Enrollment-RealtimeHoursV2.ps1')
. (Join-Path $PSScriptRoot 'Sessions-RealtimeHoursV2.ps1')
Initialize-WindowsCredentialProtection
if (-not (Test-Path -LiteralPath $AgentExe -PathType Leaf)) { throw "AgentExe nao encontrado: $AgentExe" }
if ($BaseUrl -notmatch '^https://') { throw "BaseUrl deve usar HTTPS." }
if ($ExtensionUpdateUrl -notmatch '^https://') { throw "ExtensionUpdateUrl deve usar HTTPS." }
if ($EnrollmentFile) {
  $enrollment = Get-Content -LiteralPath $EnrollmentFile -Raw | ConvertFrom-Json
  Assert-RealtimeEnrollmentLifetime -Enrollment $enrollment
  if ($enrollment.PSObject.Properties['enrollmentCode']) { $EnrollmentCode = [string]$enrollment.enrollmentCode }
}
if ($null -eq $enrollment -or -not $enrollment.PSObject.Properties['deploymentCode']) { throw "Use o pacote corporativo atualizado para habilitar todos os usuarios." }

$session = Get-RealtimeInteractiveSession
$windowsUser = $session.WindowsUser
$installStarted = [DateTimeOffset]::UtcNow
$profileConfig = Join-Path $session.ProfileRoot 'config.json'
$versionOutput = Join-Path $env:TEMP "RealtimeHoursV2-version-$([guid]::NewGuid().ToString('N')).txt"

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

  $stageSecret = Join-Path $StagingDir 'deployment-authorization.dpapi'
  $secretBytes = [Text.Encoding]::UTF8.GetBytes(($enrollment | ConvertTo-Json -Compress))
  $protected = [System.Security.Cryptography.ProtectedData]::Protect($secretBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllBytes($stageSecret, $protected)
  [Array]::Clear($secretBytes, 0, $secretBytes.Length)
  $legacyTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $legacyPrincipal = if ($null -ne $legacyTask) { [string]$legacyTask.Principal.UserId } else { '' }

  Backup-RegistryArtifacts
  $LocalMutationStarted = $true
  Backup-And-StopTasks
  Remove-LegacyPersistence
  Remove-LegacyBrowserArtifacts
  Stop-RelatedProcesses
  Migrate-RealtimeLegacyProfile -InstallDir $InstallDir -TaskName $TaskName -PrincipalUser $legacyPrincipal
  Set-RealtimeProfilePermissions -Root $session.ProfileRoot -Sid $session.Sid
  if (Test-Path -LiteralPath $InstallDir) { Move-Item -LiteralPath $InstallDir -Destination $BackupDir -Force }
  Move-Item -LiteralPath $StagingDir -Destination $InstallDir -Force
  $CreatedFinalInstall = $true

  $exeTarget = Join-Path $InstallDir 'RealtimeHoursAgentV2.exe'
  $nativeTarget = Join-Path $InstallDir 'RealtimeHoursNativeHostV2.exe'
  $secretPath = Join-Path $InstallDir 'deployment-authorization.dpapi'
  $configPath = Join-Path $InstallDir 'config.json'
  $stateDir = Join-Path $InstallDir 'browser-state'
  $queueDir = Join-Path $InstallDir 'queue'
  $failedDir = Join-Path $InstallDir 'failed'
  $logDir = Join-Path $InstallDir 'logs'

  [ordered]@{
    schemaVersion = 1; baseUrl = $BaseUrl.TrimEnd('/'); perUserProfiles = $true; bootstrapFile = $secretPath
    secretFile = $secretPath; stateDir = $stateDir; queueDir = $queueDir; failedDir = $failedDir; logDir = $logDir
    sampleIntervalSeconds = 2; heartbeatIntervalSeconds = 60; uploadIntervalSeconds = 30
    openCheckpointUploadIntervalSeconds = $OpenCheckpointUploadIntervalSeconds
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

  foreach ($tool in @('Uninstall-RealtimeHoursV2.ps1', 'Collect-RealtimeHoursV2Diagnostics.ps1', 'Sessions-RealtimeHoursV2.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $tool) -Destination (Join-Path $InstallDir $tool) -Force
  }

  $hostManifest = Join-Path $InstallDir "$HostName.json"
  [ordered]@{
    name = $HostName; description = 'Central Operacional Realtime Hours V2'; path = $nativeTarget
    type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/")
  } | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Utf8NoBom -Path $hostManifest -Content $_ }

  Set-InstallPermissions -SecretPath $secretPath

  foreach ($registryPath in @(
    "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName"
  )) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $hostManifest
  }
  Set-ExtensionPolicy -BrowserPath 'HKLM:\SOFTWARE\Policies\Google\Chrome'
  Set-ExtensionPolicy -BrowserPath 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'

  Register-RealtimeSessionTask -TaskName $TaskName -Exe $exeTarget -InstallDir $InstallDir | Out-Null
  Start-RealtimeSessionTask -TaskName $TaskName -SessionId $session.SessionId | Out-Null
  $statusPath = Join-Path $session.ProfileRoot 'agent-status.json'
  $confirmed = $false
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(55)
  do {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $statusPath) {
      try {
        $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        $confirmed = $status.agentVersion -eq $ExpectedVersion -and $status.windowsUser -eq $windowsUser -and $status.sessionId -eq $session.SessionId -and $status.credentialOk -and ([DateTimeOffset]::Parse([string]$status.lastSampleAt) -ge $installStarted) -and ([DateTimeOffset]::Parse([string]$status.lastHeartbeatAckAt) -ge $installStarted)
      } catch { $confirmed = $false }
    }
  } until ($confirmed -or [DateTimeOffset]::UtcNow -ge $deadline)
  if (-not $confirmed) { throw 'O agente nao confirmou o envio na sessao ativa. Verifique a conexao e tente novamente.' }

  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    [string]$_.ExecutablePath -ieq $exeTarget -and [string]$_.CommandLine -match '(?i)-mode\s+daemon'
  })
  $remainingTasks = @(Get-RelatedTasks)
  if ($remainingTasks.Count -ne 1 -or $remainingTasks[0].TaskName -ne $TaskName) {
    throw "Era esperada exatamente uma tarefa V2; encontrado: $($remainingTasks.Count)."
  }
  if ($processes.Count -eq 1 -and ($processes[0].SessionId -ne $session.SessionId -or $processes[0].ProcessId -ne $status.pid)) { throw "O agente iniciou fora da sessao interativa esperada." }
  if ($processes.Count -ne 1) { throw "Era esperado exatamente um processo daemon, encontrado: $($processes.Count)." }

  if ($EnrollmentFile) { Remove-Item -LiteralPath $EnrollmentFile -Force -ErrorAction Stop }
  $enrollment = $null

  # Backups are retained for the pilot so an operator can inspect recovery.
  # Do not let nonessential cleanup turn a completed activation into a rollback.
  $uninstallKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\CentralOperacionalRealtimeHoursV2'
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'Central Operacional - Realtime Hours V2 (Homologacao)' -PropertyType String -Force | Out-Null
  $uninstallCommand = '"{0}\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "{1}\Uninstall-RealtimeHoursV2.ps1"' -f $env:SystemRoot, $InstallDir
  New-ItemProperty -Path $uninstallKey -Name UninstallString -Value $uninstallCommand -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value $ExpectedVersion -PropertyType String -Force | Out-Null
  Remove-Item -LiteralPath $TaskBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Instalacao concluida. Reinicie Chrome e Edge para carregar a politica da extensao." -ForegroundColor Green
}
catch {
  $installationError = $_
  Write-Warning $installationError.Exception.Message
  if ($LocalMutationStarted) {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Stop-RelatedProcesses } catch {}
  }
  if ($CreatedFinalInstall -and (Test-Path -LiteralPath $profileConfig)) {
    try {
      $profile = Get-Content -LiteralPath $profileConfig -Raw | ConvertFrom-Json
      if ($null -ne $profile.PSObject.Properties['enrolledAt'] -and [DateTimeOffset]::Parse([string]$profile.enrolledAt) -ge $installStarted) {
        Register-RealtimeSessionTask -TaskName $TaskName -Exe $exeTarget -InstallDir $InstallDir -Mode rollback | Out-Null
        $rollback = Start-RealtimeSessionTask -TaskName $TaskName -SessionId $session.SessionId
        $rollbackDeadline = [DateTimeOffset]::UtcNow.AddSeconds(35)
        while ($rollback.State -eq 4 -and [DateTimeOffset]::UtcNow -lt $rollbackDeadline) { Start-Sleep -Seconds 1; $rollback.Refresh() }
        $task = Get-ScheduledTaskInfo -TaskName $TaskName
        if ($rollback.State -eq 4 -or $task.LastTaskResult -ne 0) { throw 'Rollback da credencial individual nao foi confirmado.' }
        Remove-Item -LiteralPath $profileConfig, ([string]$profile.secretFile) -Force -ErrorAction Stop
      }
    } catch { Write-Warning "Rollback remoto pendente: $($_.Exception.Message)" }
  }
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
  try { Restore-RegistryArtifacts } catch { Write-Warning "Falha ao restaurar registro: $($_.Exception.Message)" }
  try { Restore-LegacyPersistence } catch { Write-Warning "Falha ao restaurar inicio automatico: $($_.Exception.Message)" }
  Restore-Tasks
  throw $installationError
}
finally {
  $EnrollmentCode = $null
  $enrollment = $null
    if ($null -ne $secretBytes) { [Array]::Clear($secretBytes, 0, $secretBytes.Length) }
    Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $versionOutput -Force -ErrorAction SilentlyContinue
}
