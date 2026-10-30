$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run this regression test with Windows PowerShell 5.1 (powershell.exe).' }
. (Join-Path $PSScriptRoot '../installer/Windows-CredentialProtection.ps1')
Initialize-WindowsCredentialProtection
$plain = [Text.Encoding]::UTF8.GetBytes('realtime-hours-v2-windows-dpapi-regression')
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
$restored = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
if ([Convert]::ToBase64String($plain) -cne [Convert]::ToBase64String($restored)) { throw 'DPAPI roundtrip failed.' }
$installer = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../installer/Install-RealtimeHoursV2.ps1') -Raw
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($installer, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Installer syntax must be valid.' }
$preflight = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Initialize-WindowsCredentialProtection' }, $true))
$enroll = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -in @('Get-RealtimeOneTimeEnrollment', 'Invoke-RealtimeEnrollmentRequest') }, $true))
if ($preflight.Count -ne 1 -or $enroll.Count -lt 1) { throw 'The protection and enrollment checkpoints must be present.' }
foreach ($command in $enroll) {
  if ($command.Extent.StartOffset -le $preflight[0].Extent.StartOffset) { throw 'DPAPI must be verified before server enrollment.' }
}
Write-Output 'PASS: Windows PowerShell DPAPI assembly loading, encryption, decryption and pre-enrollment guard.'
