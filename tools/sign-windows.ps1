# Sign Windows artifacts with a local self-signed cert.
#
# Run once per machine/user:  tools/sign-windows.ps1 -Setup
# Then after each build:      tools/sign-windows.ps1
#
# Accepts explicit -Paths, or discovers the standard build outputs plus the
# per-user install directory that the Start Menu / Desktop shortcuts
# actually launch (signing only the build output was the earlier gap).
#
# NOTE: this script is deliberately pure ASCII. PowerShell 5.1 reads a
# BOM-less .ps1 as ANSI, and non-ASCII comments have broken this toolchain
# before. Keep it ASCII.

param(
  [switch]$Setup,
  [string[]]$Paths = @(),
  [string]$Subject = 'CN=LanDeck (Local Self-Signed), O=LanDeck, C=CN',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Get-LanDeckCert {
  Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -like '*LanDeck*' -and $_.HasPrivateKey } |
    Select-Object -First 1
}

function Write-Log {
  param([string]$Message)
  if (-not $Quiet) { Write-Host $Message }
}

if ($Setup) {
  $cert = Get-LanDeckCert
  if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
      -KeyUsage DigitalSignature -FriendlyName 'LanDeck local code signing' `
      -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(3)
    Write-Log "  created cert: $($cert.Thumbprint)"
  } else {
    Write-Log "  reusing cert: $($cert.Thumbprint)"
  }

  # Add to Root + TrustedPublisher, then RE-READ the store to prove it landed.
  # Writing and checking the return value only was a false-green: the earlier
  # version reported success while the store was actually empty.
  foreach ($store in @('Root', 'TrustedPublisher')) {
    $s = New-Object System.Security.Cryptography.X509Certificates.X509Store($store, 'CurrentUser')
    $s.Open('ReadWrite')
    $present = $s.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if (-not $present) { $s.Add($cert) }
    $s.Close()

    $v = New-Object System.Security.Cryptography.X509Certificates.X509Store($store, 'CurrentUser')
    $v.Open('ReadOnly')
    $count = @($v.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count
    $v.Close()
    if ($count -lt 1) {
      Write-Log "  FAILED to install into CurrentUser\$store (re-read found 0)"
      exit 1
    }
    Write-Log "  CurrentUser\$store verified: $count entry"
  }
  Write-Log "Cert ready: $($cert.Thumbprint)"
  exit 0
}

$cert = Get-LanDeckCert
if (-not $cert) {
  Write-Log 'No signing cert found. Run first: tools/sign-windows.ps1 -Setup'
  exit 1
}

if ($Paths.Count -eq 0) {
  $root = Split-Path -Parent $PSScriptRoot
  # Local install dir: this is what Desktop / Start Menu shortcuts launch.
  $installDir = Join-Path $env:LOCALAPPDATA 'LanDeck'
  $dirs = @(
    (Join-Path $root 'app\src-tauri\target\release\bundle\nsis'),
    (Join-Path $root 'app\src-tauri\target\release\bundle\msi'),
    (Join-Path $root 'agent\dist'),
    $installDir
  )
  $found = New-Object System.Collections.ArrayList

  $exe = Join-Path $root 'app\src-tauri\target\release\landeck.exe'
  if (Test-Path $exe) { [void]$found.Add((Get-Item $exe).FullName) }

  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    Get-ChildItem -Path $d -Recurse -Include '*.exe', '*.msi' -File -ErrorAction SilentlyContinue |
      ForEach-Object { [void]$found.Add($_.FullName) }
  }

  # Keep only our artifacts.
  $found = $found | Where-Object { $_ -match 'landeck|LanDeck' }

  # Installers: sign only the NEWEST per directory. Republishing an older
  # installer with a fresh signature would be misleading.
  $installers = $found | Where-Object { $_ -match '(setup\.exe|\.msi)$' }
  $others = $found | Where-Object { $_ -notmatch '(setup\.exe|\.msi)$' }
  $newest = @()
  foreach ($g in ($installers | Group-Object { Split-Path $_ -Parent })) {
    $newest += ($g.Group | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1)
  }
  $Paths = @($others) + @($newest)
  $Paths = $Paths | Where-Object { $_ } | Select-Object -Unique
}

if (-not $Paths -or @($Paths).Count -eq 0) {
  Write-Log 'Nothing to sign (build first)'
  exit 1
}

$okCount = 0
$failCount = 0
$skipped = 0

foreach ($p in $Paths) {
  if (-not (Test-Path -LiteralPath $p)) { $skipped++; continue }
  $name = Split-Path $p -Leaf

  $already = Get-AuthenticodeSignature -FilePath $p
  $alreadyOurs = $false
  if ($already.SignerCertificate) { $alreadyOurs = ($already.SignerCertificate.Thumbprint -eq $cert.Thumbprint) }
  if ($already.Status -eq 'Valid' -and $alreadyOurs) {
    Write-Log "  already signed: $name"
    $okCount++
    continue
  }

  $done = $false
  foreach ($ts in @('http://timestamp.digicert.com', '')) {
    try {
      if ($ts) {
        Set-AuthenticodeSignature -FilePath $p -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $ts | Out-Null
      } else {
        Set-AuthenticodeSignature -FilePath $p -Certificate $cert -HashAlgorithm SHA256 | Out-Null
      }
    } catch {
      Write-Log ("  attempt threw {0}: {1}" -f $name, $_.Exception.Message)
    }
    # Re-read from disk; do not trust the Set- return value.
    $v = Get-AuthenticodeSignature -FilePath $p
    $match = $false
    if ($v.SignerCertificate) { $match = ($v.SignerCertificate.Thumbprint -eq $cert.Thumbprint) }
    if ($v.Status -eq 'Valid' -and $match) {
      $tsLabel = if ($ts) { 'timestamped' } else { 'no-timestamp' }
      Write-Log ("  signed ({0}): {1}" -f $tsLabel, $name)
      $okCount++
      $done = $true
      break
    }
  }
  if (-not $done) {
    $v = Get-AuthenticodeSignature -FilePath $p
    Write-Log ("  FAILED {0} : status={1}" -f $name, $v.Status)
    $failCount++
  }
}

Write-Log "Done. ok=$okCount fail=$failCount skipped=$skipped"
if ($failCount -gt 0) { exit 1 }
exit 0