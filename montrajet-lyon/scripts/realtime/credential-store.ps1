param(
  [ValidateSet('Read','Status','Initialize')][string]$Action = 'Status',
  [string]$StorePath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (-not $StorePath) { $StorePath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')) '.data/realtime-credential.clixml' }
$fallback = [System.IO.Path]::ChangeExtension($StorePath, '.local.json')
if ($Action -eq 'Status') { if ((Test-Path -LiteralPath $StorePath) -or (Test-Path -LiteralPath $fallback)) { 'configured' } else { 'missing' }; exit 0 }
if ($Action -eq 'Read') {
  if (-not (Test-Path -LiteralPath $StorePath) -and -not (Test-Path -LiteralPath $fallback)) { 'missing'; exit 0 }
  try {
    if (Test-Path -LiteralPath $StorePath) {
      $credential = Import-Clixml -LiteralPath $StorePath
      if ($credential -isnot [System.Management.Automation.PSCredential]) { throw 'invalid' }
      $plain = $credential.GetNetworkCredential().Password
      if (-not $credential.UserName -or -not $plain) { throw 'invalid' }
      @{ username = $credential.UserName; password = $plain } | ConvertTo-Json -Compress
    } else {
      $item = Get-Item -LiteralPath $fallback
      $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $access = $item.GetAccessControl().Access
      foreach ($rule in $access) {
        $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $ruleSid -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'unsafe_acl' }
      }
      $data = Get-Content -LiteralPath $fallback -Raw -Encoding UTF8 | ConvertFrom-Json
      if (-not $data.username -or -not $data.password) { throw 'invalid' }
      @{ username = $data.username; password = $data.password } | ConvertTo-Json -Compress
    }
    exit 0
  } catch { 'unavailable'; exit 0 }
}
if ((Test-Path -LiteralPath $StorePath) -or (Test-Path -LiteralPath $fallback)) { 'already_configured'; exit 0 }
$username = $env:GRANDLYON_USERNAME
if (-not $username) { $username = Read-Host 'Identifiant du compte technique Data Grand Lyon' }
if (-not $username -or $username.Contains(':') -or $username.Contains("`r") -or $username.Contains("`n")) { 'invalid_username'; exit 2 }
if ($env:GRANDLYON_PASSWORD) {
  $secure = ConvertTo-SecureString $env:GRANDLYON_PASSWORD -AsPlainText -Force
} else {
  $secure = Read-Host 'Mot de passe Data Grand Lyon (saisie masquée)' -AsSecureString
}
$credential = [System.Management.Automation.PSCredential]::new($username,$secure)
$plain = $credential.GetNetworkCredential().Password
if (-not $plain) { 'invalid_password'; exit 2 }
$header = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($username + ':' + $plain))
try {
  $response = Invoke-WebRequest -Uri 'https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json?maxfeatures=1' -Method Get -Headers @{ Authorization=$header; Accept='application/json' } -MaximumRedirection 0 -TimeoutSec 8 -UseBasicParsing
  if ($response.StatusCode -ne 200) { throw 'refused' }
  $body = $response.Content | ConvertFrom-Json
  if ($null -eq $body.values) { throw 'invalid_response' }
} catch { 'verification_failed'; exit 3 }
$folder = Split-Path -Parent $StorePath
if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
try {
  $credential | Export-Clixml -LiteralPath $StorePath
  'configured_dpapi'
} catch {
  if (Test-Path -LiteralPath $StorePath) { Remove-Item -LiteralPath $StorePath -Force }
  try {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    @{ username = $username; password = $plain } | ConvertTo-Json -Compress | Set-Content -LiteralPath $fallback -Encoding UTF8 -NoNewline
    & icacls.exe $fallback /inheritance:r /grant:r ('*' + $sid + ':F') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'acl_failed' }
    'configured_acl'
  } catch {
    if (Test-Path -LiteralPath $fallback) { Remove-Item -LiteralPath $fallback -Force }
    'storage_unavailable'
    exit 4
  }
}
