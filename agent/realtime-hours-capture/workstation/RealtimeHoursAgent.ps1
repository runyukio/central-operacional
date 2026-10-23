<#
Central Operacional - Realtime Hours Workstation Agent 0.4.0

Runs silently in the interactive Windows session and sends:
- workstation presence/idle heartbeat;
- consolidated active domain/application intervals.

Privacy boundaries: no screenshots, keystrokes, clipboard, page content, typed text,
full URL, query string or browser title are persisted or uploaded.
#>

[CmdletBinding()]
param(
  [ValidateSet("Daemon", "Once", "Flush")]
  [string]$Mode = "Once",
  [string]$ConfigPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$AgentVersion = "0.4.0"
$DefaultRoot = Join-Path $env:ProgramData "CentralOperacional\RealtimeHoursAgent"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $DefaultRoot "config.json" }
$RootDir = Split-Path -Parent $ConfigPath
$QueueDir = Join-Path $RootDir "queue"
$ActivityQueueDir = Join-Path $QueueDir "activity"
$FailedDir = Join-Path $RootDir "failed"
$ActivityFailedDir = Join-Path $FailedDir "activity"
$LogDir = Join-Path $RootDir "logs"
$LogPath = Join-Path $LogDir "agent.log"
$script:CurrentSegment = $null
$script:UiAutomationReady = $null
$script:AgentMutex = $null

function Initialize-AgentFolders {
  foreach ($path in @($RootDir, $QueueDir, $ActivityQueueDir, $FailedDir, $ActivityFailedDir, $LogDir)) {
    if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
  }
}

function Write-AgentLog {
  param([string]$Message, [string]$Level = "INFO")
  try {
    Initialize-AgentFolders
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 5MB) {
      Move-Item -Path $LogPath -Destination (Join-Path $LogDir "agent.previous.log") -Force
    }
    Add-Content -Path $LogPath -Value ("{0} [{1}] {2}" -f (Get-Date).ToString("s"), $Level, $Message) -Encoding UTF8
  } catch {}
}

function Read-JsonObject {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $raw = Get-Content -Path $Path -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Save-JsonObject {
  param([string]$Path, [object]$Data)
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $Data | ConvertTo-Json -Depth 10 | Set-Content -Path $Path -Encoding UTF8
}

function Get-Config {
  $object = Read-JsonObject -Path $ConfigPath
  $hash = @{}
  if ($null -eq $object) { return $hash }
  foreach ($property in $object.PSObject.Properties) { $hash[$property.Name] = $property.Value }
  return $hash
}

function Get-ConfigString {
  param([hashtable]$Config, [string]$Key, [string]$DefaultValue = "")
  if ($Config.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Config[$Key])) { return [string]$Config[$Key] }
  return $DefaultValue
}

function Get-ConfigInt {
  param([hashtable]$Config, [string]$Key, [int]$DefaultValue)
  if ($Config.ContainsKey($Key)) {
    $value = 0
    if ([int]::TryParse([string]$Config[$Key], [ref]$value) -and $value -gt 0) { return $value }
  }
  return $DefaultValue
}

function Get-ConfigBool {
  param([hashtable]$Config, [string]$Key, [bool]$DefaultValue = $false)
  if (-not $Config.ContainsKey($Key)) { return $DefaultValue }
  return @("true", "1", "sim", "yes") -contains ([string]$Config[$Key]).Trim().ToLowerInvariant()
}

function Get-CloudToken {
  param([hashtable]$Config)
  $legacy = Get-ConfigString -Config $Config -Key "cloudToken"
  if (-not [string]::IsNullOrWhiteSpace($legacy)) { return $legacy }
  $protected = Get-ConfigString -Config $Config -Key "cloudTokenProtected"
  if ([string]::IsNullOrWhiteSpace($protected)) { return "" }
  try {
    Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
    $encryptedBytes = [Convert]::FromBase64String($protected)
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $encryptedBytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Text.Encoding]::UTF8.GetString($plainBytes)
  } catch {
    Write-AgentLog -Level "ERROR" -Message ("Falha ao descriptografar o token. {0}" -f $_.Exception.Message)
    return ""
  }
}

