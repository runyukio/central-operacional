[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$PackageDir = $PSScriptRoot,
  [string]$InstallDir = "$env:ProgramData\CentralOperacional\RealtimeHoursV2"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ExpectedVersion = '1.0.0-alpha.3'
$TaskName = 'Central Operacional - Realtime Hours V2'

function Read-UpdateManifest {
  $release = Get-Content -LiteralPath (Join-Path $PackageDir 'update-release.json') -Raw | ConvertFrom-Json
  if ($release.schemaVersion -ne 1 -or $release.kind -ne 'realtime-hours-v2-update' -or $release.agentVersion -ne $ExpectedVersion) {
    throw 'Manifesto de atualizacao invalido.'
  }
  foreach ($name in @('RealtimeHoursAgentV2.exe', 'Sessions-RealtimeHoursV2.ps1', 'Update-RealtimeHoursV2.ps1')) {
    if ($null -eq $release.files.PSObject.Properties[$name]) { throw "Arquivo ausente no manifesto: $name" }
  }
  foreach ($file in $release.files.PSObject.Properties) {
    if ($file.Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or [string]$file.Value -notmatch '^[0-9a-fA-F]{64}$') {
      throw 'Entrada de hash invalida no manifesto.'
    }
    if ((Get-FileHash -LiteralPath (Join-Path $PackageDir $file.Name) -Algorithm SHA256).Hash -ine [string]$file.Value) {
      throw "Arquivo corrompido: $($file.Name)"
    }
  }
  $policy = $release.activityUploadPolicy
  if ($policy.sampleIntervalSeconds -ne 2 -or $policy.heartbeatIntervalSeconds -ne 60 -or
      $policy.uploadIntervalSeconds -ne 30 -or $policy.openCheckpointUploadIntervalSeconds -ne 240) {
    throw 'A politica do pacote difere da configuracao aprovada.'
  }
  return $release
}

function Invoke-VersionProbe {
  param([string]$Exe, [string]$OutputPath)
  $arguments = '-mode version -output "{0}"' -f $OutputPath
  $process = Start-Process -FilePath $Exe -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw 'O executavel nao confirmou a versao.' }
  return (Get-Content -LiteralPath $OutputPath -Raw).Trim()
}

function Get-CollectorProcesses {
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    [string]$_.ExecutablePath -ieq $AgentPath -or [string]$_.ExecutablePath -ieq $NativePath
  })
}

