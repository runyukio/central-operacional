param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$QueueUrl = "https://kap.sgp-adm.corp.kuaishou.com/aias-data-engine/queue/stat/detailList/export"
$AuditorUrl = "https://kap.sgp-adm.corp.kuaishou.com/aias-data-engine/auditor/stat/detailList/export"
$Referer = "https://kap.sgp-adm.corp.kuaishou.com/data-center/overview"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-EnvOrDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Default
  )

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }
  return $value
}

function Import-KapEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
      return
    }

    $index = $line.IndexOf("=")
    if ($index -lt 1) {
      return
    }

    $name = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$EnvFile = Get-EnvOrDefault "KAP_ENV_FILE" (Join-Path $HomeDir ".kap_env")
Import-KapEnvFile $EnvFile

$CookieFile = Get-EnvOrDefault "KAP_COOKIE_FILE" (Join-Path $HomeDir ".kap_cookie")
$QueueBodyFile = Get-EnvOrDefault "KAP_QUEUE_BODY_FILE" (Get-EnvOrDefault "KAP_BODY_FILE" (Join-Path $HomeDir ".kap_body.json"))
$AuditorBodyFile = Get-EnvOrDefault "KAP_AUDITOR_BODY_FILE" (Join-Path $HomeDir ".kap_auditor_body.json")
$OutputDir = Get-EnvOrDefault "KAP_OUTPUT_DIR" (Join-Path $HomeDir "KAP")
$TransformScript = Get-EnvOrDefault "KAP_TRANSFORM_SCRIPT" (Join-Path $ScriptDir "kap-transform.js")
$BundleScript = Get-EnvOrDefault "KAP_BUNDLE_SCRIPT" (Join-Path $ScriptDir "kap-realtime-bundle.js")
$CurlBin = Get-EnvOrDefault "KAP_CURL_BIN" "curl.exe"
$DownloadRetries = [int](Get-EnvOrDefault "KAP_DOWNLOAD_RETRIES" "3")
$RetryDelaySeconds = [int](Get-EnvOrDefault "KAP_RETRY_DELAY_SECONDS" "15")
$AllowedMinutes = Get-EnvOrDefault "KAP_ALLOWED_MINUTES" "00,10,20,30,40,50"
$EnforceAllowedMinuteSlots = (Get-EnvOrDefault "KAP_ENFORCE_ALLOWED_MINUTE_SLOTS" "true").ToLowerInvariant()
$Now = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$RunMinute = Get-Date -Format "mm"
$TempFiles = New-Object System.Collections.Generic.List[string]
$LockDir = ""

function Get-KapCycleDownload {
  $minuteNumber = [int]$RunMinute
  $cycleMinute = "00"
  if ($minuteNumber -ge 30) {
    $cycleMinute = "30"
  }
  return "$(Get-Date -Format "yyyy-MM-dd HH"):$cycleMinute"
}

$KapCycleDownload = Get-EnvOrDefault "KAP_CYCLE_DOWNLOAD" (Get-KapCycleDownload)

if ($EnforceAllowedMinuteSlots -eq "true") {
  $allowed = $AllowedMinutes.Split(",") | ForEach-Object { $_.Trim() }
  if ($allowed -notcontains $RunMinute) {
    Write-Host "Skipping KAP download: current minute $RunMinute is outside allowed minute slots ($AllowedMinutes)."
    exit 0
  }
}

if ($DownloadRetries -lt 1) {
  $DownloadRetries = 3
}
if ($RetryDelaySeconds -lt 1) {
  $RetryDelaySeconds = 15
}

function Remove-TempFiles {
  foreach ($file in $TempFiles) {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
  if (![string]::IsNullOrWhiteSpace($LockDir) -and (Test-Path -LiteralPath $LockDir)) {
    Remove-Item -LiteralPath $LockDir -Force -ErrorAction SilentlyContinue
  }
}

function Test-CookieFreshness {
  $maxAgeHours = [int](Get-EnvOrDefault "KAP_COOKIE_MAX_AGE_HOURS" "72")
  if ($maxAgeHours -le 0 -or !(Test-Path -LiteralPath $CookieFile)) {
    return
  }

  $age = (New-TimeSpan -Start (Get-Item -LiteralPath $CookieFile).LastWriteTime -End (Get-Date)).TotalHours
  if ($age -ge $maxAgeHours) {
    Write-Host ("Cookie KAP has {0:N0} hour(s); refresh recommended (limit: {1} h)." -f $age, $maxAgeHours)
  }
}

function Save-FailureArtifacts {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Reason,
    [Parameter(Mandatory = $true)][string]$HeadersFile,
    [Parameter(Mandatory = $true)][string]$ResponseFile
  )

  $failureDir = Get-EnvOrDefault "KAP_FAILURE_DIR" (Join-Path (Join-Path $OutputDir "logs") "failures")
  New-Item -ItemType Directory -Path $failureDir -Force | Out-Null
  $stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
  $headersCopy = Join-Path $failureDir "${Label}_${stamp}_headers.txt"
  $responseCopy = Join-Path $failureDir "${Label}_${stamp}_response.txt"
  Copy-Item -LiteralPath $HeadersFile -Destination $headersCopy -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $ResponseFile -Destination $responseCopy -Force -ErrorAction SilentlyContinue
  Write-Host "$Label final failure: $Reason"
  Write-Host "Saved failure headers: $headersCopy"
  Write-Host "Saved failure response: $responseCopy"
}

