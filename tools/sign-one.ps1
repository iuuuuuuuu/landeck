param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Path,
  [string]$SubjectMatch = 'LanDeck',
  [string]$NamePattern = 'landeck|LanDeck|uninstall|^nst[0-9A-Fa-f]+\.tmp$',
  [switch]$Require
)

# Sign ONE binary with the local self-signed code-signing cert.
# Invoked by Tauri's bundle.windows.signCommand, which passes the binary
# path as %1, with cwd = app/src-tauri.
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less .ps1 as ANSI,
# and non-ASCII comments already broke this toolchain once.
#
# Exit policy (a real gate, not a rubber stamp):
#   0  signed, verified by re-reading from disk
#   0  not our artifact (see NamePattern) -> skip, nothing is signed
#   0  no cert available AND -Require not given -> LOUD skip notice
#   1  cert present but signing failed, or -Require given without a cert
#   1  the binary path does not exist
#
# Two measured constraints shape this script:
#
# 1. NEVER use the `Cert:` PSDrive (`Get-ChildItem Cert:\...`). It is not
#    registered in every Windows session -- a GitHub Actions windows-latest
#    runner threw `Cannot find drive. A drive with the name 'Cert' does not
#    exist` and that exception aborted the whole bundle step. Use the .NET
#    X509Store API instead, which works everywhere.
#
# 2. The whitelist is required: Tauri pushes EVERY signable binary through
#    signCommand, including its own bundled toolchain DLLs (WiX under
#    target/release/wix/, NSIS plugins under target/release/nsis/). Signing a
#    third party's toolchain DLL with our local cert is wrong and also
#    corrupts Tauri's tool cache. Measured, not hypothetical.
#
#    The uninstaller is the tricky case. Tauri signs it through the same
#    command, but via NSIS `!uninstfinalize`, and makensis does NOT pass the
#    final name. Measured with a logging stub:
#        %1  ==  C:\Users\<short>\AppData\Local\Temp\nst<hex>.tmp
#    i.e. an `nst*.tmp` scratch file in %TEMP%. Its name contains neither
#    "landeck" nor "uninstall", so a purely name-based whitelist silently
#    skips it and the installed uninstaller ends up NotSigned.
#
#    The pattern therefore also allows `nst` (the NSIS uninstaller scratch
#    prefix). That is deliberately narrow: NSIS uses `ns*`/`nst*` names only
#    for its own scratch files, and everything else Tauri pushes through here
#    (WiX/NSIS plugin DLLs) still gets skipped.
#
#    Do not "simplify" this back to just landeck|uninstall: that silently
#    regresses the uninstaller signature with no error at all.
#
# The signature is only accepted after re-reading it from disk and checking
# BOTH status=Valid AND thumbprint match. Trusting the return value of
# Set-AuthenticodeSignature was a false-green before.

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Host "sign-one: file not found: $Path"
  exit 1
}

$name = Split-Path $Path -Leaf

# Only sign our own artifacts.
if ($name -notmatch $NamePattern) {
  Write-Host ("sign-one: skip (not our artifact): {0}" -f $name)
  exit 0
}

# Find our cert via X509Store -- no `Cert:` drive.
function Get-OurCert {
  param([string]$Match)
  foreach ($loc in @('CurrentUser', 'LocalMachine')) {
    $store = $null
    try {
      $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
      $store.Open('ReadOnly')
      $found = $store.Certificates | Where-Object {
        $_.Subject -like "*$Match*" -and $_.HasPrivateKey
      } | Select-Object -First 1
      if ($found) { return $found }
    } catch {
      # store unavailable -- keep looking, then fall through to "no cert"
    } finally {
      if ($store) { $store.Close() }
    }
  }
  return $null
}

$cert = $null
try { $cert = Get-OurCert -Match $SubjectMatch } catch { $cert = $null }

if (-not $cert) {
  if ($Require) {
    Write-Host 'sign-one: FAIL - no code-signing cert and -Require was given.'
    Write-Host 'sign-one: run tools/sign-windows.ps1 -Setup on this machine first.'
    exit 1
  }
  Write-Host 'sign-one: SKIP (no code-signing cert in this session) - artifact left UNSIGNED.'
  Write-Host 'sign-one: run tools/sign-windows.ps1 -Setup to enable signing on this machine.'
  exit 0
}

function Test-Signed {
  param([string]$File, [string]$Thumb)
  $v = Get-AuthenticodeSignature -FilePath $File
  $match = $false
  if ($v.SignerCertificate) { $match = ($v.SignerCertificate.Thumbprint -eq $Thumb) }
  return @{ Status = $v.Status; Match = $match }
}

# Skip if already signed by OUR cert (idempotent re-runs).
$r0 = Test-Signed -File $Path -Thumb $cert.Thumbprint
if ($r0.Status -eq 'Valid' -and $r0.Match) {
  Write-Host ("sign-one: already signed by our cert: {0}" -f $name)
  exit 0
}

# Attempt 1: timestamped. Attempt 2: no timestamp (TSA may be unreachable).
try {
  Set-AuthenticodeSignature -FilePath $Path -Certificate $cert -HashAlgorithm SHA256 `
    -TimestampServer 'http://timestamp.digicert.com' | Out-Null
} catch {
  Write-Host ("sign-one: timestamped attempt threw: {0}" -f $_.Exception.Message)
}
$r = Test-Signed -File $Path -Thumb $cert.Thumbprint
if ($r.Status -eq 'Valid' -and $r.Match) {
  Write-Host ("sign-one: OK  {0}  (timestamped)" -f $name)
  exit 0
}

try {
  Set-AuthenticodeSignature -FilePath $Path -Certificate $cert -HashAlgorithm SHA256 | Out-Null
} catch {
  Write-Host ("sign-one: untimestamped attempt threw: {0}" -f $_.Exception.Message)
}
$r = Test-Signed -File $Path -Thumb $cert.Thumbprint
if ($r.Status -eq 'Valid' -and $r.Match) {
  Write-Host ("sign-one: OK  {0}  (no timestamp)" -f $name)
  exit 0
}

Write-Host ("sign-one: FAILED {0}  status={1} thumbprintMatch={2}" -f $name, $r.Status, $r.Match)
exit 1