<#
Central Operacional - Realtime Hours Workstation Agent 0.5.1

Runs silently in the interactive Windows session and sends:
- workstation presence/idle heartbeat;
- consolidated active domain/application intervals.

Privacy boundaries: no screenshots, keystrokes, clipboard, page content, typed text,
full URL, query string or browser title are persisted or uploaded.
#>

[CmdletBinding()]
param(
  [ValidateSet("Daemon", "Once", "Flush", "Diagnose")]
  [string]$Mode = "Once",
  [string]$ConfigPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$AgentVersion = "0.5.1"
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
$script:LastDomainCaptureWarningAt = [datetime]::MinValue
$script:LastDomainCaptureDiagnostics = @{ status = "not-run"; windowElements = 0; processElements = 0; processId = 0 }

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
  $result = @{ handle = [IntPtr]::Zero; processId = 0; processName = ""; title = "" }
  try {
    Ensure-NativeMethods
    $handle = [RealtimeHours.NativeMethods]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { return $result }
    $result.handle = $handle
    [uint32]$processId = 0
    [RealtimeHours.NativeMethods]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
    $result.processId = [int]$processId
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

function Get-AutomationElementText {
  param([object]$Element)
  if ($null -eq $Element) { return "" }

  try {
    $patternObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$patternObject)) {
      $value = [string]([System.Windows.Automation.TextPattern]$patternObject).DocumentRange.GetText(2048)
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    }
  } catch {}

  try {
    $patternObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {
      $value = [string]([System.Windows.Automation.ValuePattern]$patternObject).Current.Value
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    }
  } catch {}

  try {
    $patternObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$patternObject)) {
      $value = [string]([System.Windows.Automation.LegacyIAccessiblePattern]$patternObject).Current.Value
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    }
  } catch {}

  return ""
}

function Get-AddressElementScore {
  param([object]$Element, [double]$WindowTop = 0)

  try { $automationId = [string]$Element.Current.AutomationId } catch { $automationId = "" }
  try { $name = [string]$Element.Current.Name } catch { $name = "" }
  try { $accessKey = [string]$Element.Current.AccessKey } catch { $accessKey = "" }
  try { $className = [string]$Element.Current.ClassName } catch { $className = "" }
  try { $controlType = [string]$Element.Current.ControlType.ProgrammaticName } catch { $controlType = "" }
  try { $isOffscreen = [bool]$Element.Current.IsOffscreen } catch { $isOffscreen = $false }
  try { $isPassword = [bool]$Element.Current.IsPassword } catch { $isPassword = $false }
  try { $bounds = $Element.Current.BoundingRectangle } catch { $bounds = $null }

  if ($isPassword) { return -1000 }

  $score = 0
  if ($automationId -match "(?i)^(addressEditBox|urlbar-input|omnibox|location)$") { $score += 240 }
  elseif ($automationId -match "(?i)(address|urlbar|omnibox|location|url)") { $score += 150 }

  if ($accessKey -match "(?i)(Ctrl\+L|Alt\+D|Ctrl\+E|F6)") { $score += 150 }

  if ($name -match "(?i)(address and search bar|search or enter web address|search with .* or enter address|barra de endere[cç]os?( e pesquisa| e busca)?|endere[cç]o e pesquisa|pesquisar ou inserir endere[cç]o|campo de endere[cç]o|barra de navega[cç][aã]o|url bar|location bar|omnibox)") {
    $score += 140
  }

  if ($className -match "(?i)(omnibox|address|urlbar|location)") { $score += 100 }
  if ($controlType -match "(?i)(Edit|Document|ComboBox)") { $score += 25 }

  if ($null -ne $bounds) {
    try {
      if ($bounds.Width -ge 180) { $score += 10 }
      if ($WindowTop -ge 0 -and $bounds.Top -ge $WindowTop -and $bounds.Top -le ($WindowTop + 220)) { $score += 30 }
    } catch {}
  }

  if ($isOffscreen) { $score -= 120 }
  return $score
}

function Select-BrowserAddressValue {
  param(
    [object]$Elements,
    [double]$WindowTop = 0,
    [int]$MaximumElements = 1200
  )

  if ($null -eq $Elements) { return "" }
  try { $count = [int]$Elements.Count } catch { return "" }
  $maximum = [Math]::Min($count, $MaximumElements)
  $bestScore = -1
  $bestValue = ""

  for ($index = 0; $index -lt $maximum; $index++) {
    try { $element = $Elements.Item($index) } catch { continue }
    $score = Get-AddressElementScore -Element $element -WindowTop $WindowTop
    if ($score -lt 80) { continue }

    $value = Get-AutomationElementText -Element $element
    if ([string]::IsNullOrWhiteSpace($value)) { continue }

    $domain = Get-SanitizedDomain -AddressValue $value
    if ([string]::IsNullOrWhiteSpace($domain)) { continue }

    $score += 100
    if ($score -gt $bestScore) {
      $bestScore = $score
      $bestValue = $value
    }
  }

  return $bestValue
}

function Get-BrowserAddressValue {
  param(
    [IntPtr]$WindowHandle,
    [int]$ProcessId = 0
  )

  $script:LastDomainCaptureDiagnostics = @{ status = "starting"; windowElements = 0; processElements = 0; processId = $ProcessId }
  if ($WindowHandle -eq [IntPtr]::Zero) {
    $script:LastDomainCaptureDiagnostics.status = "no-window"
    return ""
  }
  if (-not (Ensure-UiAutomation)) {
    $script:LastDomainCaptureDiagnostics.status = "uia-unavailable"
    return ""
  }

  $windowElementCount = 0
  $processElementCount = 0
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    if ($null -ne $root) {
      try { $windowTop = [double]$root.Current.BoundingRectangle.Top } catch { $windowTop = 0 }
      $windowElements = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      try { $windowElementCount = [int]$windowElements.Count } catch {}
      $script:LastDomainCaptureDiagnostics.windowElements = $windowElementCount
      $value = Select-BrowserAddressValue -Elements $windowElements -WindowTop $windowTop
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        $script:LastDomainCaptureDiagnostics.status = "found-window"
        return $value
      }
    }

    if ($ProcessId -gt 0) {
      $processCondition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $ProcessId
      )
      $processElements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        $processCondition
      )
      try { $processElementCount = [int]$processElements.Count } catch {}
      $script:LastDomainCaptureDiagnostics.processElements = $processElementCount
      $value = Select-BrowserAddressValue -Elements $processElements -WindowTop 0 -MaximumElements 1800
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        $script:LastDomainCaptureDiagnostics.status = "found-process"
        return $value
      }
    }
  } catch {
    if (((Get-Date) - $script:LastDomainCaptureWarningAt).TotalMinutes -ge 5) {
      Write-AgentLog -Level "WARN" -Message ("Falha na leitura da barra de enderecos via UI Automation. {0}" -f $_.Exception.Message)
      $script:LastDomainCaptureWarningAt = Get-Date
    }
    $script:LastDomainCaptureDiagnostics.status = "error"
    return ""
  }

  $script:LastDomainCaptureDiagnostics.status = "not-found"
  if (((Get-Date) - $script:LastDomainCaptureWarningAt).TotalMinutes -ge 5) {
    Write-AgentLog -Level "WARN" -Message (
      "Navegador detectado, mas a barra de enderecos nao foi localizada. windowElements={0}; processElements={1}; processId={2}" -f
      $windowElementCount, $processElementCount, $ProcessId
    )
    $script:LastDomainCaptureWarningAt = Get-Date
  }
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
      $domain = Get-SanitizedDomain -AddressValue (Get-BrowserAddressValue -WindowHandle ([IntPtr]$window.handle) -ProcessId ([int]$window.processId))
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
  "Diagnose" {
    $config = Get-Config
    $context = Get-ActivityContext -Config $config
    [pscustomobject]@{
      AgentVersion = $AgentVersion
      Computer = $env:COMPUTERNAME
      WindowsUser = Get-WindowsUserName
      SourceType = [string]$context.sourceType
      ApplicationName = [string]$context.applicationName
      Domain = [string]$context.domain
      IdleSeconds = [int]$context.idleSeconds
      UiAutomationAvailable = Ensure-UiAutomation
      DomainCaptureStatus = [string]$script:LastDomainCaptureDiagnostics.status
      WindowElements = [int]$script:LastDomainCaptureDiagnostics.windowElements
      ProcessElements = [int]$script:LastDomainCaptureDiagnostics.processElements
      BrowserProcessId = [int]$script:LastDomainCaptureDiagnostics.processId
    } | Format-List
  }
  default { Send-Once }
}