function Get-QueueBodySource {
  if (Test-Path -LiteralPath $QueueBodyFile) {
    return $QueueBodyFile
  }

  $fallbackBody = [System.IO.Path]::GetTempFileName()
  $TempFiles.Add($fallbackBody) | Out-Null
  Set-Content -LiteralPath $fallbackBody -Value '{"queueIds":[13222],"skillGroupCodeList":[],"skillGroupQueueIds":[]}' -Encoding UTF8
  return $fallbackBody
}

function Get-ContentTypeFromHeaders {
  param([Parameter(Mandatory = $true)][string]$HeadersFile)

  if (!(Test-Path -LiteralPath $HeadersFile)) {
    return ""
  }

  $line = Get-Content -LiteralPath $HeadersFile | Where-Object { $_ -match "(?i)^content-type:" } | Select-Object -Last 1
  if ($null -eq $line) {
    return ""
  }
  return $line.Trim()
}

function Invoke-KapReportDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$BodySource,
    [Parameter(Mandatory = $true)][string]$Cookie
  )

  $attempt = 1
  $failureReason = ""
  $outFile = ""
  $headersFile = ""

  while ($attempt -le $DownloadRetries) {
    $outFile = [System.IO.Path]::GetTempFileName()
    $headersFile = [System.IO.Path]::GetTempFileName()
    $TempFiles.Add($outFile) | Out-Null
    $TempFiles.Add($headersFile) | Out-Null

    Write-Host "Downloading $Label (attempt $attempt/$DownloadRetries)..."

    $curlArgs = @(
      "-sS",
      "-D", $headersFile,
      "-o", $outFile,
      "-w", "%{http_code}",
      "-X", "POST", $Url,
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", "Accept-Language: en",
      "-H", "Cache-Control: no-cache",
      "-H", "Pragma: no-cache",
      "-H", "Origin: https://kap.sgp-adm.corp.kuaishou.com",
      "-H", "Referer: $Referer",
      "-H", "kapApiUriLocation: $Referer",
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "-H", "Cookie: $Cookie",
      "--data-binary", "@$BodySource"
    )

    $httpCode = & $CurlBin @curlArgs
    $curlStatus = $LASTEXITCODE
    $contentType = Get-ContentTypeFromHeaders $headersFile

    if ($curlStatus -ne 0) {
      $failureReason = "curl exit $curlStatus"
    } elseif ($httpCode -ne "200") {
      $failureReason = "HTTP $httpCode"
    } elseif ($contentType -notlike "*spreadsheetml.sheet*") {
      $failureReason = "response is not an Excel file ($contentType)"
    } else {
      $failureReason = ""
      break
    }

    Write-Host "$Label download failed on attempt $attempt/$DownloadRetries`: $failureReason"
    if ($attempt -lt $DownloadRetries) {
      Start-Sleep -Seconds ($RetryDelaySeconds * $attempt)
    }
    $attempt += 1
  }

  if (![string]::IsNullOrWhiteSpace($failureReason)) {
    Save-FailureArtifacts $Label $failureReason $headersFile $outFile
    exit 1
  }

  Write-Host "$Label download complete:"
  Write-Host "temporary file ready"

  if ((Get-EnvOrDefault "KAP_WRITE_LAYOUT_HISTORY" "false").ToLowerInvariant() -eq "true" -and (Test-Path -LiteralPath $TransformScript)) {
    & node $TransformScript $Label $outFile $Now
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } elseif ((Get-EnvOrDefault "KAP_WRITE_LAYOUT_HISTORY" "false").ToLowerInvariant() -eq "true") {
    Write-Host "Transform script not found, skipping layout generation: $TransformScript"
  }

  return $outFile
}

