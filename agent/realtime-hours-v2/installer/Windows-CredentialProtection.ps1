Set-StrictMode -Version Latest

function Initialize-WindowsCredentialProtection {
  # Windows PowerShell 5.1 does not automatically load this assembly.
  Add-Type -AssemblyName System.Security -ErrorAction Stop
  if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop
  }
  if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {
    throw 'A protecao de credenciais do Windows nao esta disponivel.'
  }

  # Check actual encryption/decryption before consuming the enrollment code.
  $probe = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $restored = $null
  $encrypted = $null
  try {
    $rng.GetBytes($probe)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($probe, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    $restored = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    if ([Convert]::ToBase64String($probe) -cne [Convert]::ToBase64String($restored)) {
      throw 'A verificacao da protecao de credenciais do Windows falhou.'
    }
  } finally {
    $rng.Dispose()
    [Array]::Clear($probe, 0, $probe.Length)
    if ($null -ne $restored) { [Array]::Clear($restored, 0, $restored.Length) }
    if ($null -ne $encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
  }
}
