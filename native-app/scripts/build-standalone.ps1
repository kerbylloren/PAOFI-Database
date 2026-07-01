$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$nodeCommand = Get-Command "node.exe" -ErrorAction Stop

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $runtimeDir "node.exe") -Force

Push-Location $root
try {
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) {
    throw "Tests failed with exit code $LASTEXITCODE."
  }

  & npx.cmd electron-builder --win portable --x64
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
