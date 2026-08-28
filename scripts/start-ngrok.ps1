[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$PublicUrl,
  [ValidateRange(1, 65535)][int]$Port = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Get-Command ngrok.exe -ErrorAction SilentlyContinue)) { throw 'ngrok.exe was not found. Install it and run ngrok config add-authtoken first.' }

Push-Location $repoRoot
try {
  $env:NODE_ENV = 'production'
  $env:HOST = '127.0.0.1'
  $env:PORT = [string]$Port
  $env:APP_DATA_DIR = (Join-Path $repoRoot 'data')
  $env:DATABASE_PATH = (Join-Path $repoRoot 'data\weggeefkastjes.sqlite')
  $env:WEB_DIST_PATH = (Join-Path $repoRoot 'dist-web')
  $env:APP_BASE_URL = $PublicUrl
  $env:TRUST_PROXY = 'true'
  $env:COOKIE_SECURE = 'true'
  & node.exe dist/cli.js ready-for-tunnel
  if ($LASTEXITCODE -ne 0) { throw 'Tunnel readiness checks failed.' }

  & (Join-Path $PSScriptRoot 'stop-windows.ps1')
  & (Join-Path $PSScriptRoot 'start-windows.ps1') -Port $Port -PublicUrl $PublicUrl -NoOpen
  $runtimeDir = Join-Path $repoRoot 'data\runtime'
  $logDir = Join-Path $repoRoot 'data\logs'
  $ngrok = Start-Process -FilePath (Get-Command ngrok.exe).Source -ArgumentList @('http', [string]$Port, '--url', $PublicUrl, '--inspect=false', '--log', 'stdout', '--log-format', 'json') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'ngrok.log') -RedirectStandardError (Join-Path $logDir 'ngrok-error.log')
  Set-Content -LiteralPath (Join-Path $runtimeDir 'ngrok.pid') -Value $ngrok.Id

  $online = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try { $online = (Invoke-WebRequest -UseBasicParsing -Uri "$($PublicUrl.TrimEnd('/'))/ready" -TimeoutSec 3).StatusCode -eq 200 } catch { $online = $false }
    if ($online) { break }
    if ($ngrok.HasExited) { throw 'ngrok stopped during startup. See data\logs\ngrok-error.log.' }
  }
  if (-not $online) { throw 'The public endpoint did not become ready within 20 seconds.' }
  Start-Process $PublicUrl
  Write-Host "Secure ngrok endpoint ready: $PublicUrl"
} catch {
  & (Join-Path $PSScriptRoot 'stop-windows.ps1')
  throw
} finally {
  Pop-Location
}