try {
  if (!(Test-Path -LiteralPath $CookieFile)) {
    Write-Host "Cookie file not found: $CookieFile"
    Write-Host "Create it with the full value copied after the browser Cookie header."
    exit 1
  }
  if (!(Test-Path -LiteralPath $AuditorBodyFile)) {
    Write-Host "Auditor body file not found: $AuditorBodyFile"
    Write-Host "Create it with the JSON body copied from the auditor export request."
    exit 1
  }

  Test-CookieFreshness
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $OutputDir "logs") -Force | Out-Null

  $LockDir = Get-EnvOrDefault "KAP_LOCK_DIR" (Join-Path $OutputDir ".kap-download.lock")
  try {
    New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
  } catch {
    Write-Host "Another KAP download is already running; skipping this cycle."
    exit 0
  }

  $Cookie = (Get-Content -LiteralPath $CookieFile -Raw).Replace("`r", "").Replace("`n", "")
  $QueueBodySource = Get-QueueBodySource

  $QueueOutputFile = Invoke-KapReportDownload "queue" $QueueUrl $QueueBodySource $Cookie
  $AuditorOutputFile = Invoke-KapReportDownload "auditor" $AuditorUrl $AuditorBodyFile $Cookie

  $RealtimeXlsx = Get-EnvOrDefault "KAP_REALTIME_OUTPUT_FILE" (Join-Path $OutputDir "realtime_kap.xlsx")
  if (Test-Path -LiteralPath $BundleScript) {
    Write-Host "Building Real Time workbook..."
    & node $BundleScript $QueueOutputFile $AuditorOutputFile $Now $RealtimeXlsx
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } else {
    Write-Host "Bundle script not found, skipping Real Time workbook: $BundleScript"
    $RealtimeXlsx = ""
  }

  if ((Get-EnvOrDefault "KAP_UPLOAD_ENABLED" "false").ToLowerInvariant() -eq "true") {
    $RealtimeSiteUrl = Get-EnvOrDefault "REALTIME_SITE_URL" ""
    $RealtimeImportToken = Get-EnvOrDefault "REALTIME_IMPORT_TOKEN" ""
    if ([string]::IsNullOrWhiteSpace($RealtimeXlsx) -or !(Test-Path -LiteralPath $RealtimeXlsx)) {
      Write-Host "Real Time workbook not found; upload skipped."
      exit 1
    }
    if ([string]::IsNullOrWhiteSpace($RealtimeSiteUrl) -or [string]::IsNullOrWhiteSpace($RealtimeImportToken)) {
      Write-Host "REALTIME_SITE_URL and REALTIME_IMPORT_TOKEN are required when KAP_UPLOAD_ENABLED=true."
      exit 1
    }

    $uploadAttempt = 1
    $uploadResponse = ""
    $uploadSucceeded = $false
    while ($uploadAttempt -le $DownloadRetries) {
      Write-Host "Uploading Real Time workbook (attempt $uploadAttempt/$DownloadRetries)..."
      $uploadArgs = @(
        "-sS",
        "--http1.1",
        "-X", "POST", "$($RealtimeSiteUrl.TrimEnd('/'))/api/realtime/import",
        "-H", "Authorization: Bearer $RealtimeImportToken",
        "-F", "source=kap-local",
        "-F", "file=@$RealtimeXlsx;filename=$(Split-Path -Leaf $RealtimeXlsx);type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
      $uploadResponse = & $CurlBin @uploadArgs
      $uploadStatus = $LASTEXITCODE

      if ($uploadStatus -eq 0) {
        try {
          $uploadJson = $uploadResponse | ConvertFrom-Json
          if ($uploadJson.success -eq $true) {
            $uploadSucceeded = $true
            break
          }
        } catch {
          # Keep raw response below.
        }
      }

      Write-Host "Upload failed on attempt $uploadAttempt/$DownloadRetries."
      if (![string]::IsNullOrWhiteSpace($uploadResponse)) {
        Write-Host $uploadResponse
      }
      if ($uploadAttempt -lt $DownloadRetries) {
        Start-Sleep -Seconds ($RetryDelaySeconds * $uploadAttempt)
      }
      $uploadAttempt += 1
    }

    Write-Host $uploadResponse
    if (!$uploadSucceeded) {
      exit 1
    }
  }

  if ((Get-EnvOrDefault "KAP_RUN_CEC" "false").ToLowerInvariant() -eq "true") {
    Write-Host "CEC automation is disabled in the Windows MVP. Keep KAP_RUN_CEC=false until CEC is re-enabled."
  }
} finally {
  Remove-TempFiles
}
