$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'data\server.pid'
$watcherStateFile = Join-Path $root 'data\watcher-state.json'

if (Test-Path $watcherStateFile) {
  try {
    $watcher = Get-Content $watcherStateFile -Raw | ConvertFrom-Json
    if ($watcher.watcherPid) {
      $watcherProcess = Get-Process -Id $watcher.watcherPid -ErrorAction SilentlyContinue
      if ($watcherProcess) {
        Stop-Process -Id $watcher.watcherPid -Force
        Write-Output "Stopped Session Branch UI watcher (PID $($watcher.watcherPid))"
      }
    }
  } catch {}

  Remove-Item $watcherStateFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $pidFile)) {
  Write-Output 'Session Branch UI is not running (no pid file).'
  exit 0
}

$serverPid = (Get-Content $pidFile -Raw).Trim()
if (-not $serverPid) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Output 'Removed empty pid file.'
  exit 0
}

$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $serverPid -Force
  Write-Output "Stopped Session Branch UI (PID $serverPid)"
} else {
  Write-Output "Process $serverPid not found; cleaning stale pid file."
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
