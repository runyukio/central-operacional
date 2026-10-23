[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$Root = Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent"
$TaskName = "Central Operacional - Realtime Hours Agent"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host ("=== {0} ===" -f $Title) -ForegroundColor Cyan
}

function Write-Check([bool]$Ok, [string]$Success, [string]$Failure) {
  if ($Ok) { Write-Host ("OK: {0}" -f $Success) -ForegroundColor Green }
  else { Write-Host ("ERRO: {0}" -f $Failure) -ForegroundColor Red }
}

Write-Host "Central Operacional - Diagnostico do Realtime Hours Agent" -ForegroundColor White
Write-Host "Este diagnostico nao exibe o token do agente." -ForegroundColor DarkGray

Write-Section "PASTA E MARCADORES"
Write-Check (Test-Path $Root) $Root "Pasta de instalacao nao encontrada: $Root"

foreach ($file in @("installation-success.txt", "installation-failed.txt")) {
  $path = Join-Path $Root $file
  if (Test-Path $path) {
    Write-Host ""
    Write-Host $file -ForegroundColor Yellow
    Get-Content $path -ErrorAction SilentlyContinue
  }
}

Write-Section "CONFIGURACAO"
$configPath = Join-Path $Root "config.json"
if (Test-Path $configPath) {
  try {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    [PSCustomObject]@{
      CloudUrl = $config.cloudUrl
      AgentVersion = $config.agentVersion
      WbLogin = $config.wbLogin
      ActivityEnabled = $config.activityEnabled
      CaptureDomains = $config.captureDomains
      HeartbeatSeconds = $config.heartbeatSeconds
      ActivitySampleSeconds = $config.activitySampleSeconds
      ActivityUploadSeconds = $config.activityUploadSeconds
      TokenProtectedConfigured = -not [string]::IsNullOrWhiteSpace([string]$config.cloudTokenProtected)
    } | Format-List
  } catch {
    Write-Host ("ERRO ao ler config.json: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
} else {
  Write-Host "ERRO: config.json nao encontrado." -ForegroundColor Red
}

Write-Section "TAREFA AGENDADA"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    TaskName = $task.TaskName
    State = $task.State
    LastRunTime = $taskInfo.LastRunTime
    LastTaskResult = $taskInfo.LastTaskResult
  } | Format-List
} else {
  Write-Host "ERRO: tarefa agendada nao encontrada." -ForegroundColor Red
}

Write-Section "PROCESSO EM SEGUNDO PLANO"
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "powershell.exe" -and
  $_.CommandLine -match "RealtimeHoursAgent\.ps1" -and
  $_.CommandLine -match "Mode Daemon"
})
if ($processes.Count -gt 0) {
  Write-Host "OK: agente rodando em segundo plano." -ForegroundColor Green
  $processes | Select-Object ProcessId, Name, CommandLine | Format-List
} else {
  Write-Host "ERRO: processo do agente nao encontrado." -ForegroundColor Red
}

Write-Section "FILAS"
$queuePresence = @(Get-ChildItem (Join-Path $Root "queue") -Filter "*.json" -File -ErrorAction SilentlyContinue).Count
$queueActivity = @(Get-ChildItem (Join-Path $Root "queue\activity") -Filter "*.json" -File -ErrorAction SilentlyContinue).Count
$failedPresence = @(Get-ChildItem (Join-Path $Root "failed") -Filter "*.json" -File -ErrorAction SilentlyContinue).Count
$failedActivity = @(Get-ChildItem (Join-Path $Root "failed\activity") -Filter "*.json" -File -ErrorAction SilentlyContinue).Count
[PSCustomObject]@{
  PresenceQueue = $queuePresence
  ActivityQueue = $queueActivity
  PresenceFailed = $failedPresence
  ActivityFailed = $failedActivity
} | Format-List

Write-Section "CONEXAO"
try {
  Test-NetConnection eastriverbrasil.com -Port 443 -InformationLevel Detailed |
    Select-Object ComputerName, RemoteAddress, RemotePort, TcpTestSucceeded |
    Format-List
} catch {
  Write-Host ("ERRO no teste de conexao: {0}" -f $_.Exception.Message) -ForegroundColor Red
}

Write-Section "LOG DO AGENTE"
$agentLog = Join-Path $Root "logs\agent.log"
if (Test-Path $agentLog) {
  Get-Content $agentLog -Tail 80
} else {
  Write-Host "agent.log ainda nao foi criado." -ForegroundColor Yellow
}

Write-Section "LOG DA INSTALACAO"
$installLog = Join-Path $Root "logs\installation.log"
if (Test-Path $installLog) {
  Get-Content $installLog -Tail 80
} else {
  Write-Host "installation.log nao encontrado." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pressione ENTER para fechar." -ForegroundColor White
[void](Read-Host)
