[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$InstallDir = "$env:ProgramData\CentralOperacional\RealtimeHoursV2",
  [switch]$PreserveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute o desinstalador como Administrador."
  }
}

function Remove-ExtensionPolicyValue {
  param([string]$BrowserPath, [string]$ExtensionId)
  if ([string]::IsNullOrWhiteSpace($ExtensionId)) { return }
  $forceList = Join-Path $BrowserPath 'ExtensionInstallForcelist'
  $item = Get-ItemProperty -Path $forceList -ErrorAction SilentlyContinue
  if (-not $item) { return }
  foreach ($property in @($item.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' })) {
    if ([string]$property.Value -match "^$([regex]::Escape($ExtensionId));") {
      Remove-ItemProperty -Path $forceList -Name $property.Name -ErrorAction SilentlyContinue
    }
  }
}

Assert-Administrator
$metadataPath = Join-Path $InstallDir 'install-metadata.json'
$metadata = if (Test-Path -LiteralPath $metadataPath) {
  Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
} else { $null }
$taskName = if ($metadata -and $metadata.taskName) { [string]$metadata.taskName } else { 'Central Operacional - Realtime Hours V2' }
$hostName = if ($metadata -and $metadata.nativeHostName) { [string]$metadata.nativeHostName } else { 'com.centraloperacional.realtimehours.v2' }
$extensionId = if ($metadata -and $metadata.extensionId) { [string]$metadata.extensionId } else { '' }

if ($PSCmdlet.ShouldProcess($InstallDir, 'Remover Realtime Hours V2')) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and (
        [string]$_.ExecutablePath -like "$InstallDir*" -or
        [string]$_.CommandLine -match '(?i)RealtimeHoursV2|RealtimeHoursNativeHostV2'
      )
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  foreach ($path in @(
    "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$hostName",
    "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$hostName"
  )) { Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-ExtensionPolicyValue -BrowserPath 'HKLM:\SOFTWARE\Policies\Google\Chrome' -ExtensionId $extensionId
  Remove-ExtensionPolicyValue -BrowserPath 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' -ExtensionId $extensionId

  if ($PreserveData -and (Test-Path -LiteralPath $InstallDir)) {
    $backup = "$InstallDir.uninstall-backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in @('queue', 'failed', 'logs')) {
      $source = Join-Path $InstallDir $name
      if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $backup -Recurse -Force }
    }
    Write-Host "Dados operacionais preservados em: $backup" -ForegroundColor Yellow
  }

  Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\CentralOperacionalRealtimeHoursV2' -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Realtime Hours V2 removido." -ForegroundColor Green
}
