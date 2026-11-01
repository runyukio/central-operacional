function Assert-RealtimeEnrollmentLifetime {
  param([object]$Enrollment)
  $isFleet = $null -ne $Enrollment.PSObject.Properties['deploymentCode']
  if ($isFleet -and $null -ne $Enrollment.PSObject.Properties['expiresAt'] -and $null -eq $Enrollment.expiresAt) { return }
  if ([DateTimeOffset]::Parse([string]$Enrollment.expiresAt) -le [DateTimeOffset]::UtcNow) {
    throw 'Este pacote de instalacao expirou. Solicite um novo pacote.'
  }
}

function Invoke-RealtimeEnrollmentRequest {
  param([string]$Uri, [string]$Body)
  try {
    return Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json' -Body $Body -TimeoutSec 30
  } catch {
    $responseProperty = $_.Exception.PSObject.Properties['Response']
    if ($null -ne $responseProperty -and $null -ne $responseProperty.Value -and [int]$responseProperty.Value.StatusCode -eq 401) {
      throw 'A autorizacao deste pacote expirou, foi revogada ou ja foi utilizada. Solicite o ZIP atualizado para novas instalacoes.'
    }
    throw
  }
}

function Get-RealtimeOneTimeEnrollment {
  param([object]$Enrollment, [string]$BaseUrl, [string]$ComputerName, [string]$WindowsUser)
  $deploymentProperty = $Enrollment.PSObject.Properties['deploymentCode']
  if ($null -eq $deploymentProperty) {
    return [string]$Enrollment.enrollmentCode
  }
  if ([string]$deploymentProperty.Value -notmatch '^[A-Za-z0-9_-]{32}$') { throw 'Autorizacao do pacote invalida.' }
  $body = @{ deploymentCode = [string]$deploymentProperty.Value; hostname = $ComputerName; windowsUser = $WindowsUser } | ConvertTo-Json -Compress
  $ticket = Invoke-RealtimeEnrollmentRequest -Uri "$($BaseUrl.TrimEnd('/'))/api/realtime-hours/v2/enrollment-ticket" -Body $body
  if (-not $ticket.success -or [string]$ticket.enrollmentCode -notmatch '^[A-Za-z0-9_-]{32}$' -or $ticket.maxUses -ne 1) {
    throw 'A Central nao autorizou o cadastro individual desta maquina.'
  }
  return [string]$ticket.enrollmentCode
}
