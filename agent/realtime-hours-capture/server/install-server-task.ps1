<#
Installs the Realtime Hours local concentrator on the Windows server.

Run as Administrator:
  powershell -ExecutionPolicy Bypass -File .\install-server-task.ps1 `
    -SiteUrl "https://eastriverbrasil.com" `
    -ImportToken "TOKEN_DO_SITE" `
    -LocalToken "TOKEN_DA_REDE_LOCAL"
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SiteUrl,

  [Parameter(Mandatory = $true)]
  [string]$ImportToken,

  [Parameter(Mandatory = $true)]
  [string]$LocalToken,

  [string]$BindHost = "0.0.0.0",

  [int]$Port = 8787,

  [int]$UploadIntervalMinutes = 5,

  [bool]$UploadEnabled = $true,

  [int]$MaxRecordsPerUpload = 1000,

  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursServer"),

  [string]$NodePath = "",

  [switch]$AddFirewallRule
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "Central Operacional - Realtime Hours Server"
$FirewallRuleName = "Central Operacional Realtime Hours Server"

function Assert-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este instalador como Administrador."
  }
}

Assert-Administrator

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js nao encontrado no PATH. Instale Node.js LTS no servidor Windows."
  }
  $NodePath = $nodeCommand.Source
}

$sourceServer = Join-Path $PSScriptRoot "realtime-hours-server.mjs"
if (-not (Test-Path $sourceServer)) {
  throw "realtime-hours-server.mjs nao encontrado na pasta do instalador."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "queue") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "sent") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "failed") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "logs") -Force | Out-Null

$targetServer = Join-Path $InstallDir "realtime-hours-server.mjs"
Copy-Item -Path $sourceServer -Destination $targetServer -Force

$configPath = Join-Path $InstallDir "config.json"
$config = [ordered]@{
  bindHost = $BindHost
  port = $Port
  siteUrl = $SiteUrl.TrimEnd("/")
  importToken = $ImportToken
  localToken = $LocalToken
  uploadEnabled = $UploadEnabled
  uploadIntervalMinutes = $UploadIntervalMinutes
  uploadSource = "local-windows-server"
  maxFilesPerUpload = 500
  maxRecordsPerUpload = $MaxRecordsPerUpload
  sentRetentionDays = 7
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$config | ConvertTo-Json -Depth 8 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "Criando tarefa agendada do servidor local..."
$arguments = "`"$targetServer`" --config `"$configPath`""
$action = New-ScheduledTaskAction -Execute $NodePath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

if ($AddFirewallRule) {
  try {
    $existing = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
    if ($existing) {
      Remove-NetFirewallRule -DisplayName $FirewallRuleName
    }
    New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Write-Host "Regra de firewall criada para TCP $Port."
  } catch {
    Write-Warning "Nao foi possivel criar regra de firewall. Detalhe: $($_.Exception.Message)"
  }
}

Write-Host "Iniciando servidor local..."
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Instalacao concluida."
Write-Host "Servidor: http://<IP_DO_SERVIDOR>:$Port"
Write-Host "Config:   $configPath"
Write-Host "Logs:     $(Join-Path $InstallDir "logs\server.log")"
Write-Host "Fila:     $(Join-Path $InstallDir "queue")"
Write-Host ""
Write-Host "Use o mesmo LocalToken nos computadores da operacao."