function Get-WindowsUserName {
  try {
    $candidate = (Get-CimInstance -ClassName Win32_ComputerSystem).UserName
    if ([string]::IsNullOrWhiteSpace($candidate)) { $candidate = $env:USERNAME }
  } catch { $candidate = $env:USERNAME }
  if ($candidate.Contains("\")) { $candidate = $candidate.Split("\")[-1] }
  return $candidate.Trim().ToLowerInvariant()
}

function Get-WbLogin {
  param([hashtable]$Config)
  $candidate = Get-ConfigString -Config $Config -Key "wbLogin"
  if ([string]::IsNullOrWhiteSpace($candidate)) { return Get-WindowsUserName }
  if ($candidate.Contains("\")) { $candidate = $candidate.Split("\")[-1] }
  return $candidate.Trim().ToLowerInvariant()
}

function Get-LocalIpv4 {
  try {
    $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
      Sort-Object InterfaceMetric, InterfaceIndex |
      Select-Object -First 1
    if ($address) { return [string]$address.IPAddress }
  } catch {}
  return ""
}

function Ensure-NativeMethods {
  if ("RealtimeHours.NativeMethods" -as [type]) { return }
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace RealtimeHours {
  public static class NativeMethods {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr hDesktop);
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
  } catch { Write-AgentLog -Level "WARN" -Message ("Falha ao medir inatividade. {0}" -f $_.Exception.Message) }
  return 0
}

function Test-SessionUnlocked {
  try {
    Ensure-NativeMethods
    $desktop = [RealtimeHours.NativeMethods]::OpenInputDesktop(0, $false, 0x0100)
    if ($desktop -eq [IntPtr]::Zero) { return $false }
    [RealtimeHours.NativeMethods]::CloseDesktop($desktop) | Out-Null
    return $true
  } catch { return $true }
}

function Get-ForegroundWindowInfo {
  $result = @{ handle = [IntPtr]::Zero; processName = ""; title = "" }
  try {
    Ensure-NativeMethods
    $handle = [RealtimeHours.NativeMethods]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { return $result }
    $result.handle = $handle
    [uint32]$processId = 0
    [RealtimeHours.NativeMethods]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
    if ($processId -gt 0) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) { $result.processName = [string]$process.ProcessName }
    }
    $builder = New-Object System.Text.StringBuilder 512
    [RealtimeHours.NativeMethods]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
    $result.title = $builder.ToString()
  } catch { Write-AgentLog -Level "WARN" -Message ("Falha ao ler janela ativa. {0}" -f $_.Exception.Message) }
  return $result
}

function Ensure-UiAutomation {
  if ($null -ne $script:UiAutomationReady) { return [bool]$script:UiAutomationReady }
  try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
    $script:UiAutomationReady = $true
  } catch {
    $script:UiAutomationReady = $false
    Write-AgentLog -Level "WARN" -Message "UI Automation indisponivel; navegador sera registrado apenas como aplicativo."
  }
  return [bool]$script:UiAutomationReady
}

function Test-BrowserProcess {
  param([string]$ProcessName)
  return @("chrome", "msedge", "firefox", "brave", "opera", "vivaldi") -contains $ProcessName.ToLowerInvariant()
}

function Test-PrivateBrowserWindow {
  param([string]$Title)
  if ([string]::IsNullOrWhiteSpace($Title)) { return $false }
  return $Title -match "(?i)(inprivate|incognito|anonimo|anônimo|navegacao privada|navegação privada|private browsing)"
}

function Get-BrowserAddressValue {
  param([IntPtr]$WindowHandle)
  if ($WindowHandle -eq [IntPtr]::Zero -or -not (Ensure-UiAutomation)) { return "" }
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    if ($null -eq $root) { return "" }
    $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $maximum = [Math]::Min($elements.Count, 80)
    for ($index = 0; $index -lt $maximum; $index++) {
      $element = $elements.Item($index)
      $automationId = [string]$element.Current.AutomationId
      $name = [string]$element.Current.Name
      $isAddressControl =
        $automationId -match "(?i)(address|urlbar|omnibox|location)" -or
        $name -match "(?i)(address and search bar|search or enter|search with .* or enter|barra de endere|endereco e pesquisa|endereço e pesquisa|pesquisar ou inserir|campo de endereco|campo de endereço)"
      if (-not $isAddressControl) { continue }
      try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $value = [string]$pattern.Current.Value
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
      } catch {}
    }
  } catch {}
  return ""
}

