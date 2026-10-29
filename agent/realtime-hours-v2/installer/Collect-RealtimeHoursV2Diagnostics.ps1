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
$tempFile = Join-Path $env:TEMP ('rh-v2-diagnose-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  $exe = Join-Path $InstallDir 'RealtimeHoursAgentV2.exe'
  $config = Join-Path $InstallDir 'config.json'
  if (Test-Path -LiteralPath $exe) {
    $arguments = '-mode diagnose -config "{0}" -output "{1}"' -f $config, $tempFile
    $p = Start-Process -FilePath $exe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -eq 0 -and (Test-Path -LiteralPath $tempFile)) { $diagnostic = Get-Content -LiteralPath $tempFile -Raw | ConvertFrom-Json }
  }
  $states = @()
  foreach ($browser in @('chrome', 'msedge')) {
    $stateFile = Join-Path $InstallDir "browser-state\browser-state-$browser.json"
    if (Test-Path -LiteralPath $stateFile) {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      $states += [pscustomobject]@{ browser = $browser; capturedAt = $state.capturedAt; domain = $state.domain; focused = $state.focused }
    }
  }
  [ordered]@{
    capturedAt = [DateTime]::UtcNow.ToString('o'); computer = $env:COMPUTERNAME
    daemonCount = $processes.Count; taskCount = $tasks.Count
    tasks = @($tasks | ForEach-Object { [pscustomobject]@{ name = $_.TaskName; state = [string]$_.State } })
    agent = $diagnostic; browserStates = $states
    acceptance = 'Pilot evidence only. Clean install, upgrade, reboot, Chrome, Edge, offline and uninstall require Windows execution.'
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  Write-Host "Diagnostico salvo em: $OutputPath"
} finally { Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue }
