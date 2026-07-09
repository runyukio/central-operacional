<#
Installs the Realtime Hours workstation agent.

Run as Administrator on each operation PC:
  powershell -ExecutionPolicy Bypass -File .\install-workstation-task.ps1 `
    -ServerUrl "http://IP_DO_SERVIDOR:8787" `
    -LocalToken "TOKEN_DA_REDE_LOCAL"
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$LocalToken,

  [string]$WbLogin = "",

  [string]$EmployeeId = "",

  [int]$HeartbeatSeconds = 60,

  [int]$ActiveThresholdSeconds = 300,

  [ValidateSet("HIGH", "MEDIUM", "LOW", "UNKNOWN")]
  [string]$IdentityConfidence = "MEDIUM",

  [string]$IdentitySource = "windows_user",

  [switch]$CaptureActiveWindow,

  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent"),

  [switch]$RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AgentVersion = "0.1.0"
$TaskName = "Central Operacional - Realtime Hours Agent"

function Assert-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este instalador como Administrador."
  }
}

function Normalize-Login {
  param([string]$Value)
  $candidate = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    return ""
  }
  if ($candidate.Contains("\")) {
    $candidate = $candidate.Split("\")[-1]
  }
  return $candidate.ToLowerInvariant()
}

Assert-Administrator

$sourceAgent = Join-Path $PSScriptRoot "RealtimeHoursAgent.ps1"
if (-not (Test-Path $sourceAgent)) {
  throw "RealtimeHoursAgent.ps1 nao encontrado na pasta do instalador."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "queue") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "logs") -Force | Out-Null

$targetAgent = Join-Path $InstallDir "RealtimeHoursAgent.ps1"
Copy-Item -Path $sourceAgent -Destination $targetAgent -Force

$configPath = Join-Path $InstallDir "config.json"
$config = [ordered]@{
  serverUrl = $ServerUrl.TrimEnd("/")
  localToken = $LocalToken
  wbLogin = Normalize-Login -Value $WbLogin
  employeeId = $EmployeeId
  heartbeatSeconds = $HeartbeatSeconds
  activeThresholdSeconds = $ActiveThresholdSeconds
  identitySource = $IdentitySource
  identityConfidence = $IdentityConfidence
  captureActiveWindow = [bool]$CaptureActiveWindow
  agentVersion = $AgentVersion
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$config | ConvertTo-Json -Depth 8 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "Criando tarefa agendada do Agent..."
$daemonArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Daemon"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $daemonArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

if ($RunNow) {
  Write-Host "Iniciando Agent..."
  Start-ScheduledTask -TaskName $TaskName
} else {
  Write-Host "Agent instalado. Ele iniciara no proximo logon. Use -RunNow para iniciar imediatamente."
}

Write-Host ""
Write-Host "Instalacao concluida."
Write-Host "Config: $configPath"
Write-Host "Logs:   $(Join-Path $InstallDir "logs\agent.log")"
Write-Host "Fila:   $(Join-Path $InstallDir "queue")"
Write-Host ""
Write-Host "Teste manual:"
Write-Host "powershell -ExecutionPolicy Bypass -File `"$targetAgent`" -Mode Once"
