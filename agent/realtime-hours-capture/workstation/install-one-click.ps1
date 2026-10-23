[CmdletBinding()]
param([string]$SetupPath = (Join-Path $PSScriptRoot "setup.json"))

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$installRoot = Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent"
$logDirectory = Join-Path $installRoot "logs"
$installationLog = Join-Path $logDirectory "installation.log"
$successMarker = Join-Path $installRoot "installation-success.txt"
$failureMarker = Join-Path $installRoot "installation-failed.txt"
$installerPath = Join-Path $PSScriptRoot "install-workstation-task.ps1"

function Get-SetupValue {
  param([object]$Setup, [string]$Name, [object]$DefaultValue = $null)
  $property = $Setup.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return $DefaultValue }
  return $property.Value
}

try {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  Remove-Item -Path $successMarker, $failureMarker -Force -ErrorAction SilentlyContinue
  Start-Transcript -Path $installationLog -Append | Out-Null
  if (-not (Test-Path $SetupPath)) { throw "setup.json nao encontrado. Copie setup.example.json para setup.json e configure o token." }
  if (-not (Test-Path $installerPath)) { throw "install-workstation-task.ps1 nao encontrado." }

  $setup = Get-Content -Path $SetupPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $parameters = @{
    CloudUrl = [string](Get-SetupValue $setup "cloudUrl" "https://eastriverbrasil.com")
    CloudToken = [string](Get-SetupValue $setup "cloudToken" "")
    WbLogin = [string](Get-SetupValue $setup "wbLogin" "")
    EmployeeId = [string](Get-SetupValue $setup "employeeId" "")
    HeartbeatSeconds = [int](Get-SetupValue $setup "heartbeatSeconds" 120)
    ActiveThresholdSeconds = [int](Get-SetupValue $setup "activeThresholdSeconds" 300)
    ActivitySampleSeconds = [int](Get-SetupValue $setup "activitySampleSeconds" 5)
    ActivityUploadSeconds = [int](Get-SetupValue $setup "activityUploadSeconds" 60)
    ActivityMaxSegmentSeconds = [int](Get-SetupValue $setup "activityMaxSegmentSeconds" 3600)
    ActivityEnabled = [bool](Get-SetupValue $setup "activityEnabled" $true)
    CaptureDomains = [bool](Get-SetupValue $setup "captureDomains" $true)
    IdentityConfidence = [string](Get-SetupValue $setup "identityConfidence" "MEDIUM")
    IdentitySource = [string](Get-SetupValue $setup "identitySource" "windows_user")
    RunNow = $true
    Silent = $true
  }
  & $installerPath @parameters

  $taskName = "Central Operacional - Realtime Hours Agent"
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if ($task.State -eq "Disabled") { throw "A tarefa do Agent esta desabilitada." }
  Set-Content -Path $successMarker -Encoding UTF8 -Value @"
Instalacao concluida com sucesso.
Data UTC: $((Get-Date).ToUniversalTime().ToString("o"))
Computador: $env:COMPUTERNAME
Usuario do instalador: $env:USERNAME
Tarefa: $taskName
Estado: $($task.State)
"@
  if ([bool](Get-SetupValue $setup "removeSetupAfterInstall" $true) -and (Test-Path $SetupPath)) { Remove-Item -Path $SetupPath -Force }
  exit 0
} catch {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $content = "Falha na instalacao.`r`nData UTC: $((Get-Date).ToUniversalTime().ToString('o'))`r`nComputador: $env:COMPUTERNAME`r`nErro: $($_.Exception.Message)"
  Set-Content -Path $failureMarker -Value $content -Encoding UTF8
  Add-Content -Path $installationLog -Value $content -Encoding UTF8
  exit 1
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
