<#
Removes the Realtime Hours local concentrator scheduled task.

By default, local queue, config and logs are kept. Use -RemoveData to delete them.
#>

[CmdletBinding()]
param(
  [switch]$RemoveData,

  [switch]$RemoveFirewallRule,

  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursServer")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "Central Operacional - Realtime Hours Server"
$FirewallRuleName = "Central Operacional Realtime Hours Server"

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

if ($RemoveFirewallRule) {
  try {
    $rule = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
    if ($rule) {
      Remove-NetFirewallRule -DisplayName $FirewallRuleName
      Write-Host "Regra de firewall removida: $FirewallRuleName"
    }
  } catch {
    Write-Warning "Nao foi possivel remover regra de firewall. Detalhe: $($_.Exception.Message)"
  }
}

if ($RemoveData -and (Test-Path $InstallDir)) {
  Remove-Item -Path $InstallDir -Recurse -Force
  Write-Host "Dados locais removidos: $InstallDir"
}

Write-Host "Desinstalacao concluida."
