param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskNamePrefix = "CEC Freshdesk Report",
  [string]$OutputDir = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "CEC")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$minutes = @("00", "30")
$scriptPath = Join-Path $ProjectDir "scripts\download-cec-scheduled-report.ps1"
$wrapperPath = Join-Path $OutputDir "run-cec-report.ps1"
$logDir = Join-Path $OutputDir "logs"

if (!(Test-Path -LiteralPath $scriptPath)) { throw "Script CEC não encontrado: $scriptPath" }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$wrapper = @"
`$ErrorActionPreference = "Continue"
`$logDir = '$($logDir.Replace("'", "''"))'
New-Item -ItemType Directory -Path `$logDir -Force | Out-Null
`$outLog = Join-Path `$logDir "cec-report.out.log"
`$errLog = Join-Path `$logDir "cec-report.err.log"
Add-Content -Path `$outLog -Value ("==== " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ====")
try {
  Set-Location '$($ProjectDir.Replace("'", "''"))'
  & '$($scriptPath.Replace("'", "''"))' >> `$outLog 2>> `$errLog
  if (`$null -eq `$LASTEXITCODE) { exit 0 }
  exit `$LASTEXITCODE
} catch {
  Add-Content -Path `$errLog -Value (`$_.Exception.ToString())
  exit 1
}
"@
Set-Content -LiteralPath $wrapperPath -Value $wrapper -Encoding UTF8

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$wrapperPath`""
foreach ($minute in $minutes) {
  $taskName = "$TaskNamePrefix $minute"
  schtasks.exe /Delete /TN $taskName /F *> $null
  schtasks.exe /Create /TN $taskName /SC HOURLY /MO 1 /ST "00:$minute" /TR $taskCommand /F | Out-Host
}

Write-Host "Automação CEC instalada para os minutos 00 e 30 de cada hora."
Write-Host "Logs: $logDir"
