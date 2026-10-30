[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
  try {
    $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $child.ExitCode
  } catch { Write-Host 'A permissao de administrador e necessaria para instalar.'; exit 740 }
}

$guard = [Threading.Mutex]::new($false, 'Global\CentralOperacionalRealtimeHoursV2Installer')
$locked = $false
try {
  try { $locked = $guard.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Ja existe outra instalacao em andamento.' }
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Este pacote requer Windows de 64 bits.' }
  $managed = [bool](Get-CimInstance Win32_ComputerSystem).PartOfDomain
  if (-not $managed) {
    $joined = & "$env:SystemRoot\System32\dsregcmd.exe" /status 2>$null | Out-String
    $managed = $joined -match '(?im)^\s*AzureAdJoined\s*:\s*YES\s*$'
  }
  if (-not $managed) { throw 'Este pacote de extensao requer computador gerenciado por dominio Windows ou Entra ID.' }

  $release = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw | ConvertFrom-Json
  if ($release.environment -ne 'homologation' -or $release.extensionId -notmatch '^[a-p]{32}$') { throw 'Pacote de homologacao invalido.' }
  foreach ($file in $release.files.PSObject.Properties) {
    if ($file.Name -notmatch '^[A-Za-z0-9._-]+$') { throw 'Nome de arquivo invalido no pacote.' }
    $path = Join-Path $PSScriptRoot $file.Name
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine [string]$file.Value) { throw "Arquivo corrompido: $($file.Name)" }
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $health = Invoke-RestMethod -Uri "$($release.baseUrl)/api/realtime-hours/v2/health" -TimeoutSec 30
  if (-not $health.success -or $health.environment -ne 'homologation' -or $health.extensionId -ne $release.extensionId) { throw 'A Central de homologacao nao confirmou este pacote.' }
  $enrollment = Join-Path $PSScriptRoot 'enrollment.json'
  if (-not (Test-Path -LiteralPath $enrollment -PathType Leaf)) { throw 'Este pacote ja foi utilizado. Solicite um novo pacote para outra instalacao.' }
  $logDir = Join-Path $env:ProgramData 'CentralOperacional\RealtimeHoursV2-Installer'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $logFile = Join-Path $logDir ('install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
  Start-Transcript -LiteralPath $logFile -Force | Out-Null
  Write-Host 'Instalando captura de dominios e envio para a Central...'
  & (Join-Path $PSScriptRoot 'Install-RealtimeHoursV2.ps1') `
    -AgentExe (Join-Path $PSScriptRoot 'RealtimeHoursAgentV2.exe') `
    -ExtensionId ([string]$release.extensionId) -ExtensionUpdateUrl ([string]$release.extensionUpdateUrl) `
    -EnrollmentFile $enrollment -BaseUrl ([string]$release.baseUrl)
  try {
    & (Join-Path $PSScriptRoot 'Collect-RealtimeHoursV2Diagnostics.ps1') -OutputPath (Join-Path $env:PUBLIC 'Desktop\RealtimeHoursV2-Diagnostico.json')
  } catch { Write-Warning "Diagnostico nao exportado: $($_.Exception.Message)" }
  Write-Host 'Instalacao concluida.' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ('Instalacao nao concluida: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  try { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null } catch {}
  if ($locked) { $guard.ReleaseMutex() }
  $guard.Dispose()
}
