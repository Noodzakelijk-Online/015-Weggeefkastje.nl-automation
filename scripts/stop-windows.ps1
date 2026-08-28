[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $repoRoot 'data\runtime'
$targets = @(
  @{ File = (Join-Path $runtimeDir 'server.pid'); Expected = 'dist/server-main.js' },
  @{ File = (Join-Path $runtimeDir 'worker.pid'); Expected = 'dist/worker.js' },
  @{ File = (Join-Path $runtimeDir 'ngrok.pid'); Expected = 'ngrok' }
)

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target.File)) { continue }
  $savedPid = [int](Get-Content -LiteralPath $target.File -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  if ($process) {
    $expected = [string]$target.Expected
    if ([string]$process.CommandLine -notlike "*$expected*") { throw "PID $savedPid is not the expected Weggeefkastje process; it was not stopped." }
    Stop-Process -Id $savedPid -Force
  }
  Remove-Item -LiteralPath $target.File
}
Write-Host 'Weggeefkastje processes stopped.'
