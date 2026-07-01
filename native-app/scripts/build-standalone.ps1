$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-cloud-defaults.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Cloud defaults preparation failed with exit code $LASTEXITCODE."
  }

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
