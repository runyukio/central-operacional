$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../installer/Sessions-RealtimeHoursV2.ps1')
$name = 'RH-V2-Session-Regression-' + [guid]::NewGuid().ToString('N')
$directory = Join-Path $env:TEMP $name
New-Item -ItemType Directory -Path $directory | Out-Null
try {
  Register-RealtimeSessionTask -TaskName $name -Exe "$env:SystemRoot\System32\cmd.exe" -InstallDir $directory | Out-Null
  [xml]$xml = Export-ScheduledTask -TaskName $name
  $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
  $group = $xml.SelectSingleNode('//t:Principal/t:GroupId', $ns).InnerText
  if ($group -ne 'S-1-5-4') { throw 'Task must run in the interactive group.' }
  if ($xml.SelectSingleNode('//t:MultipleInstancesPolicy', $ns).InnerText -ne 'StopExisting') { throw 'Task must replace the previous session collector.' }
  $logon = $xml.SelectSingleNode('//t:LogonTrigger', $ns)
  if ($null -eq $logon -or $null -ne $logon.SelectSingleNode('t:UserId', $ns)) { throw 'Logon must include all Windows users.' }
  $changes = @($xml.SelectNodes('//t:SessionStateChangeTrigger/t:StateChange', $ns) | ForEach-Object { $_.InnerText })
  foreach ($required in @('ConsoleConnect','RemoteConnect','SessionUnlock')) {
    if ($changes -notcontains $required) { throw "Missing reconnect trigger: $required" }
  }
  if (@(Get-ScheduledTask -TaskName $name).Count -ne 1) { throw 'Exactly one task is required.' }
  Write-Host 'PASS: any-user logon, user switching, reconnect, unlock and one-task policy'
} finally {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
}
