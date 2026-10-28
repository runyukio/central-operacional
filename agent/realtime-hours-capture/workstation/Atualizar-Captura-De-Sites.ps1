<#
Central Operacional - Atualizacao da captura de dominios 0.5.1
Preserva a configuracao e o token protegido da instalacao atual.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$AgentVersion = "0.5.1"
$TaskName = "Central Operacional - Realtime Hours Agent"
$SourceAgent = Join-Path $PSScriptRoot "RealtimeHoursAgent.ps1"
$TargetAgent = Join-Path $InstallDir "RealtimeHoursAgent.ps1"
$ConfigPath = Join-Path $InstallDir "config.json"
$LogDir = Join-Path $InstallDir "logs"
$UpdateLog = Join-Path $LogDir "domain-capture-update.log"

function Assert-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este atualizador como Administrador."
  }
}

function Get-InteractiveUser {
  try {
    $candidate = [string](Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).UserName
  } catch {
    $candidate = ""
  }
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $candidate = "{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME
  }
  return $candidate.Trim()
}

function Stop-AgentInstances {
  Write-Host "Encerrando tarefas e processos anteriores..." -ForegroundColor Cyan

  try {
    Get-ScheduledTask -ErrorAction SilentlyContinue |
      Where-Object {
        $_.TaskName -eq $TaskName -or
        ($_.Actions.Execute -match "(?i)powershell" -and $_.Actions.Arguments -match "(?i)RealtimeHoursAgent\.ps1")
      } |
      ForEach-Object {
        try { Stop-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue } catch {}
        try { Unregister-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -Confirm:$false -ErrorAction SilentlyContinue } catch {}
      }
  } catch {}

  try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match "^(powershell|pwsh)\.exe$" -and
        $_.CommandLine -match "(?i)RealtimeHoursAgent\.ps1"
      } |
      ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
  } catch {}

  Start-Sleep -Seconds 2
}

function Set-AgentPermissions {
  param([string]$Path)
  try {
    & icacls.exe $Path /inheritance:r `
      /grant:r "*S-1-5-18:(OI)(CI)F" `
      "*S-1-5-32-544:(OI)(CI)F" `
      "*S-1-5-32-545:(OI)(CI)RX" | Out-Null

    foreach ($writable in @("queue", "failed", "logs", "backup")) {
      $writablePath = Join-Path $Path $writable
      if (Test-Path $writablePath) {
        & icacls.exe $writablePath /inheritance:r `
          /grant:r "*S-1-5-18:(OI)(CI)F" `
          "*S-1-5-32-544:(OI)(CI)F" `
          "*S-1-5-32-545:(OI)(CI)M" | Out-Null
      }
    }
  } catch {
    Write-Host ("Aviso: nao foi possivel aplicar todas as permissoes. {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }
}

function Register-AgentTask {
  param([string]$InteractiveUser)

  $daemonArgs = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TargetAgent`" -Mode Daemon"
  $action = New-ScheduledTaskAction `
    -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument $daemonArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $InteractiveUser
  $principal = New-ScheduledTaskPrincipal -UserId $InteractiveUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Agente silencioso de presenca, aplicativos e dominios ativos da Central Operacional." `
    -Force | Out-Null
}

function Start-Agent {
  try {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  } catch {
    Write-Host ("A tarefa nao iniciou diretamente: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }

  Start-Sleep -Seconds 5
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match "^(powershell|pwsh)\.exe$" -and
    $_.CommandLine -match "(?i)RealtimeHoursAgent\.ps1" -and
    $_.CommandLine -match "(?i)Mode Daemon"
  })

  if ($processes.Count -eq 0) {
    $args = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TargetAgent`" -Mode Daemon"
    Start-Process `
      -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
      -ArgumentList $args `
      -WindowStyle Hidden `
      -ErrorAction Stop
    Start-Sleep -Seconds 5
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match "^(powershell|pwsh)\.exe$" -and
      $_.CommandLine -match "(?i)RealtimeHoursAgent\.ps1" -and
      $_.CommandLine -match "(?i)Mode Daemon"
    })
  }

  if ($processes.Count -eq 0) {
    throw "O Agent nao permaneceu em execucao."
  }

  if ($processes.Count -gt 1) {
    throw "Foram encontradas $($processes.Count) instancias do Agent. A atualizacao foi interrompida para evitar duplicidade."
  }

  return $processes[0]
}

function Get-FileCount {
  param([string]$Path)
  return @(Get-ChildItem -LiteralPath $Path -Filter "*.json" -File -ErrorAction SilentlyContinue).Count
}

Assert-Administrator

