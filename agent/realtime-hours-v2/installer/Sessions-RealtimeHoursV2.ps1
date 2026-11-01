function Get-RealtimeInteractiveSession {
  if (-not ('RealtimeHoursV2SessionInfo' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RealtimeHoursV2SessionInfo {
  [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool WTSQuerySessionInformation(IntPtr server, int session, int info, out IntPtr buffer, out int bytes);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
  public static string Query(int session, int info) {
    IntPtr buffer; int bytes;
    if (!WTSQuerySessionInformation(IntPtr.Zero, session, info, out buffer, out bytes)) return "";
    try { return Marshal.PtrToStringUni(buffer) ?? ""; } finally { WTSFreeMemory(buffer); }
  }
}
'@
  }
  $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $name = [RealtimeHoursV2SessionInfo]::Query($sessionId, 5)
  $domain = [RealtimeHoursV2SessionInfo]::Query($sessionId, 7)
  if ($sessionId -le 0 -or [string]::IsNullOrWhiteSpace($name)) { throw 'Entre em uma sessao Windows para instalar.' }
  $account = if ($domain) { "$domain\$name" } else { $name }
  $sid = ([Security.Principal.NTAccount]::new($account)).Translate([Security.Principal.SecurityIdentifier]).Value
  $profile = Get-RealtimeProfileRoot -Sid $sid
  return [pscustomobject]@{ Account = $account; WindowsUser = $name.ToLowerInvariant(); Sid = $sid; SessionId = $sessionId; ProfileRoot = $profile }
}

function Get-RealtimeProfileRoot {
  param([string]$Sid)
  $folder = Get-ItemProperty -LiteralPath "Registry::HKEY_USERS\$Sid\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" -ErrorAction SilentlyContinue
  if ($null -ne $folder -and $null -ne $folder.PSObject.Properties['Local AppData']) { $local = [string]$folder.'Local AppData' }
  else {
    $profile = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$Sid" -ErrorAction Stop
    $local = Join-Path ([Environment]::ExpandEnvironmentVariables([string]$profile.ProfileImagePath)) 'AppData\Local'
  }
  return Join-Path $local 'CentralOperacional\RealtimeHoursV2'
}

function Register-RealtimeSessionTask {
  param([string]$TaskName, [string]$Exe, [string]$InstallDir, [ValidateSet('daemon','rollback')][string]$Mode = 'daemon')
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $definition = $service.NewTask(0)
  $definition.RegistrationInfo.Description = 'Central Operacional Realtime Hours V2 - sessao interativa ativa'
  $definition.Principal.GroupId = 'S-1-5-4'
  $definition.Principal.LogonType = 4 # TASK_LOGON_GROUP
  $definition.Principal.RunLevel = 0
  $definition.Settings.Enabled = $true
  $definition.Settings.AllowDemandStart = $true
  $definition.Settings.DisallowStartIfOnBatteries = $false
  $definition.Settings.StopIfGoingOnBatteries = $false
  $definition.Settings.StartWhenAvailable = $true
  $definition.Settings.ExecutionTimeLimit = 'PT0S'
  $definition.Settings.MultipleInstances = 3 # StopExisting: one collector across users.
  $definition.Settings.RestartCount = 999
  $definition.Settings.RestartInterval = 'PT1M'
  if ($Mode -eq 'daemon') {
    $logon = $definition.Triggers.Create(9)
    $logon.Enabled = $true; $logon.Delay = 'PT2S'
    foreach ($change in @(1, 3, 8)) { # ConsoleConnect, RemoteConnect, SessionUnlock.
      $trigger = $definition.Triggers.Create(11)
      $trigger.StateChange = $change; $trigger.Enabled = $true; $trigger.Delay = 'PT2S'
    }
  }
  $action = $definition.Actions.Create(0)
  $action.Path = $Exe
  $action.Arguments = '-mode {0} -config "{1}"' -f $Mode, (Join-Path $InstallDir 'config.json')
  $action.WorkingDirectory = $InstallDir
  return $service.GetFolder('\').RegisterTaskDefinition($TaskName, $definition, 6, 'S-1-5-4', $null, 4, $null)
}

function Start-RealtimeSessionTask {
  param([string]$TaskName, [int]$SessionId)
  $service = New-Object -ComObject 'Schedule.Service'; $service.Connect()
  return $service.GetFolder('\').GetTask($TaskName).RunEx($null, 4, $SessionId, $null)
}

function Set-RealtimeProfilePermissions {
  param([string]$Root, [string]$Sid)
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  & "$env:SystemRoot\System32\icacls.exe" $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${Sid}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger os dados individuais do usuario.' }
}

function Migrate-RealtimeLegacyProfile {
  param([string]$InstallDir, [string]$TaskName, [string]$PrincipalUser)
  $source = Join-Path $InstallDir 'config.json'
  if (-not (Test-Path -LiteralPath $source)) { return }
  $old = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
  if ($null -ne $old.PSObject.Properties['perUserProfiles'] -and $old.perUserProfiles) { return }
  if ([string]::IsNullOrWhiteSpace($PrincipalUser)) { throw 'Nao foi possivel identificar o proprietario da fila antiga; dados preservados.' }
  $account = $PrincipalUser
  $sid = if ($account -match '^S-1-') { $account } else { ([Security.Principal.NTAccount]::new($account)).Translate([Security.Principal.SecurityIdentifier]).Value }
  $root = Get-RealtimeProfileRoot -Sid $sid
  $target = Join-Path $root 'config.json'
  if (Test-Path -LiteralPath $target) { return }
  Set-RealtimeProfilePermissions -Root $root -Sid $sid
  foreach ($name in @('queue', 'failed', 'logs')) {
    $directory = Join-Path $InstallDir $name
    if (Test-Path -LiteralPath $directory) { Copy-Item -LiteralPath $directory -Destination (Join-Path $root $name) -Recurse -Force }
  }
  Copy-Item -LiteralPath ([string]$old.secretFile) -Destination (Join-Path $root 'device-secret.dpapi') -Force
  $old.secretFile = Join-Path $root 'device-secret.dpapi'
  $old.stateDir = Join-Path $root 'browser-state\0'
  $old.queueDir = Join-Path $root 'queue'; $old.failedDir = Join-Path $root 'failed'; $old.logDir = Join-Path $root 'logs'
  $old.heartbeatIntervalSeconds = 60; $old.uploadIntervalSeconds = 30
  $old | Add-Member -NotePropertyName statusFile -NotePropertyValue (Join-Path $root 'agent-status.json') -Force
  $old | ConvertTo-Json -Depth 5 | ForEach-Object { [IO.File]::WriteAllText($target, $_, [Text.UTF8Encoding]::new($false)) }
}
