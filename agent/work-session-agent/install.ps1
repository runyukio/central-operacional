<#
Installs Central Operacional Work Session Agent as a Windows background task.

Run in PowerShell as Administrator:
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -ApiBaseUrl "https://seu-site.vercel.app" -EnrollmentKey "SUA_CHAVE"
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$EnrollmentKey,

  [string]$WbLogin = $env:USERNAME,

  [int]$HeartbeatSeconds = 60,

  [int]$SleepDetectSeconds = 300,

  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\WorkSessionAgent")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AgentVersion = "0.1.0"
$TaskName = "Central Operacional - WorkSession Agent"
$LockTaskName = "Central Operacional - WorkSession Lock"
$UnlockTaskName = "Central Operacional - WorkSession Unlock"
$LogoutTaskName = "Central Operacional - WorkSession Logout"
$ShutdownTaskName = "Central Operacional - WorkSession Shutdown"

function Assert-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este instalador como Administrador."
  }
}

function Normalize-WbLogin {
  param([string]$Value)
  $candidate = $Value.Trim()
  if ($candidate.Contains("\")) {
    $candidate = $candidate.Split("\")[-1]
  }
  return $candidate.ToLowerInvariant()
}

Assert-Administrator

$sourceAgent = Join-Path $PSScriptRoot "WorkSessionAgent.ps1"
if (-not (Test-Path $sourceAgent)) {
  throw "WorkSessionAgent.ps1 nao encontrado na pasta do instalador."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "queue") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "logs") -Force | Out-Null

$targetAgent = Join-Path $InstallDir "WorkSessionAgent.ps1"
Copy-Item -Path $sourceAgent -Destination $targetAgent -Force

$configPath = Join-Path $InstallDir "config.json"
$config = [ordered]@{
  apiBaseUrl = $ApiBaseUrl.TrimEnd("/")
  enrollmentKey = $EnrollmentKey
  wbLogin = Normalize-WbLogin -Value $WbLogin
  heartbeatSeconds = $HeartbeatSeconds
  sleepDetectSeconds = $SleepDetectSeconds
  agentVersion = $AgentVersion
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$config | ConvertTo-Json -Depth 8 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "Matriculando dispositivo para WB/Login $($config["wbLogin"])..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $targetAgent -Mode Enroll
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Matricula inicial nao concluida. A tarefa sera instalada e o Agent tentara novamente quando houver internet/API disponivel."
}

Write-Host "Criando tarefa agendada principal..."
$daemonArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Daemon"
$daemonAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $daemonArgs
$daemonTrigger = New-ScheduledTaskTrigger -AtLogOn
$daemonPrincipal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel LeastPrivilege
$daemonSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $daemonAction -Trigger $daemonTrigger -Principal $daemonPrincipal -Settings $daemonSettings -Force | Out-Null

Write-Host "Criando tarefas de lock/unlock quando o Windows registrar eventos 4800/4801..."
$lockCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Event -EventType LOCK"
$unlockCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Event -EventType UNLOCK"
$logoutCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Event -EventType LOGOUT"
$shutdownCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetAgent`" -Mode Event -EventType SHUTDOWN"
try {
  & schtasks.exe /Create /TN $LockTaskName /SC ONEVENT /EC Security /MO "*[System[(EventID=4800)]]" /TR $lockCommand /F | Out-Null
  & schtasks.exe /Create /TN $UnlockTaskName /SC ONEVENT /EC Security /MO "*[System[(EventID=4801)]]" /TR $unlockCommand /F | Out-Null
  & schtasks.exe /Create /TN $LogoutTaskName /SC ONEVENT /EC Security /MO "*[System[(EventID=4647)]]" /TR $logoutCommand /F | Out-Null
  & schtasks.exe /Create /TN $ShutdownTaskName /SC ONEVENT /EC System /MO "*[System[(EventID=1074)]]" /TR $shutdownCommand /F | Out-Null
} catch {
  Write-Warning "Nao foi possivel criar todas as tarefas por evento. O heartbeat continuara funcionando. Detalhe: $($_.Exception.Message)"
}

Write-Host "Iniciando Agent..."
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Instalacao concluida."
Write-Host "Config: $configPath"
Write-Host "Logs:   $(Join-Path $InstallDir "logs\agent.log")"
Write-Host "Fila:   $(Join-Path $InstallDir "queue")"
Write-Host ""
Write-Host "Observacao: eventos de lock/unlock/logout dependem dos eventos de seguranca 4800/4801/4647 estarem habilitados no Windows."
