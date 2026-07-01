$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-cloud-defaults.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Cloud defaults preparation failed with exit code $LASTEXITCODE."
  }

  if (-not $env:CSC_LINK -and -not $env:CSC_NAME) {
    Write-Warning "No trusted code-signing certificate is configured. The installer will build, but Microsoft Defender SmartScreen can still warn because the installer is unsigned."
    Write-Warning "Set CSC_LINK and CSC_KEY_PASSWORD, or CSC_NAME for an installed certificate, before building a public release."
  }

  & npm.cmd test
  if ($LASTEXITCODE -ne 0) {
    throw "Tests failed with exit code $LASTEXITCODE."
  }

  & npx.cmd electron-builder --win nsis --x64
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
