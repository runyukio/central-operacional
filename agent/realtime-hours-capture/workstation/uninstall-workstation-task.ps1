<#
Removes the Realtime Hours workstation agent scheduled task.

By default, local config, queue and logs are kept. Use -RemoveData to delete them.
#>

[CmdletBinding()]
param(
  [switch]$RemoveData,

  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "Central Operacional - Realtime Hours Agent"

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa removida: $TaskName"
  }
} catch {
  Write-Warning "Nao foi possivel remover a tarefa. Detalhe: $($_.Exception.Message)"
}

if ($RemoveData -and (Test-Path $InstallDir)) {
  Remove-Item -Path $InstallDir -Recurse -Force
  Write-Host "Dados locais removidos: $InstallDir"
}

Write-Host "Desinstalacao concluida."
