$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
node (Join-Path $PSScriptRoot 'control-bg.js') status
