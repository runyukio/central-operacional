<#
Central Operacional - Realtime Hours Workstation Agent

Collects a lightweight workstation heartbeat and sends it to the local Windows
server and/or directly to the site. If no configured destination is available,
snapshots stay queued on disk.
#>

[CmdletBinding()]
param(
  [ValidateSet("Daemon", "Once", "Flush")]
  [string]$Mode = "Once",

  [string]$ConfigPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AgentVersion = "0.1.0"
$DefaultRoot = Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $DefaultRoot "config.json"
}

$RootDir = Split-Path -Parent $ConfigPath
$QueueDir = Join-Path $RootDir "queue"
$LogDir = Join-Path $RootDir "logs"
$LogPath = Join-Path $LogDir "agent.log"

function Initialize-AgentFolders {
  foreach ($path in @($RootDir, $QueueDir, $LogDir)) {
    if (-not (Test-Path $path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
  }
}

function Write-AgentLog {
  param([string]$Message, [string]$Level = "INFO")
  Initialize-AgentFolders
  $line = "{0} [{1}] {2}" -f (Get-Date).ToString("s"), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Read-JsonHashtable {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return @{}
  }
  $raw = Get-Content -Path $Path -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @{}
  }
  $obj = $raw | ConvertFrom-Json
  $hash = @{}
  foreach ($property in $obj.PSObject.Properties) {
    $hash[$property.Name] = $property.Value
  }
  return $hash
}

function Save-JsonHashtable {
  param([string]$Path, [hashtable]$Data)
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $Data | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

function Get-Config {
  return Read-JsonHashtable -Path $ConfigPath
}

function Get-ConfigString {
  param([hashtable]$Config, [string]$Key, [string]$DefaultValue = "")
  if ($Config.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Config[$Key])) {
    return [string]$Config[$Key]
  }
  return $DefaultValue
}

function Get-ConfigInt {
  param([hashtable]$Config, [string]$Key, [int]$DefaultValue)
  if ($Config.ContainsKey($Key)) {
    $value = 0
    if ([int]::TryParse([string]$Config[$Key], [ref]$value) -and $value -gt 0) {
      return $value
    }
  }
  return $DefaultValue
}

function Get-ConfigBool {
  param([hashtable]$Config, [string]$Key, [bool]$DefaultValue = $false)
  if (-not $Config.ContainsKey($Key)) {
    return $DefaultValue
  }
  $value = ([string]$Config[$Key]).Trim().ToLowerInvariant()
  return @("true", "1", "sim", "yes") -contains $value
}

function Get-WindowsUserName {
  try {
    $interactiveUser = (Get-CimInstance -ClassName Win32_ComputerSystem).UserName
    if (-not [string]::IsNullOrWhiteSpace($interactiveUser)) {
      if ($interactiveUser.Contains("\")) {
        $interactiveUser = $interactiveUser.Split("\")[-1]
      }
      return $interactiveUser.Trim().ToLowerInvariant()
    }
  } catch {
    # Fall back to process identity below.
  }

  try {
    $candidate = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  } catch {
    $candidate = $env:USERNAME
  }
  if ($candidate.Contains("\")) {
    $candidate = $candidate.Split("\")[-1]
  }
  return $candidate.Trim().ToLowerInvariant()
}

function Get-WbLogin {
  param([hashtable]$Config)
  $configured = Get-ConfigString -Config $Config -Key "wbLogin"
  if (-not [string]::IsNullOrWhiteSpace($configured)) {
    if ($configured.Contains("\")) {
      $configured = $configured.Split("\")[-1]
    }
    return $configured.Trim().ToLowerInvariant()
  }
  return Get-WindowsUserName
}

function Get-LocalIpv4 {
  try {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.PrefixOrigin -ne "WellKnown"
      } |
      Sort-Object InterfaceMetric, InterfaceIndex
    if ($addresses) {
      return [string]$addresses[0].IPAddress
    }
  } catch {
    try {
      $entry = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME)
      $address = $entry.AddressList | Where-Object { $_.AddressFamily -eq "InterNetwork" } | Select-Object -First 1
      if ($address) {
        return [string]$address.IPAddressToString
      }
    } catch {
      return ""
    }
  }
  return ""
}

function Ensure-NativeMethods {
  if ("RealtimeHours.NativeMethods" -as [type]) {
    return
  }
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace RealtimeHours {
  public static class NativeMethods {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
      public uint cbSize;
      public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  }
}
"@
}

function Get-IdleSeconds {
  try {
    Ensure-NativeMethods
    $info = New-Object RealtimeHours.NativeMethods+LASTINPUTINFO
    $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
    if ([RealtimeHours.NativeMethods]::GetLastInputInfo([ref]$info)) {
      $tickCount = [uint32][Environment]::TickCount
      return [math]::Max(0, [math]::Floor(($tickCount - $info.dwTime) / 1000))
    }
  } catch {
    Write-AgentLog -Level "WARN" -Message ("Nao foi possivel medir idleSeconds. {0}" -f $_.Exception.Message)
  }
  return 0
}

function Get-ActiveWindowInfo {
  $result = @{
    processName = ""
    title = ""
  }
  try {
    Ensure-NativeMethods
    $handle = [RealtimeHours.NativeMethods]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) {
      return $result
    }

    [uint32]$processId = 0
    [RealtimeHours.NativeMethods]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
    if ($processId -gt 0) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) {
        $result.processName = [string]$process.ProcessName
      }
    }

    $builder = New-Object System.Text.StringBuilder 512
    [RealtimeHours.NativeMethods]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
    $result.title = $builder.ToString()
  } catch {
    Write-AgentLog -Level "WARN" -Message ("Nao foi possivel ler janela ativa. {0}" -f $_.Exception.Message)
  }
  return $result
}

function Join-AgentUrl {
  param([string]$BaseUrl, [string]$Path)
  return "{0}{1}" -f $BaseUrl.TrimEnd("/"), $Path
}

function Resolve-CloudEndpoint {
  param([string]$CloudUrl)
  $normalized = $CloudUrl.TrimEnd("/")
  if ($normalized -match "/api/") {
    return $normalized
  }
  return Join-AgentUrl -BaseUrl $normalized -Path "/api/realtime-hours/agent-snapshot"
}

function Get-DeliveryTargets {
  param([hashtable]$Config)
  $deliveryMode = (Get-ConfigString -Config $Config -Key "deliveryMode" -DefaultValue "AUTO").Trim().ToUpperInvariant()
  $serverUrl = Get-ConfigString -Config $Config -Key "serverUrl"
  $localToken = Get-ConfigString -Config $Config -Key "localToken"
  $cloudUrl = Get-ConfigString -Config $Config -Key "cloudUrl"
  $cloudToken = Get-ConfigString -Config $Config -Key "cloudToken"
  $targets = @()

  if (($deliveryMode -eq "AUTO" -or $deliveryMode -eq "LOCAL") -and -not [string]::IsNullOrWhiteSpace($serverUrl) -and -not [string]::IsNullOrWhiteSpace($localToken)) {
    $targets += @{
      label = "servidor local"
      uri = Join-AgentUrl -BaseUrl $serverUrl -Path "/snapshot"
      token = $localToken
    }
  }

  if (($deliveryMode -eq "AUTO" -or $deliveryMode -eq "CLOUD") -and -not [string]::IsNullOrWhiteSpace($cloudUrl) -and -not [string]::IsNullOrWhiteSpace($cloudToken)) {
    $targets += @{
      label = "site direto"
      uri = Resolve-CloudEndpoint -CloudUrl $cloudUrl
      token = $cloudToken
    }
  }

  return $targets
}

function Invoke-AgentPost {
  param([string]$Uri, [hashtable]$Payload, [string]$Token)
  $body = $Payload | ConvertTo-Json -Depth 8 -Compress
  $headers = @{ Authorization = "Bearer $Token" }
  return Invoke-RestMethod -Method Post -Uri $Uri -Headers $headers -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 10
}

function New-SnapshotPayload {
  $config = Get-Config
  $targets = @(Get-DeliveryTargets -Config $config)
  if (-not $targets -or $targets.Count -eq 0) {
    throw "Nenhum destino configurado. Configure serverUrl/localToken ou cloudUrl/cloudToken."
  }

  $idleSeconds = Get-IdleSeconds
  $activeThresholdSeconds = Get-ConfigInt -Config $config -Key "activeThresholdSeconds" -DefaultValue 300
  $lastActivityAt = (Get-Date).AddSeconds(-1 * $idleSeconds).ToUniversalTime().ToString("o")
  $windowInfo = @{
    processName = ""
    title = ""
  }
  if (Get-ConfigBool -Config $config -Key "captureActiveWindow" -DefaultValue $false) {
    $windowInfo = Get-ActiveWindowInfo
  }

  $record = @{
    hostname = $env:COMPUTERNAME
    windowsUser = Get-WindowsUserName
    wbLogin = Get-WbLogin -Config $config
    employeeId = Get-ConfigString -Config $config -Key "employeeId"
    ipAddress = Get-LocalIpv4
    isSessionActive = ($idleSeconds -lt $activeThresholdSeconds)
    idleSeconds = $idleSeconds
    lastActivityAt = $lastActivityAt
    activeProcessName = $windowInfo.processName
    activeWindowTitle = $windowInfo.title
    identitySource = Get-ConfigString -Config $config -Key "identitySource" -DefaultValue "windows_user"
    identityConfidence = Get-ConfigString -Config $config -Key "identityConfidence" -DefaultValue "MEDIUM"
    agentVersion = $AgentVersion
  }

  return @{
    payload = @{
      source = "windows-workstation-agent"
      capturedAt = (Get-Date).ToUniversalTime().ToString("o")
      record = $record
    }
  }
}

function Save-QueuedSnapshot {
  Initialize-AgentFolders
  $snapshot = New-SnapshotPayload
  $fileName = "{0}_{1}.json" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff"), ([guid]::NewGuid().ToString("N"))
  $path = Join-Path $QueueDir $fileName
  Save-JsonHashtable -Path $path -Data $snapshot.payload
  Write-AgentLog -Message ("Snapshot enfileirado: {0}" -f $fileName)
}

function Flush-Queue {
  Initialize-AgentFolders
  $config = Get-Config
  $targets = @(Get-DeliveryTargets -Config $config)
  if (-not $targets -or $targets.Count -eq 0) {
    throw "Nenhum destino configurado. Configure serverUrl/localToken ou cloudUrl/cloudToken."
  }

  $files = Get-ChildItem -Path $QueueDir -Filter "*.json" -File | Sort-Object Name
  foreach ($file in $files) {
    $payload = Read-JsonHashtable -Path $file.FullName
    $sent = $false
    foreach ($target in $targets) {
      $targetLabel = [string]$target["label"]
      $targetUri = [string]$target["uri"]
      $targetToken = [string]$target["token"]
      try {
        $response = Invoke-AgentPost -Uri $targetUri -Payload $payload -Token $targetToken
        if (-not $response.success) {
          throw ("{0} recusou snapshot." -f $targetLabel)
        }
        Remove-Item -Path $file.FullName -Force
        Write-AgentLog -Message ("Snapshot enviado para {0}: {1}" -f $targetLabel, $file.Name)
        $sent = $true
        break
      } catch {
        Write-AgentLog -Level "WARN" -Message ("Falha ao enviar para {0}. {1}" -f $targetLabel, $_.Exception.Message)
      }
    }

    if (-not $sent) {
      Write-AgentLog -Level "WARN" -Message ("Snapshot mantido em fila: {0}" -f $file.Name)
      break
    }
  }
}

function Send-Once {
  Save-QueuedSnapshot
  Flush-Queue
}

function Start-Daemon {
  Write-AgentLog -Message "Agent iniciado em modo daemon."
  while ($true) {
    try {
      Send-Once
    } catch {
      Write-AgentLog -Level "WARN" -Message ("Ciclo com falha. {0}" -f $_.Exception.Message)
    }
    $config = Get-Config
    $heartbeatSeconds = Get-ConfigInt -Config $config -Key "heartbeatSeconds" -DefaultValue 60
    Start-Sleep -Seconds $heartbeatSeconds
  }
}

Initialize-AgentFolders

switch ($Mode) {
  "Daemon" { Start-Daemon }
  "Once" { Send-Once }
  "Flush" { Flush-Queue }
}
