<#
Removes Central Operacional Work Session Agent scheduled tasks.

By default, local config, queue and logs are kept. Use -RemoveData to delete them.
#>

[CmdletBinding()]
param(
  [switch]$RemoveData,
  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\WorkSessionAgent")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskNames = @(
  "Central Operacional - WorkSession Agent",
  "Central Operacional - WorkSession Lock",
  "Central Operacional - WorkSession Unlock",
  "Central Operacional - WorkSession Logout",
  "Central Operacional - WorkSession Shutdown"
)

foreach ($taskName in $TaskNames) {
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
      Write-Host "Tarefa removida: $taskName"
    } else {
      & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
    }
  } catch {
    Write-Warning "Nao foi possivel remover $taskName. Detalhe: $($_.Exception.Message)"
  }
}

if ($RemoveData -and (Test-Path $InstallDir)) {
  Remove-Item -Path $InstallDir -Recurse -Force
  Write-Host "Dados locais removidos: $InstallDir"
}

Write-Host "Desinstalacao concluida."
