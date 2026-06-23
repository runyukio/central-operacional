param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskNamePrefix = "KAP Real Time Download",
  [string]$OutputDir = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "KAP")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$minutes = @("00", "10", "20", "30", "40", "50")
$scriptPath = Join-Path $ProjectDir "scripts\download-kap.ps1"
$wrapperPath = Join-Path $OutputDir "run-kap-download.ps1"
$logDir = Join-Path $OutputDir "logs"

if (!(Test-Path -LiteralPath $scriptPath)) {
  throw "download-kap.ps1 not found: $scriptPath"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Escape-SingleQuotedPowerShellString {
  param([Parameter(Mandatory = $true)][string]$Value)
  return $Value.Replace("'", "''")
}

$projectLiteral = Escape-SingleQuotedPowerShellString $ProjectDir
$scriptLiteral = Escape-SingleQuotedPowerShellString $scriptPath
$logLiteral = Escape-SingleQuotedPowerShellString $logDir

$wrapper = @"
`$ErrorActionPreference = "Continue"
`$projectDir = '$projectLiteral'
`$scriptPath = '$scriptLiteral'
`$logDir = '$logLiteral'
New-Item -ItemType Directory -Path `$logDir -Force | Out-Null
`$outLog = Join-Path `$logDir "kap-download.out.log"
`$errLog = Join-Path `$logDir "kap-download.err.log"
Add-Content -Path `$outLog -Value ("==== " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ====")
try {
  Set-Location `$projectDir
  & `$scriptPath >> `$outLog 2>> `$errLog
  `$exitCode = `$LASTEXITCODE
  if (`$null -eq `$exitCode) { `$exitCode = 0 }
  exit `$exitCode
} catch {
  Add-Content -Path `$errLog -Value (`$_.Exception.ToString())
  exit 1
}
"@

Set-Content -LiteralPath $wrapperPath -Value $wrapper -Encoding UTF8

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$wrapperPath`""

foreach ($minute in $minutes) {
  $taskName = "$TaskNamePrefix $minute"
  $startTime = "00:$minute"
  schtasks.exe /Delete /TN $taskName /F *> $null
  schtasks.exe /Create /TN $taskName /SC HOURLY /MO 1 /ST $startTime /TR $taskCommand /F | Out-Host
}

Write-Host ""
Write-Host "KAP Windows automation installed."
Write-Host "Tasks:"
foreach ($minute in $minutes) {
  Write-Host " - $TaskNamePrefix $minute"
}
Write-Host "Wrapper: $wrapperPath"
Write-Host "Logs: $logDir"
Write-Host ""
Write-Host "Validate with:"
Write-Host "  Get-ScheduledTask | Where-Object TaskName -like 'KAP Real Time Download*'"
Write-Host "  Get-Content `"$logDir\kap-download.out.log`" -Tail 80"
