param(
  [string]$TaskNamePrefix = "KAP Real Time Download"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$minutes = @("00", "10", "20", "30", "40", "50")

foreach ($minute in $minutes) {
  $taskName = "$TaskNamePrefix $minute"
  schtasks.exe /Delete /TN $taskName /F *> $null
}

Write-Host "KAP Windows automation tasks removed."
