$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../installer/Enrollment-RealtimeHoursV2.ps1')
$script:calls = [Collections.ArrayList]::new()
function Invoke-RestMethod {
  param($Method, $Uri, $ContentType, $Body, $TimeoutSec)
  $payload = $Body | ConvertFrom-Json
  [void]$script:calls.Add($payload)
  if ($Uri -notlike 'https://example.test/api/realtime-hours/v2/enrollment-ticket') { throw 'Unexpected endpoint' }
  return [pscustomobject]@{ success = $true; enrollmentCode = ('C' * 31) + [string]$script:calls.Count; maxUses = 1 }
}
$legacy = Get-RealtimeOneTimeEnrollment -Enrollment ([pscustomobject]@{ enrollmentCode = 'legacy-single-use' }) -BaseUrl 'https://example.test' -ComputerName 'PC-1' -WindowsUser 'test'
if ($legacy -ne 'legacy-single-use' -or $script:calls.Count -ne 0) { throw 'Legacy enrollment changed' }
$fleet = [pscustomobject]@{ mode = 'fleet'; deploymentCode = 'A' * 32; expiresAt = $null }
Assert-RealtimeEnrollmentLifetime -Enrollment $fleet
$expiredRejected = $false
try { Assert-RealtimeEnrollmentLifetime -Enrollment ([pscustomobject]@{ enrollmentCode = 'old'; expiresAt = '2020-01-01T00:00:00Z' }) }
catch { $expiredRejected = $_.Exception.Message -like '*expirou*' }
if (-not $expiredRejected) { throw 'Expired legacy codes must stay rejected' }
$first = Get-RealtimeOneTimeEnrollment -Enrollment $fleet -BaseUrl 'https://example.test' -ComputerName 'PC-1' -WindowsUser 'user1'
$second = Get-RealtimeOneTimeEnrollment -Enrollment $fleet -BaseUrl 'https://example.test' -ComputerName 'PC-2' -WindowsUser 'user2'
if ($first -eq $second -or $script:calls.Count -ne 2) { throw 'Each machine must request its own ticket' }
if ($script:calls[0].hostname -ne 'PC-1' -or $script:calls[1].windowsUser -ne 'user2') { throw 'Machine identity was not forwarded' }
function Invoke-RestMethod {
  param($Method, $Uri, $ContentType, $Body, $TimeoutSec)
  $exception = [Exception]::new('HTTP error')
  $exception | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{ StatusCode = 401 })
  throw $exception
}
$rejected = $false
try { Get-RealtimeOneTimeEnrollment -Enrollment $fleet -BaseUrl 'https://example.test' -ComputerName 'PC-1' -WindowsUser 'user1' | Out-Null }
catch { $rejected = $_.Exception.Message -like '*Solicite o ZIP atualizado*' }
if (-not $rejected) { throw '401 must have an actionable message' }
Write-Host 'PASS: fleet tickets, machine binding, legacy package and 401 message'