function Stop-Collector {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  foreach ($process in @(Get-CollectorProcesses)) {
    # Native Messaging hosts can exit normally between enumeration and stop.
    # The bounded check below still fails if an owned process remains alive.
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
  while (@(Get-CollectorProcesses).Count -gt 0) {
    if ([DateTimeOffset]::UtcNow -ge $deadline) { throw 'O coletor ainda esta em uso. Feche Chrome/Edge e tente novamente.' }
    Start-Sleep -Milliseconds 200
  }
}

function Replace-LocalFile {
  param([string]$Stage, [string]$Target)
  # Stage and target are on the same volume. Preserve the original ACL, and
  # atomically replace existing files without publishing a partial executable.
  $acl = Get-Acl -LiteralPath $Target
  Set-Acl -LiteralPath $Stage -AclObject $acl
  [IO.File]::Replace($Stage, $Target, $null)
}

function Protect-UpdateDirectory {
  param([string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existing) }
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      [Security.Principal.SecurityIdentifier]::new($sid),
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

if ($WhatIfPreference) {
  $null = $PSCmdlet.ShouldProcess($InstallDir, 'Atualizar o coletor V2 existente, preservando credenciais e filas')
  return
}
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Esta atualizacao requer Windows de 64 bits.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -PackageDir "{1}" -InstallDir "{2}"' -f $PSCommandPath, $PackageDir, $InstallDir
  $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $child.ExitCode
}

$guard = [Threading.Mutex]::new($false, 'Global\CentralOperacionalRealtimeHoursV2Installer')
$locked = $false
$changed = $false
$backupReady = $false
$StageDir = $null
$BackupDir = $null
$versionOutput = Join-Path $env:TEMP ("RealtimeHoursV2-update-version-" + [guid]::NewGuid().ToString('N') + '.txt')
try {
  try { $locked = $guard.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Ja existe uma instalacao ou atualizacao em andamento.' }
  $release = Read-UpdateManifest

  $AgentPath = Join-Path $InstallDir 'RealtimeHoursAgentV2.exe'
  $NativePath = Join-Path $InstallDir 'RealtimeHoursNativeHostV2.exe'
  $ConfigPath = Join-Path $InstallDir 'config.json'
  $MetadataPath = Join-Path $InstallDir 'install-metadata.json'
  foreach ($path in @($AgentPath, $NativePath, $ConfigPath, $MetadataPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Instalacao V2 existente nao encontrada. Use o instalador corporativo para novas instalacoes.' }
  }
  $configuration = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if ($null -eq $configuration.PSObject.Properties['perUserProfiles'] -or -not $configuration.perUserProfiles) {
    throw 'Este kit atualiza apenas a instalacao V2 por perfil Windows; a instalacao legada requer revisao de TI.'
  }
  if ($configuration.sampleIntervalSeconds -ne 2 -or $configuration.heartbeatIntervalSeconds -ne 60 -or
      $configuration.uploadIntervalSeconds -ne 30) {
    throw 'As cadencias existentes diferem de 2/60/30 segundos. Nenhuma mudanca foi aplicada; revise a configuracao com TI.'
  }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or [string]$actions[0].Execute -ine $AgentPath -or
      [string]$actions[0].Arguments -notmatch '(?i)-mode\s+daemon' -or $task.State -ne 'Running') {
    throw 'A tarefa ativa nao corresponde ao coletor instalado. Nenhuma mudanca foi aplicada; revise a instalacao com TI.'
  }
  $suffix = [guid]::NewGuid().ToString('N')
  $StageDir = Join-Path $InstallDir ('.update-stage.' + $suffix)
  New-Item -ItemType Directory -Path $StageDir | Out-Null
  Protect-UpdateDirectory -Path $StageDir
  # Verify again after copying into an administrator/SYSTEM-only directory.
  # Do not execute a helper or candidate binary from a user-writable package.
  foreach ($name in @('RealtimeHoursAgentV2.exe', 'Sessions-RealtimeHoursV2.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PackageDir $name) -Destination (Join-Path $StageDir $name) -Force
    if ((Get-FileHash -LiteralPath (Join-Path $StageDir $name) -Algorithm SHA256).Hash -ine [string]$release.files.PSObject.Properties[$name].Value) {
      throw 'O arquivo preparado nao passou na verificacao de integridade.'
    }
  }
  . (Join-Path $StageDir 'Sessions-RealtimeHoursV2.ps1')
  $session = Get-RealtimeInteractiveSession
  $profilePath = Join-Path $session.ProfileRoot 'config.json'
  if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) { throw 'Entre em um perfil que ja use o coletor V2. Este kit nao cadastra novos perfis.' }
  $profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
  if ([string]$profile.windowsUser -ine $session.WindowsUser -or
      -not (Test-Path -LiteralPath ([string]$profile.secretFile) -PathType Leaf)) {
    throw 'A credencial do perfil existente nao foi encontrada. Nenhum cadastro novo sera criado.'
  }
  $candidate = Join-Path $StageDir 'RealtimeHoursAgentV2.exe'
  if (-not $PSCmdlet.ShouldProcess($InstallDir, 'Aplicar alpha.3 e checkpoint de 240 segundos, preservando a tarefa e as credenciais')) { return }
  if ((Invoke-VersionProbe -Exe $candidate -OutputPath $versionOutput) -ne $ExpectedVersion) { throw 'Versao inesperada do executavel de atualizacao.' }

  $BackupDir = Join-Path $InstallDir ('.update-backup.' + $suffix)
  New-Item -ItemType Directory -Path $BackupDir | Out-Null
  Protect-UpdateDirectory -Path $BackupDir
  # No credential, DPAPI authorization, profile or queue file is copied.
  $backupNames = @('RealtimeHoursAgentV2.exe', 'RealtimeHoursNativeHostV2.exe', 'config.json', 'install-metadata.json')
  foreach ($name in $backupNames) {
    Copy-Item -LiteralPath (Join-Path $InstallDir $name) -Destination (Join-Path $BackupDir $name) -Force
  }
  $backupReady = $true
  foreach ($name in @('RealtimeHoursAgentV2.exe', 'RealtimeHoursNativeHostV2.exe')) {
    if ($name -ne 'RealtimeHoursAgentV2.exe') { Copy-Item -LiteralPath $candidate -Destination (Join-Path $StageDir $name) -Force }
    if ((Get-FileHash -LiteralPath (Join-Path $StageDir $name) -Algorithm SHA256).Hash -ine [string]$release.files.'RealtimeHoursAgentV2.exe') {
      throw 'O executavel preparado nao passou na verificacao de integridade.'
    }
  }

  $configuration | Add-Member -NotePropertyName openCheckpointUploadIntervalSeconds -NotePropertyValue 240 -Force
  $metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
  $metadata | Add-Member -NotePropertyName installedVersion -NotePropertyValue $ExpectedVersion -Force
  $metadata | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
  foreach ($entry in @(@{ Name = 'config.json'; Value = $configuration }, @{ Name = 'install-metadata.json'; Value = $metadata })) {
    [IO.File]::WriteAllText((Join-Path $StageDir $entry.Name), (($entry.Value | ConvertTo-Json -Depth 15) + "`n"), [Text.UTF8Encoding]::new($false))
  }
  $updateStarted = [DateTimeOffset]::UtcNow
  $changed = $true
  Stop-Collector
  foreach ($name in $backupNames) {
    Replace-LocalFile -Stage (Join-Path $StageDir $name) -Target (Join-Path $InstallDir $name)
  }
  Start-RealtimeSessionTask -TaskName $TaskName -SessionId $session.SessionId | Out-Null

  $statusPath = Join-Path $session.ProfileRoot 'agent-status.json'
  $confirmed = $false
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(65)
  do {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
      try {
        $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        $confirmed = $status.agentVersion -eq $ExpectedVersion -and $status.windowsUser -eq $session.WindowsUser -and
          $status.sessionId -eq $session.SessionId -and $status.credentialOk -and
          $status.sampleIntervalSeconds -eq 2 -and $status.heartbeatIntervalSeconds -eq 60 -and
          $status.uploadIntervalSeconds -eq 30 -and $status.openCheckpointUploadIntervalSeconds -eq 240 -and
          ([DateTimeOffset]::Parse([string]$status.lastSampleAt) -ge $updateStarted) -and
          ([DateTimeOffset]::Parse([string]$status.lastHeartbeatAckAt) -ge $updateStarted)
      } catch { $confirmed = $false }
    }
  } until ($confirmed -or [DateTimeOffset]::UtcNow -ge $deadline)
  if (-not $confirmed) { throw 'O coletor atualizado nao confirmou a versao, politica e presenca na sessao ativa.' }
  $daemons = @(Get-CollectorProcesses | Where-Object {
    [string]$_.ExecutablePath -ieq $AgentPath -and [string]$_.CommandLine -match '(?i)-mode\s+daemon'
  })
  if ($daemons.Count -ne 1 -or $daemons[0].ProcessId -ne $status.pid) { throw 'Nao foi confirmado exatamente um coletor atualizado.' }
  Write-Host 'Atualizacao concluida. Credenciais e filas existentes foram preservadas.' -ForegroundColor Green
  Write-Host ("Backup local para retorno: " + $BackupDir)
}
catch {
  $failure = $_
  if ($changed -and $backupReady) {
    Write-Warning 'A atualizacao nao foi confirmada. Restaurando os arquivos anteriores.'
    $restored = $false
    try {
      Stop-Collector
      foreach ($name in @('RealtimeHoursAgentV2.exe', 'RealtimeHoursNativeHostV2.exe', 'config.json', 'install-metadata.json')) {
        $restore = Join-Path $InstallDir ($name + '.restore.' + [guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath (Join-Path $BackupDir $name) -Destination $restore -Force
        Replace-LocalFile -Stage $restore -Target (Join-Path $InstallDir $name)
      }
      $restored = $true
    } catch {
      Write-Warning ("Retorno automatico pendente. O backup local foi preservado: " + $BackupDir)
    }
    finally {
      # Even a failed restoration must not silently leave the collector paused.
      try {
        Start-RealtimeSessionTask -TaskName $TaskName -SessionId $session.SessionId | Out-Null
        if ($restored) { Write-Warning 'Arquivos anteriores restaurados e tarefa reiniciada. Confirme a presenca antes de tentar novamente.' }
      } catch {
        Write-Warning ('A tarefa nao reiniciou. Acione TI com o backup local: ' + $BackupDir)
      }
    }
  }
  throw $failure
}
finally {
  if ($null -ne $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $versionOutput -Force -ErrorAction SilentlyContinue
  if ($locked) { $guard.ReleaseMutex() }
  $guard.Dispose()
}

