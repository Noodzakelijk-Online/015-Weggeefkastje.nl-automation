[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 20 or newer is required.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd was not found.' }
$nodeMajor = [int]((& node.exe --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required; found $nodeMajor." }

Push-Location $repoRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.env'))) {
    Copy-Item -LiteralPath (Join-Path $repoRoot '.env.example') -Destination (Join-Path $repoRoot '.env')
    Write-Host 'Created .env from the safe local defaults. Add provider credentials only when needed.'
  }
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
  & npm.cmd run migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
  & npm.cmd run doctor
  if ($LASTEXITCODE -ne 0) { throw 'Installation diagnostics failed.' }
  Write-Host 'Installation complete. Run scripts\start-windows.ps1 to start the application.'
} finally {
  Pop-Location
}