if (-not (Test-Path $InstallDir)) {
  throw "A instalacao atual nao foi encontrada em $InstallDir."
}
if (-not (Test-Path $ConfigPath)) {
  throw "config.json nao encontrado. Esta atualizacao precisa de uma instalacao 0.4.0 ou 0.5.0 funcional."
}
if (-not (Test-Path $SourceAgent)) {
  throw "RealtimeHoursAgent.ps1 0.5.1 nao encontrado no pacote."
}

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path $UpdateLog -Append | Out-Null

try {
  $configObject = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $protectedToken = [string]$configObject.cloudTokenProtected
  $legacyToken = [string]$configObject.cloudToken
  if ([string]::IsNullOrWhiteSpace($protectedToken) -and [string]::IsNullOrWhiteSpace($legacyToken)) {
    throw "A configuracao atual nao possui token protegido nem token legado."
  }

  $interactiveUser = Get-InteractiveUser
  if ([string]::IsNullOrWhiteSpace($interactiveUser)) {
    throw "Nao foi possivel identificar o usuario interativo."
  }

  Write-Host "Atualizando a captura de dominios para a versao $AgentVersion..." -ForegroundColor Cyan
  Write-Host "Usuario interativo: $interactiveUser" -ForegroundColor Cyan

  Stop-AgentInstances

  $backupDir = Join-Path $InstallDir "backup"
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  if (Test-Path $TargetAgent) {
    Copy-Item -LiteralPath $TargetAgent -Destination (Join-Path $backupDir "RealtimeHoursAgent-$stamp.ps1") -Force
  }
  Copy-Item -LiteralPath $ConfigPath -Destination (Join-Path $backupDir "config-$stamp.json") -Force

  Copy-Item -LiteralPath $SourceAgent -Destination $TargetAgent -Force

  $config = [ordered]@{}
  foreach ($property in $configObject.PSObject.Properties) {
    $config[$property.Name] = $property.Value
  }
  $config["agentVersion"] = $AgentVersion
  $config["captureDomains"] = $true
  $config["domainCaptureEngine"] = "uia-multipattern-v2"
  $config["installedForUser"] = $interactiveUser
  $config["updatedAt"] = (Get-Date).ToUniversalTime().ToString("o")
  $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

  foreach ($folder in @(
    (Join-Path $InstallDir "queue"),
    (Join-Path $InstallDir "queue\activity"),
    (Join-Path $InstallDir "failed"),
    (Join-Path $InstallDir "failed\activity"),
    (Join-Path $InstallDir "logs"),
    $backupDir
  )) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
  }

  Set-AgentPermissions -Path $InstallDir

  $beforePresenceFailed = Get-FileCount -Path (Join-Path $InstallDir "failed")
  $beforeActivityFailed = Get-FileCount -Path (Join-Path $InstallDir "failed\activity")

  Write-Host "Validando comunicacao com a Central..." -ForegroundColor Cyan
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $TargetAgent -Mode Once

  if ($LASTEXITCODE -ne 0) {
    throw "O teste de comunicacao terminou com codigo $LASTEXITCODE."
  }

  $afterPresenceFailed = Get-FileCount -Path (Join-Path $InstallDir "failed")
  $afterActivityFailed = Get-FileCount -Path (Join-Path $InstallDir "failed\activity")
  if ($afterPresenceFailed -gt $beforePresenceFailed -or $afterActivityFailed -gt $beforeActivityFailed) {
    throw "A Central recusou o teste. PresenceFailed=$afterPresenceFailed ActivityFailed=$afterActivityFailed."
  }

  Register-AgentTask -InteractiveUser $interactiveUser
  $process = Start-Agent

  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue

  Set-Content -LiteralPath (Join-Path $InstallDir "domain-capture-update-success.txt") -Encoding UTF8 -Value @"
Atualizacao da captura de dominios concluida.
Data UTC: $((Get-Date).ToUniversalTime().ToString("o"))
Computador: $env:COMPUTERNAME
Usuario interativo: $interactiveUser
Versao: $AgentVersion
Motor: uia-multipattern-v2
Tarefa: $($task.State)
Ultimo resultado: $($taskInfo.LastTaskResult)
Processo: $($process.ProcessId)
Token: preservado da instalacao anterior
"@

  Write-Host ""
  Write-Host "ATUALIZACAO CONCLUIDA COM SUCESSO" -ForegroundColor Green
  Write-Host "Versao: $AgentVersion" -ForegroundColor Green
  Write-Host "Processo unico: $($process.ProcessId)" -ForegroundColor Green
  Write-Host ""
  Write-Host "Agora execute TESTAR-CAPTURA-DE-SITE.cmd." -ForegroundColor Cyan
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
