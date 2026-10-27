[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Agent = Join-Path $InstallDir "RealtimeHoursAgent.ps1"
$OutputFile = Join-Path $env:TEMP "central-domain-diagnostic.txt"
$ErrorFile = Join-Path $env:TEMP "central-domain-diagnostic-error.txt"

if (-not (Test-Path $Agent)) {
  throw "Agent nao encontrado em $Agent"
}

Write-Host ""
Write-Host "TESTE DA CAPTURA DE SITE" -ForegroundColor Cyan
Write-Host ""
Write-Host "Abra o Microsoft Edge em um site comum, como chatgpt.com." -ForegroundColor White
Write-Host "Nos proximos 12 segundos, volte para o Edge e mantenha-o em primeiro plano." -ForegroundColor Yellow
Write-Host ""

for ($seconds = 12; $seconds -ge 1; $seconds--) {
  Write-Host ("Captura em {0} segundo(s)..." -f $seconds)
  Start-Sleep -Seconds 1
}

Remove-Item -LiteralPath $OutputFile, $ErrorFile -Force -ErrorAction SilentlyContinue

$arguments = @(
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$Agent`"",
  "-Mode", "Diagnose"
) -join " "

$process = Start-Process `
  -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -ArgumentList $arguments `
  -WindowStyle Hidden `
  -Wait `
  -PassThru `
  -RedirectStandardOutput $OutputFile `
  -RedirectStandardError $ErrorFile

Write-Host ""
Write-Host "RESULTADO LOCAL" -ForegroundColor Cyan
if (Test-Path $OutputFile) {
  $result = Get-Content -LiteralPath $OutputFile -Raw
  Write-Host $result
} else {
  $result = ""
}
if (Test-Path $ErrorFile) {
  $errorText = Get-Content -LiteralPath $ErrorFile -Raw
  if (-not [string]::IsNullOrWhiteSpace($errorText)) {
    Write-Host $errorText -ForegroundColor Red
  }
}

$success = $result -match "(?m)^SourceType\s*:\s*WEB\s*$" -and
           $result -match "(?m)^Domain\s*:\s*(\S+)\s*$"

if ($success) {
  Write-Host "DOMINIO IDENTIFICADO COM SUCESSO." -ForegroundColor Green
  Write-Host "Enviando um intervalo de teste para a Central..." -ForegroundColor Cyan

  $onceArgs = @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$Agent`"",
    "-Mode", "Once"
  ) -join " "

  Start-Process `
    -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList $onceArgs `
    -WindowStyle Hidden `
    -Wait

  Write-Host "Envio concluido. Atualize a pagina de Atividade em cerca de 60 segundos." -ForegroundColor Green
} else {
  Write-Host "O Edge foi identificado, mas o dominio ainda nao foi lido." -ForegroundColor Yellow
  Write-Host "Envie uma foto deste resultado, principalmente DomainCaptureStatus, WindowElements e ProcessElements." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pagina: https://eastriverbrasil.com/captura-horas/atividade"
