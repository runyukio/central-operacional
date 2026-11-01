[CmdletBinding()]
param(
  [string]$InstallDir = "$env:ProgramData\CentralOperacional\RealtimeHoursV2",
  [string]$OutputPath = "$env:PUBLIC\Desktop\RealtimeHoursV2-Diagnostico.json"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskName = 'Central Operacional - Realtime Hours V2'
$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '(?i)Central Operacional.*Realtime Hours' })
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  [string]$_.ExecutablePath -ieq (Join-Path $InstallDir 'RealtimeHoursAgentV2.exe') -and [string]$_.CommandLine -match '(?i)-mode\s+daemon'
})
$diagnostic = $null
$session = $null
$profileConfig = Join-Path $InstallDir 'config.json'
$stateDirectory = Join-Path $InstallDir 'browser-state'
$machineConfig = Get-Content -LiteralPath $profileConfig -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
if ($null -ne $machineConfig -and $null -ne $machineConfig.PSObject.Properties['perUserProfiles'] -and $machineConfig.perUserProfiles) {
  . (Join-Path $InstallDir 'Sessions-RealtimeHoursV2.ps1')
  $session = Get-RealtimeInteractiveSession
  $profileConfig = Join-Path $session.ProfileRoot 'config.json'
  $stateDirectory = Join-Path $session.ProfileRoot ('browser-state\' + $session.SessionId)
  $statusPath = Join-Path $session.ProfileRoot 'agent-status.json'
  if (Test-Path -LiteralPath (Join-Path $session.ProfileRoot 'bootstrap-status.json')) { $diagnostic = Get-Content -LiteralPath (Join-Path $session.ProfileRoot 'bootstrap-status.json') -Raw | ConvertFrom-Json }
  if (Test-Path -LiteralPath $statusPath) { $diagnostic = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json; $diagnostic | Add-Member -NotePropertyName diagnosticMode -NotePropertyValue 'session-status'; $diagnostic | Add-Member -NotePropertyName success -NotePropertyValue $true }
}
$tempFile = Join-Path $env:TEMP ('rh-v2-diagnose-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  $exe = Join-Path $InstallDir 'RealtimeHoursAgentV2.exe'
  $config = $profileConfig
  $callerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $config) -and ($null -eq $session -or $callerSid -eq $session.Sid)) {
    $arguments = '-mode diagnose -config "{0}" -output "{1}"' -f $config, $tempFile
    $p = Start-Process -FilePath $exe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -eq 0 -and (Test-Path -LiteralPath $tempFile)) { $diagnostic = Get-Content -LiteralPath $tempFile -Raw | ConvertFrom-Json }
  }
  $states = @()
  foreach ($browser in @('chrome', 'msedge')) {
    $stateFile = Join-Path $stateDirectory "browser-state-$browser.json"
    if (Test-Path -LiteralPath $stateFile) {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      $states += [pscustomobject]@{ browser = $browser; capturedAt = $state.capturedAt; domain = $state.domain; focused = $state.focused }
    }
  }
  [ordered]@{
    capturedAt = [DateTime]::UtcNow.ToString('o'); computer = $env:COMPUTERNAME
    daemonCount = $processes.Count; taskCount = $tasks.Count
    tasks = @($tasks | ForEach-Object { [pscustomobject]@{ name = $_.TaskName; state = [string]$_.State; principalGroup = [string]$_.Principal.GroupId; principalUser = [string]$_.Principal.UserId; multipleInstances = [string]$_.Settings.MultipleInstances } })
    session = $session
    daemonSessions = @($processes | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; sessionId = $_.SessionId } })
    agent = $diagnostic; browserStates = $states
    acceptance = 'Pilot evidence only. Clean install, upgrade, reboot, Chrome, Edge, offline and uninstall require Windows execution.'
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  Write-Host "Diagnostico salvo em: $OutputPath"
} finally { Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue }
