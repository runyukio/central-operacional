param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-EnvOrDefault {
  param([string]$Name, [string]$Default)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}

function Import-EnvFile {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#")) { return }
    $index = $line.IndexOf("=")
    if ($index -lt 1) { return }
    $name = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Import-EnvFile (Get-EnvOrDefault "CEC_ENV_FILE" (Join-Path $HomeDir ".cec_env"))

$ReportUrl = Get-EnvOrDefault "CEC_NORMAL_REPORT_URL" "https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d"
$CookieFile = Get-EnvOrDefault "CEC_COOKIE_FILE" (Join-Path $HomeDir ".freshdesk_cookie")
$SiteUrl = (Get-EnvOrDefault "REALTIME_SITE_URL" "").TrimEnd("/")
$ImportToken = Get-EnvOrDefault "REALTIME_IMPORT_TOKEN" ""
$OutputDir = Get-EnvOrDefault "CEC_OUTPUT_DIR" (Join-Path $HomeDir "CEC")
$TransformScript = Get-EnvOrDefault "CEC_TRANSFORM_SCRIPT" (Join-Path $ScriptDir "cec-scheduled-report-transform.js")
$CurlBin = Get-EnvOrDefault "CEC_CURL_BIN" "curl.exe"
$Retries = [Math]::Max(1, [int](Get-EnvOrDefault "CEC_DOWNLOAD_RETRIES" "3"))
$RetryDelaySeconds = [Math]::Max(1, [int](Get-EnvOrDefault "CEC_RETRY_DELAY_SECONDS" "15"))
$UploadEnabled = (Get-EnvOrDefault "CEC_UPLOAD_ENABLED" "true").ToLowerInvariant() -eq "true"
$LockDir = Join-Path $OutputDir ".cec-download.lock"
$TempFiles = New-Object System.Collections.Generic.List[string]

function Get-CecCycle {
  $now = Get-Date
  $minute = if ($now.Minute -ge 30) { "30" } else { "00" }
  return $now.ToString("yyyy-MM-dd HH:") + $minute
}

function Find-DownloadUrl {
  param($Value, [string]$PropertyName = "", [int]$Depth = 0)
  if ($Depth -gt 8 -or $null -eq $Value) { return $null }
  if ($Value -is [string]) {
    if ($Value -match '^https?://' -and $PropertyName -match '(?i)(download|file|url|path)') { return $Value }
    return $null
  }
  if ($Value -is [System.Collections.IEnumerable] -and !($Value -is [pscustomobject])) {
    foreach ($item in $Value) {
      $found = Find-DownloadUrl $item $PropertyName ($Depth + 1)
      if ($found) { return $found }
    }
    return $null
  }
  foreach ($property in $Value.PSObject.Properties) {
    $found = Find-DownloadUrl $property.Value $property.Name ($Depth + 1)
    if ($found) { return $found }
  }
  return $null
}

function Invoke-Download {
  param([string]$Url, [string]$Destination, [string]$Cookie)
  $headers = [System.IO.Path]::GetTempFileName()
  $TempFiles.Add($headers) | Out-Null
  $arguments = @(
    "-sS", "-L", "-D", $headers, "-o", $Destination, "-w", "%{http_code}",
    "-H", "Accept: */*",
    "-H", "Cache-Control: no-cache",
    "-H", "Pragma: no-cache",
    "-H", "Referer: https://kuaishousupport.freshdesk.com/",
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    "-H", "Cookie: $Cookie",
    $Url
  )
  $statusCode = & $CurlBin @arguments
  if ($LASTEXITCODE -ne 0) { throw "Falha de rede (curl $LASTEXITCODE)." }
  if ([int]$statusCode -lt 200 -or [int]$statusCode -ge 300) { throw "Freshdesk respondeu HTTP $statusCode." }
}

if (!(Test-Path -LiteralPath $CookieFile)) { throw "Cookie Freshdesk não encontrado: $CookieFile" }
if (!(Test-Path -LiteralPath $TransformScript)) { throw "Transformador CEC não encontrado: $TransformScript" }
if ($UploadEnabled -and ([string]::IsNullOrWhiteSpace($SiteUrl) -or [string]::IsNullOrWhiteSpace($ImportToken))) {
  throw "REALTIME_SITE_URL e REALTIME_IMPORT_TOKEN são obrigatórios para o upload CEC."
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
try {
  New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
} catch {
  Write-Host "Outro download CEC já está em execução; este ciclo será ignorado."
  exit 0
}

try {
  $cookie = (Get-Content -LiteralPath $CookieFile -Raw).Replace("`r", "").Replace("`n", "").Trim()
  $rawFile = [System.IO.Path]::GetTempFileName()
  $TempFiles.Add($rawFile) | Out-Null
  $lastError = $null

  for ($attempt = 1; $attempt -le $Retries; $attempt += 1) {
    try {
      Write-Host "Baixando Backlog Normal CEC (tentativa $attempt/$Retries)..."
      Invoke-Download $ReportUrl $rawFile $cookie
      $preview = Get-Content -LiteralPath $rawFile -Raw -ErrorAction SilentlyContinue
      if ($null -eq $preview) { $preview = "" }
      if ($preview -match '"require_login"\s*:\s*true') { throw "Sessão Freshdesk expirada; atualize $CookieFile." }

      if ($preview.TrimStart().StartsWith("{")) {
        try {
          $responseJson = $preview | ConvertFrom-Json
          $downloadUrl = Find-DownloadUrl $responseJson
          if ($downloadUrl) {
            Write-Host "Baixando arquivo gerado pelo Freshdesk..."
            Invoke-Download $downloadUrl $rawFile $cookie
          }
        } catch {
          if ($_.Exception.Message -like "*Sessão Freshdesk expirada*") { throw }
        }
      }
      $lastError = $null
      break
    } catch {
      $lastError = $_.Exception.Message
      Write-Host "Falha no download CEC: $lastError"
      if ($attempt -lt $Retries) { Start-Sleep -Seconds ($RetryDelaySeconds * $attempt) }
    }
  }
  if ($lastError) { throw $lastError }

  $latestRaw = Join-Path $OutputDir "cec_backlog_normal_latest.dat"
  $payloadFile = Join-Path $OutputDir "cec_backlog_normal_latest.json"
  Copy-Item -LiteralPath $rawFile -Destination $latestRaw -Force
  & node $TransformScript $latestRaw $payloadFile (Get-CecCycle)
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível interpretar ticket, agent name e status." }

  if ($UploadEnabled) {
    Write-Host "Enviando snapshot CEC para o site..."
    $uploadResponse = [System.IO.Path]::GetTempFileName()
    $TempFiles.Add($uploadResponse) | Out-Null
    $uploadArgs = @(
      "-sS", "-L", "-o", $uploadResponse, "-w", "%{http_code}",
      "-X", "POST", "$SiteUrl/api/realtime/cec/import",
      "-H", "Authorization: Bearer $ImportToken",
      "-H", "Content-Type: application/json",
      "--data-binary", "@$payloadFile"
    )
    $uploadStatus = & $CurlBin @uploadArgs
    if ($LASTEXITCODE -ne 0 -or [int]$uploadStatus -lt 200 -or [int]$uploadStatus -ge 300) {
      $uploadMessage = Get-Content -LiteralPath $uploadResponse -Raw -ErrorAction SilentlyContinue
      throw "Upload CEC falhou (HTTP $uploadStatus). $uploadMessage"
    }
    Write-Host "CEC atualizado com sucesso no ciclo $(Get-CecCycle)."
  }
} finally {
  foreach ($file in $TempFiles) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $LockDir -Force -Recurse -ErrorAction SilentlyContinue
}
