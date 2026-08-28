[CmdletBinding()]
param(
  [ValidateRange(1, 65535)][int]$Port = 3000,
  [string]$PublicUrl,
  [switch]$NoOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $repoRoot 'data\runtime'
$logDir = Join-Path $repoRoot 'data\logs'
$serverPidFile = Join-Path $runtimeDir 'server.pid'
$workerPidFile = Join-Path $runtimeDir 'worker.pid'

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'dist\server-main.js')) -or -not (Test-Path -LiteralPath (Join-Path $repoRoot 'dist-web\index.html'))) {
  throw 'The production build is missing. Run scripts\install-windows.ps1 first.'
}
if ($PublicUrl -and -not [Uri]::IsWellFormedUriString($PublicUrl, [UriKind]::Absolute)) { throw 'PublicUrl must be an absolute HTTPS URL.' }
if ($PublicUrl -and -not $PublicUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) { throw 'PublicUrl must use HTTPS.' }

New-Item -ItemType Directory -Force -Path $runtimeDir, $logDir | Out-Null
foreach ($pidFile in @($serverPidFile, $workerPidFile)) {
  if (Test-Path -LiteralPath $pidFile) {
    $savedPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    if (Get-Process -Id $savedPid -ErrorAction SilentlyContinue) { throw "The application is already running (PID $savedPid)." }
    Remove-Item -LiteralPath $pidFile
  }
}

$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:APP_DATA_DIR = (Join-Path $repoRoot 'data')
$env:DATABASE_PATH = (Join-Path $repoRoot 'data\weggeefkastjes.sqlite')
$env:WEB_DIST_PATH = (Join-Path $repoRoot 'dist-web')
$env:ALLOW_NETWORK_BINDING = 'false'
$env:ALLOW_REMOTE_SETUP = 'false'
$env:TRUST_PROXY = if ($PublicUrl) { 'true' } else { 'false' }
$env:COOKIE_SECURE = if ($PublicUrl) { 'true' } else { 'false' }
$env:APP_BASE_URL = if ($PublicUrl) { $PublicUrl } else { "http://127.0.0.1:$Port" }

$node = (Get-Command node.exe).Source
$server = Start-Process -FilePath $node -ArgumentList @('dist/server-main.js') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
$worker = Start-Process -FilePath $node -ArgumentList @('dist/worker.js') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'worker.log') -RedirectStandardError (Join-Path $logDir 'worker-error.log')
Set-Content -LiteralPath $serverPidFile -Value $server.Id
Set-Content -LiteralPath $workerPidFile -Value $worker.Id

$localUrl = "http://127.0.0.1:$Port"
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { $ready = (Invoke-WebRequest -UseBasicParsing -Uri "$localUrl/health" -TimeoutSec 2).StatusCode -eq 200 } catch { $ready = $false }
    if ($ready) { break }
    if ($server.HasExited) { throw "The server stopped during startup. See data\logs\server-error.log." }
    if ($worker.HasExited) { throw "The worker stopped during startup. See data\logs\worker-error.log." }
  }
  if (-not $ready) { throw 'The application did not start within 10 seconds.' }
} catch {
  foreach ($process in @($server, $worker)) { if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force } }
  Remove-Item -LiteralPath $serverPidFile, $workerPidFile -ErrorAction SilentlyContinue
  throw
}

if (-not $NoOpen) { Start-Process $localUrl }
Write-Host "Weggeefkastje is running at $localUrl (server PID $($server.Id), worker PID $($worker.Id))."
