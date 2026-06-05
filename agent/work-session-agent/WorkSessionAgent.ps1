<#
Central Operacional - Work Session Agent

Runs in the background on Windows, queues events while offline, and sends them
to the Central Operacional API when connectivity is available.
#>

[CmdletBinding()]
param(
  [ValidateSet("Daemon", "Event", "Flush", "Enroll")]
  [string]$Mode = "Daemon",

  [ValidateSet("LOGIN", "UNLOCK", "HEARTBEAT", "LOCK", "LOGOUT", "SHUTDOWN", "SLEEP", "WAKE")]
  [string]$EventType = "HEARTBEAT",

  [string]$ConfigPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AgentVersion = "0.1.0"
$DefaultRoot = Join-Path $env:ProgramData "CentralOperacional\WorkSessionAgent"
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

function Save-Config {
  param([hashtable]$Config)
  Save-JsonHashtable -Path $ConfigPath -Data $Config
}

function Get-NormalizedWbLogin {
  param([hashtable]$Config)
  $candidate = ""
  if ($Config.ContainsKey("wbLogin") -and -not [string]::IsNullOrWhiteSpace([string]$Config["wbLogin"])) {
    $candidate = [string]$Config["wbLogin"]
  } elseif (-not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
    $candidate = $env:USERNAME
  } else {
    $candidate = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  }
  if ($candidate.Contains("\")) {
    $candidate = $candidate.Split("\")[-1]
  }
  return $candidate.Trim().ToLowerInvariant()
}

function Get-OSCaption {
  try {
    return (Get-CimInstance -ClassName Win32_OperatingSystem).Caption
  } catch {
    return "Windows"
  }
}

function Get-TimeZoneName {
  try {
    return (Get-TimeZone).Id
  } catch {
    return [System.TimeZoneInfo]::Local.Id
  }
}

function Get-Sha256Hex {
  param([string]$Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hashBytes = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-DeviceFingerprint {
  param([hashtable]$Config)
  $machineGuid = ""
  try {
    $machineGuid = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid).MachineGuid
  } catch {
    $machineGuid = $env:COMPUTERNAME
  }
  $source = "{0}|{1}|{2}" -f $machineGuid, $env:COMPUTERNAME, (Get-NormalizedWbLogin -Config $Config)
  return Get-Sha256Hex -Value $source
}

function Join-AgentUrl {
  param([string]$BaseUrl, [string]$Path)
  return "{0}{1}" -f $BaseUrl.TrimEnd("/"), $Path
}

function Invoke-AgentPost {
  param([string]$Uri, [hashtable]$Payload)
  $body = $Payload | ConvertTo-Json -Depth 8 -Compress
  return Invoke-RestMethod -Method Post -Uri $Uri -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 20
}

function Ensure-Enrollment {
  $config = Get-Config
  if (-not $config.ContainsKey("apiBaseUrl") -or [string]::IsNullOrWhiteSpace([string]$config["apiBaseUrl"])) {
    throw "apiBaseUrl nao configurado. Execute install.ps1 primeiro."
  }
  if ($config.ContainsKey("deviceId") -and $config.ContainsKey("deviceToken") -and
      -not [string]::IsNullOrWhiteSpace([string]$config["deviceId"]) -and
      -not [string]::IsNullOrWhiteSpace([string]$config["deviceToken"])) {
    return $config
  }
  if (-not $config.ContainsKey("enrollmentKey") -or [string]::IsNullOrWhiteSpace([string]$config["enrollmentKey"])) {
    throw "Dispositivo ainda nao matriculado e enrollmentKey nao existe no config."
  }

  $wbLogin = Get-NormalizedWbLogin -Config $config
  $payload = @{
    enrollmentKey = [string]$config["enrollmentKey"]
    wbLogin = $wbLogin
    hostname = $env:COMPUTERNAME
    deviceFingerprint = Get-DeviceFingerprint -Config $config
    os = Get-OSCaption
    agentVersion = $AgentVersion
  }
  $uri = Join-AgentUrl -BaseUrl ([string]$config["apiBaseUrl"]) -Path "/api/work-session/devices/enroll"
  $response = Invoke-AgentPost -Uri $uri -Payload $payload
  if (-not $response.success) {
    throw "Falha ao matricular dispositivo."
  }

  $config["deviceId"] = [string]$response.deviceId
  $config["deviceToken"] = [string]$response.deviceToken
  $config["employeeId"] = [string]$response.employeeId
  $config["wbLogin"] = [string]$response.wbLogin
  $config["deviceFingerprint"] = $payload.deviceFingerprint
  $config["agentVersion"] = $AgentVersion
  $config["enrolledAt"] = (Get-Date).ToUniversalTime().ToString("o")
  $config.Remove("enrollmentKey")
  Save-Config -Config $config
  Write-AgentLog -Message ("Dispositivo matriculado para WB/Login {0}." -f $config["wbLogin"])
  return $config
}

function New-AgentEventPayload {
  param([string]$Type, [datetime]$Timestamp, [hashtable]$Config)
  return @{
    wbLogin = Get-NormalizedWbLogin -Config $Config
    eventType = $Type
    eventTimestamp = $Timestamp.ToUniversalTime().ToString("o")
    timezone = Get-TimeZoneName
    hostname = $env:COMPUTERNAME
    os = Get-OSCaption
    agentVersion = $AgentVersion
  }
}

function Save-QueuedEvent {
  param([string]$Type, [datetime]$Timestamp)
  Initialize-AgentFolders
  $config = Get-Config
  $payload = New-AgentEventPayload -Type $Type -Timestamp $Timestamp -Config $config
  $fileName = "{0}_{1}_{2}.json" -f $Timestamp.ToString("yyyyMMddHHmmssfff"), $Type, ([guid]::NewGuid().ToString("N"))
  $path = Join-Path $QueueDir $fileName
  Save-JsonHashtable -Path $path -Data $payload
  Write-AgentLog -Message ("Evento enfileirado: {0}" -f $Type)
}

function Flush-Queue {
  Initialize-AgentFolders
  $config = Ensure-Enrollment
  $uri = Join-AgentUrl -BaseUrl ([string]$config["apiBaseUrl"]) -Path "/api/work-session/events"
  $files = Get-ChildItem -Path $QueueDir -Filter "*.json" -File | Sort-Object Name
  foreach ($file in $files) {
    try {
      $payload = Read-JsonHashtable -Path $file.FullName
      $payload["deviceId"] = [string]$config["deviceId"]
      $payload["deviceToken"] = [string]$config["deviceToken"]
      $payload["wbLogin"] = Get-NormalizedWbLogin -Config $config
      $response = Invoke-AgentPost -Uri $uri -Payload $payload
      if ($response.success) {
        Remove-Item -Path $file.FullName -Force
        Write-AgentLog -Message ("Evento enviado: {0}" -f $payload["eventType"])
      } else {
        throw "API recusou evento."
      }
    } catch {
      Write-AgentLog -Level "WARN" -Message ("Sem sincronizar agora. Evento mantido em fila. {0}" -f $_.Exception.Message)
      break
    }
  }
}

function Send-AgentEvent {
  param([string]$Type)
  Save-QueuedEvent -Type $Type -Timestamp (Get-Date)
  try {
    Flush-Queue
  } catch {
    Write-AgentLog -Level "WARN" -Message ("Fila mantida offline. {0}" -f $_.Exception.Message)
  }
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

function Start-AgentDaemon {
  Write-AgentLog -Message "Agent iniciado em modo daemon."
  Send-AgentEvent -Type "LOGIN"
  $lastTick = Get-Date
  while ($true) {
    $config = Get-Config
    $heartbeatSeconds = Get-ConfigInt -Config $config -Key "heartbeatSeconds" -DefaultValue 60
    $sleepDetectSeconds = Get-ConfigInt -Config $config -Key "sleepDetectSeconds" -DefaultValue 300
    Start-Sleep -Seconds $heartbeatSeconds
    $now = Get-Date
    $gapSeconds = ($now - $lastTick).TotalSeconds
    if ($gapSeconds -gt $sleepDetectSeconds) {
      Save-QueuedEvent -Type "SLEEP" -Timestamp ($lastTick.AddSeconds($heartbeatSeconds))
      Save-QueuedEvent -Type "WAKE" -Timestamp $now
    }
    Save-QueuedEvent -Type "HEARTBEAT" -Timestamp $now
    Flush-Queue
    $lastTick = $now
  }
}

try {
  Initialize-AgentFolders
  switch ($Mode) {
    "Enroll" {
      Ensure-Enrollment | Out-Null
      Flush-Queue
    }
    "Flush" {
      Flush-Queue
    }
    "Event" {
      Send-AgentEvent -Type $EventType
    }
    "Daemon" {
      Start-AgentDaemon
    }
  }
} catch {
  Write-AgentLog -Level "ERROR" -Message $_.Exception.Message
  exit 1
}
