<# Installs or upgrades the Central Operacional workstation agent. #>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CloudUrl,
  [Parameter(Mandatory = $true)][string]$CloudToken,
  [string]$WbLogin = "",
  [string]$EmployeeId = "",
  [ValidateRange(120, 900)][int]$HeartbeatSeconds = 120,
  [ValidateRange(60, 3600)][int]$ActiveThresholdSeconds = 300,
  [ValidateRange(3, 30)][int]$ActivitySampleSeconds = 5,
  [ValidateRange(30, 600)][int]$ActivityUploadSeconds = 60,
  [ValidateRange(300, 86400)][int]$ActivityMaxSegmentSeconds = 3600,
  [bool]$ActivityEnabled = $true,
  [bool]$CaptureDomains = $true,
  [ValidateSet("HIGH", "MEDIUM", "LOW", "UNKNOWN")][string]$IdentityConfidence = "MEDIUM",
  [string]$IdentitySource = "windows_user",
  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent"),
  [switch]$RunNow,
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$AgentVersion = "0.4.0"
$TaskName = "Central Operacional - Realtime Hours Agent"

function Write-InstallMessage { param([string]$Message); if (-not $Silent) { Write-Host $Message } }
function Assert-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Execute este instalador como Administrador." }
}
function Normalize-Login {
  param([string]$Value)
  $candidate = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return "" }
  if ($candidate.Contains("\")) { $candidate = $candidate.Split("\")[-1] }
  return $candidate.ToLowerInvariant()
}
function Protect-AgentToken {
  param([string]$Token)
  Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($Token)
  $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
    $plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  return [Convert]::ToBase64String($encryptedBytes)
}
function Set-AgentPermissions {
  param([string]$Path)
  try {
    & icacls.exe $Path /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" | Out-Null
    foreach ($writable in @("queue", "failed", "logs")) {
      $writablePath = Join-Path $Path $writable
      & icacls.exe $writablePath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)M" | Out-Null
    }
  } catch { Write-InstallMessage ("Aviso: nao foi possivel aplicar todas as permissoes. {0}" -f $_.Exception.Message) }
}

Assert-Administrator
if ([string]::IsNullOrWhiteSpace($CloudUrl) -or [string]::IsNullOrWhiteSpace($CloudToken)) { throw "Informe CloudUrl e CloudToken." }
if ($CloudToken -match "(?i)(trocar|colocar|substituir|token_aqui|placeholder)") { throw "Substitua o token de exemplo antes de instalar." }

$sourceAgent = Join-Path $PSScriptRoot "RealtimeHoursAgent.ps1"
if (-not (Test-Path $sourceAgent)) { throw "RealtimeHoursAgent.ps1 nao encontrado." }
foreach ($folder in @($InstallDir, (Join-Path $InstallDir "queue"), (Join-Path $InstallDir "queue\activity"), (Join-Path $InstallDir "failed"), (Join-Path $InstallDir "failed\activity"), (Join-Path $InstallDir "logs"))) {
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
}

$targetAgent = Join-Path $InstallDir "RealtimeHoursAgent.ps1"
Copy-Item -Path $sourceAgent -Destination $targetAgent -Force
$configPath = Join-Path $InstallDir "config.json"
[ordered]@{
  cloudUrl = $CloudUrl.TrimEnd("/")
  cloudTokenProtected = Protect-AgentToken -Token $CloudToken
  deliveryMode = "CLOUD"
  wbLogin = Normalize-Login -Value $WbLogin
  employeeId = $EmployeeId.Trim()
  heartbeatSeconds = $HeartbeatSeconds
  activeThresholdSeconds = $ActiveThresholdSeconds
  activityEnabled = [bool]$ActivityEnabled
  captureDomains = [bool]$CaptureDomains
  activitySampleSeconds = $ActivitySampleSeconds
  activityUploadSeconds = $ActivityUploadSeconds
  activityMaxSegmentSeconds = $ActivityMaxSegmentSeconds
  identitySource = $IdentitySource
  identityConfidence = $IdentityConfidence
  captureActiveWindow = $false
  agentVersion = $AgentVersion
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 8 | Set-Content -Path $configPath -Encoding UTF8
Set-AgentPermissions -Path $InstallDir

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

$daemonArgs = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Daemon"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $daemonArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
if ($RunNow) { Start-ScheduledTask -TaskName $TaskName; Start-Sleep -Seconds 2 }

$installedTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ($installedTask.State -eq "Disabled") { throw "A tarefa foi criada, mas esta desabilitada." }
Write-InstallMessage ("Agent {0} instalado com sucesso." -f $AgentVersion)
