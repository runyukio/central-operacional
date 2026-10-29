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
$preflight = $installer.IndexOf('Initialize-WindowsCredentialProtection')
$enroll = $installer.IndexOf('$enroll = Invoke-RestMethod')
if ($preflight -lt 0 -or $enroll -le $preflight) { throw 'DPAPI must be verified before server enrollment.' }
Write-Output 'PASS: Windows PowerShell DPAPI assembly loading, encryption, decryption and pre-enrollment guard.'