function Get-SanitizedDomain {
  param([string]$AddressValue)
  $candidate = $AddressValue.Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return "" }
  if ($candidate -match "(?i)^(chrome|edge|about|file|data|view-source|moz-extension|chrome-extension):") { return "" }
  try {
    if ($candidate -notmatch "^[a-z][a-z0-9+.-]*://") { $candidate = "https://$candidate" }
    $uri = New-Object System.Uri($candidate)
    $host = $uri.DnsSafeHost.Trim().TrimEnd(".").ToLowerInvariant()
    if ($host.StartsWith("www.")) { $host = $host.Substring(4) }
    if ($host.Length -gt 253 -or $host -notmatch "^[a-z0-9.-]+$") { return "" }
    return $host
  } catch { return "" }
}

function Get-ActivityContext {
  param([hashtable]$Config)
  $idleSeconds = Get-IdleSeconds
  $threshold = Get-ConfigInt -Config $Config -Key "activeThresholdSeconds" -DefaultValue 300
  if (-not (Test-SessionUnlocked)) { return @{ sourceType = "LOCKED"; applicationName = ""; domain = ""; idleSeconds = $idleSeconds } }
  if ($idleSeconds -ge $threshold) { return @{ sourceType = "IDLE"; applicationName = ""; domain = ""; idleSeconds = $idleSeconds } }

  $window = Get-ForegroundWindowInfo
  $processName = ([string]$window.processName).Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($processName)) { return @{ sourceType = "UNKNOWN"; applicationName = ""; domain = ""; idleSeconds = $idleSeconds } }

  if (Test-BrowserProcess -ProcessName $processName) {
    if (Test-PrivateBrowserWindow -Title ([string]$window.title)) {
      return @{ sourceType = "PRIVATE"; applicationName = $processName; domain = ""; idleSeconds = $idleSeconds }
    }
    if (Get-ConfigBool -Config $Config -Key "captureDomains" -DefaultValue $true) {
      $domain = Get-SanitizedDomain -AddressValue (Get-BrowserAddressValue -WindowHandle ([IntPtr]$window.handle))
      if (-not [string]::IsNullOrWhiteSpace($domain)) {
        return @{ sourceType = "WEB"; applicationName = $processName; domain = $domain; idleSeconds = $idleSeconds }
      }
    }
  }
  return @{ sourceType = "APP"; applicationName = $processName; domain = ""; idleSeconds = $idleSeconds }
}

function Get-ContextKey {
  param([hashtable]$Context)
  return "{0}|{1}|{2}" -f $Context.sourceType, $Context.applicationName, $Context.domain
}

function Start-Segment {
  param([hashtable]$Context, [datetime]$At)
  $script:CurrentSegment = [ordered]@{
    eventId = [guid]::NewGuid().ToString("N")
    key = Get-ContextKey -Context $Context
    sourceType = [string]$Context.sourceType
    applicationName = [string]$Context.applicationName
    domain = [string]$Context.domain
    startedAt = $At.ToUniversalTime()
  }
}

