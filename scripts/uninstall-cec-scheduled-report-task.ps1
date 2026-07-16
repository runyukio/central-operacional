param([string]$TaskNamePrefix = "CEC Freshdesk Report")

foreach ($minute in @("00", "30")) {
  schtasks.exe /Delete /TN "$TaskNamePrefix $minute" /F *> $null
}

Write-Host "Automação CEC removida."
