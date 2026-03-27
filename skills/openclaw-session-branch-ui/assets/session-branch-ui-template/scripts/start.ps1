param(
  [string]$NodePath
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$logsDir = Join-Path $root 'logs'
$pidFile = Join-Path $dataDir 'server.pid'
$outLog = Join-Path $logsDir 'server.out.log'
$errLog = Join-Path $logsDir 'server.err.log'

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -Raw).Trim()
  if ($existingPid) {
    $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Output "Session Branch UI already running on PID $existingPid"
      exit 0
    }
  }
}

if (-not $NodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $NodePath = $nodeCommand.Source
  }
}

if (-not $NodePath -or -not (Test-Path $NodePath)) {
  throw 'Node runtime not found. Pass -NodePath or ensure node.exe is available on PATH.'
}

$process = Start-Process -FilePath $NodePath `
  -ArgumentList 'server.js' `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -Path $pidFile -Value $process.Id
Write-Output "Started Session Branch UI on PID $($process.Id)"
Write-Output 'URL: http://127.0.0.1:4317'