function New-ActivityRecord {
  param([hashtable]$Config, [datetime]$EndAt)
  if ($null -eq $script:CurrentSegment) { return $null }
  $startedAt = [datetime]$script:CurrentSegment.startedAt
  $endedAt = $EndAt.ToUniversalTime()
  if ($endedAt -le $startedAt) { return $null }
  return [ordered]@{
    eventId = [string]$script:CurrentSegment.eventId
    hostname = $env:COMPUTERNAME
    windowsUser = Get-WindowsUserName
    wbLogin = Get-WbLogin -Config $Config
    employeeId = Get-ConfigString -Config $Config -Key "employeeId"
    sourceType = [string]$script:CurrentSegment.sourceType
    applicationName = [string]$script:CurrentSegment.applicationName
    domain = [string]$script:CurrentSegment.domain
    startedAt = $startedAt.ToString("o")
    endedAt = $endedAt.ToString("o")
    durationSeconds = [int][Math]::Max(1, [Math]::Round(($endedAt - $startedAt).TotalSeconds))
    agentVersion = $AgentVersion
  }
}

function Save-ActivitySnapshot {
  param([hashtable]$Config, [datetime]$EndAt)
  $record = New-ActivityRecord -Config $Config -EndAt $EndAt
  if ($null -eq $record) { return }
  $payload = [ordered]@{ source = "direct-windows-agent"; capturedAt = (Get-Date).ToUniversalTime().ToString("o"); records = @($record) }
  $fileName = "activity_{0}_{1}.json" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff"), ([guid]::NewGuid().ToString("N"))
  Save-JsonObject -Path (Join-Path $ActivityQueueDir $fileName) -Data $payload
}

function Update-Segment {
  param([hashtable]$Config, [hashtable]$Context, [datetime]$At)
  if ($null -eq $script:CurrentSegment) { Start-Segment -Context $Context -At $At; return $false }
  $changed = (Get-ContextKey -Context $Context) -ne [string]$script:CurrentSegment.key
  $maximumSeconds = [Math]::Max(300, (Get-ConfigInt -Config $Config -Key "activityMaxSegmentSeconds" -DefaultValue 3600))
  $expired = ($At.ToUniversalTime() - [datetime]$script:CurrentSegment.startedAt).TotalSeconds -ge $maximumSeconds
  if ($changed -or $expired) {
    Save-ActivitySnapshot -Config $Config -EndAt $At
    Start-Segment -Context $Context -At $At
    return $true
  }
  return $false
}

function New-PresencePayload {
  param([hashtable]$Config, [hashtable]$Context)
  $idleSeconds = Get-IdleSeconds
  $threshold = Get-ConfigInt -Config $Config -Key "activeThresholdSeconds" -DefaultValue 300
  $unlocked = Test-SessionUnlocked
  $active = $unlocked -and $idleSeconds -lt $threshold
  $state = if (-not $unlocked) { "LOCKED" } elseif ($active) { "ACTIVE" } else { "IDLE" }
  return [ordered]@{
    source = "direct-windows-agent"
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    record = [ordered]@{
      eventId = [guid]::NewGuid().ToString("N")
      eventType = "HEARTBEAT"
      sessionState = $state
      hostname = $env:COMPUTERNAME
      windowsUser = Get-WindowsUserName
      wbLogin = Get-WbLogin -Config $Config
      employeeId = Get-ConfigString -Config $Config -Key "employeeId"
      ipAddress = Get-LocalIpv4
      isSessionActive = $active
      isInputActive = $active
      idleSeconds = $idleSeconds
      lastActivityAt = (Get-Date).AddSeconds(-1 * $idleSeconds).ToUniversalTime().ToString("o")
      activeProcessName = [string]$Context.applicationName
      activeWindowTitle = ""
      identitySource = Get-ConfigString -Config $Config -Key "identitySource" -DefaultValue "windows_user"
      identityConfidence = Get-ConfigString -Config $Config -Key "identityConfidence" -DefaultValue "MEDIUM"
      agentVersion = $AgentVersion
    }
  }
}

