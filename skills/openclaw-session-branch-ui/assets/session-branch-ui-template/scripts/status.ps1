$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'data\server.pid'
$watcherStateFile = Join-Path $root 'data\watcher-state.json'

if (-not (Test-Path $pidFile)) {
  Write-Output 'Session Branch UI is stopped.'
  if (Test-Path $watcherStateFile) {
    Write-Output 'Watcher state file exists.'
  }
  exit 0
}

$serverPid = (Get-Content $pidFile -Raw).Trim()
$process = if ($serverPid) { Get-Process -Id $serverPid -ErrorAction SilentlyContinue } else { $null }

if ($process) {
  Write-Output "Session Branch UI is running on PID $serverPid"
  Write-Output 'URL: http://127.0.0.1:4317'
} else {
  Write-Output 'Session Branch UI is stopped (stale pid file found).'
}

if (Test-Path $watcherStateFile) {
  try {
    $watcher = Get-Content $watcherStateFile -Raw | ConvertFrom-Json
    if ($watcher.watcherPid) {
      $watcherProcess = Get-Process -Id $watcher.watcherPid -ErrorAction SilentlyContinue
      if ($watcherProcess) {
        Write-Output "Watcher is running on PID $($watcher.watcherPid) for Gateway PID $($watcher.gatewayPid)"
      } else {
        Write-Output 'Watcher state exists but watcher process is not running.'
      }
    }
  } catch {
    Write-Output 'Watcher state file is unreadable.'
  }
}
