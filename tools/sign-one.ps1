param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Path,
  [string]$SubjectMatch = 'LanDeck',
  [string]$NamePattern = 'landeck|LanDeck',
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
#   0  no cert present AND -Require not given -> prints a LOUD skip notice
#   1  cert present but signing failed, or -Require given without a cert
#
# Why the NamePattern whitelist: Tauri pushes EVERY signable binary through
# signCommand, including its own bundled WiX toolchain DLLs
# (WixUtilExtension.dll, WixUIExtension.dll, ...) under target/release/wix/.
# Signing a third party's toolchain DLL with our local cert is simply wrong,
# and it also corrupts Tauri's tool cache. Measured, not hypothetical.
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

# Only sign our own artifacts. Third-party toolchain DLLs (WiX etc.) ship
# already signed by their vendor and must be left untouched.
if ($name -notmatch $NamePattern) {
  Write-Host ("sign-one: skip (not our artifact): {0}" -f $name)
  exit 0
}

$cert = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -like "*$SubjectMatch*" -and $_.HasPrivateKey } |
  Select-Object -First 1

if (-not $cert) {
  if ($Require) {
    Write-Host 'sign-one: FAIL - no code-signing cert and -Require was given.'
    Write-Host 'sign-one: run  tools/sign-windows.ps1 -Setup  first.'
    exit 1
  }
  Write-Host 'sign-one: SKIP (no cert in CurrentUser\My) - artifact left UNSIGNED.'
  Write-Host 'sign-one: run tools/sign-windows.ps1 -Setup to enable signing.'
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