function Save-PresenceSnapshot {
  param([hashtable]$Config, [hashtable]$Context)
  $fileName = "presence_{0}_{1}.json" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff"), ([guid]::NewGuid().ToString("N"))
  Save-JsonObject -Path (Join-Path $QueueDir $fileName) -Data (New-PresencePayload -Config $Config -Context $Context)
}

function Resolve-Endpoint {
  param([string]$CloudUrl, [ValidateSet("presence", "activity")][string]$Kind)
  $normalized = $CloudUrl.TrimEnd("/")
  $path = if ($Kind -eq "activity") { "/api/realtime-hours/agent-activity" } else { "/api/realtime-hours/agent-snapshot" }
  if ($normalized -match "/api/realtime-hours/agent-(snapshot|activity)$") { return $normalized -replace "/api/realtime-hours/agent-(snapshot|activity)$", $path }
  if ($normalized -match "/api/") { return $normalized }
  return "{0}{1}" -f $normalized, $path
}

function Invoke-AgentPost {
  param([string]$Uri, [object]$Payload, [string]$Token)
  return Invoke-RestMethod -Method Post -Uri $Uri -Headers @{ Authorization = "Bearer $Token" } -Body ($Payload | ConvertTo-Json -Depth 10 -Compress) -ContentType "application/json; charset=utf-8" -TimeoutSec 15
}

function Get-HttpStatusCode {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)
  try { if ($ErrorRecord.Exception.Response.StatusCode) { return [int]$ErrorRecord.Exception.Response.StatusCode } } catch {}
  return $null
}

function Flush-QueueDirectory {
  param([hashtable]$Config, [string]$SourceDirectory, [string]$FailedDirectory, [ValidateSet("presence", "activity")][string]$Kind)
  $cloudUrl = Get-ConfigString -Config $Config -Key "cloudUrl"
  $token = Get-CloudToken -Config $Config
  if ([string]::IsNullOrWhiteSpace($cloudUrl) -or [string]::IsNullOrWhiteSpace($token)) { throw "Destino do Agent nao configurado." }
  $uri = Resolve-Endpoint -CloudUrl $cloudUrl -Kind $Kind
  foreach ($file in (Get-ChildItem -Path $SourceDirectory -Filter "*.json" -File | Sort-Object Name)) {
    try {
      $payload = Read-JsonObject -Path $file.FullName
      if ($null -eq $payload) { throw "JSON vazio ou invalido." }
    } catch {
      Move-Item -Path $file.FullName -Destination (Join-Path $FailedDirectory $file.Name) -Force
      Write-AgentLog -Level "ERROR" -Message ("Arquivo invalido movido para quarentena: {0}" -f $file.Name)
      continue
    }
    try {
      $response = Invoke-AgentPost -Uri $uri -Payload $payload -Token $token
      if ($null -eq $response -or -not [bool]$response.success) { throw "A Central recusou o payload." }
      Remove-Item -Path $file.FullName -Force
    } catch {
      $statusCode = Get-HttpStatusCode -ErrorRecord $_
      $permanent = $null -ne $statusCode -and $statusCode -ge 400 -and $statusCode -lt 500 -and $statusCode -notin @(408, 429)
      if ($permanent) {
        Move-Item -Path $file.FullName -Destination (Join-Path $FailedDirectory $file.Name) -Force
        Write-AgentLog -Level "ERROR" -Message ("Payload {0} recusado permanentemente (HTTP {1})." -f $Kind, $statusCode)
        continue
      }
      Write-AgentLog -Level "WARN" -Message ("Falha temporaria no envio {0}; arquivo mantido em fila. {1}" -f $Kind, $_.Exception.Message)
      break
    }
  }
}

function Flush-AllQueues {
  param([hashtable]$Config)
  Flush-QueueDirectory -Config $Config -SourceDirectory $QueueDir -FailedDirectory $FailedDir -Kind "presence"
  Flush-QueueDirectory -Config $Config -SourceDirectory $ActivityQueueDir -FailedDirectory $ActivityFailedDir -Kind "activity"
}

function Send-Once {
  Initialize-AgentFolders
  $config = Get-Config
  $context = Get-ActivityContext -Config $config
  Save-PresenceSnapshot -Config $config -Context $context
  if (Get-ConfigBool -Config $config -Key "activityEnabled" -DefaultValue $true) {
    Start-Segment -Context $context -At (Get-Date)
    Start-Sleep -Seconds ([Math]::Max(3, [Math]::Min(30, (Get-ConfigInt -Config $config -Key "activitySampleSeconds" -DefaultValue 5))))
    Save-ActivitySnapshot -Config $config -EndAt (Get-Date)
  }
  Flush-AllQueues -Config $config
}

function Start-Daemon {
  Initialize-AgentFolders
  $script:AgentMutex = New-Object System.Threading.Mutex($false, "Global\CentralOperacionalRealtimeHoursAgent")
  if (-not $script:AgentMutex.WaitOne(0, $false)) { Write-AgentLog -Level "WARN" -Message "Outra instancia do Agent ja esta em execucao."; return }
  Write-AgentLog -Message ("Agent {0} iniciado em modo silencioso." -f $AgentVersion)
  $lastHeartbeatAt = [datetime]::MinValue
  $lastUploadAt = [datetime]::MinValue

  try {
    while ($true) {
      $config = Get-Config
      if ($config.Count -eq 0) { throw "config.json nao encontrado ou vazio." }
      $now = Get-Date
      $sampleSeconds = [Math]::Max(3, [Math]::Min(30, (Get-ConfigInt -Config $config -Key "activitySampleSeconds" -DefaultValue 5)))
      $heartbeatSeconds = [Math]::Max(120, [Math]::Min(900, (Get-ConfigInt -Config $config -Key "heartbeatSeconds" -DefaultValue 120)))
      $uploadSeconds = [Math]::Max(30, [Math]::Min(600, (Get-ConfigInt -Config $config -Key "activityUploadSeconds" -DefaultValue 60)))
      $context = Get-ActivityContext -Config $config

      if (($now - $lastHeartbeatAt).TotalSeconds -ge $heartbeatSeconds) {
        try {
          Save-PresenceSnapshot -Config $config -Context $context
          Flush-QueueDirectory -Config $config -SourceDirectory $QueueDir -FailedDirectory $FailedDir -Kind "presence"
          $lastHeartbeatAt = $now
        } catch { Write-AgentLog -Level "WARN" -Message ("Ciclo de presenca com falha. {0}" -f $_.Exception.Message) }
      }

      if (Get-ConfigBool -Config $config -Key "activityEnabled" -DefaultValue $true) {
        try {
          $segmentChanged = Update-Segment -Config $config -Context $context -At $now
          if ($segmentChanged -or ($now - $lastUploadAt).TotalSeconds -ge $uploadSeconds) {
            Save-ActivitySnapshot -Config $config -EndAt $now
            Flush-QueueDirectory -Config $config -SourceDirectory $ActivityQueueDir -FailedDirectory $ActivityFailedDir -Kind "activity"
            $lastUploadAt = $now
          }
        } catch { Write-AgentLog -Level "WARN" -Message ("Ciclo de atividade com falha. {0}" -f $_.Exception.Message) }
      }
      Start-Sleep -Seconds $sampleSeconds
    }
  } finally {
    try {
      $config = Get-Config
      Save-ActivitySnapshot -Config $config -EndAt (Get-Date)
    } catch {}
    try { $script:AgentMutex.ReleaseMutex() | Out-Null; $script:AgentMutex.Dispose() } catch {}
    Write-AgentLog -Message "Agent encerrado."
  }
}

Initialize-AgentFolders
switch ($Mode) {
  "Daemon" { Start-Daemon }
  "Flush" { Flush-AllQueues -Config (Get-Config) }
  default { Send-Once }
}
