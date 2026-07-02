$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$targetPath = Join-Path $root "build\cloud-defaults.json"
$localAppDataConfig = Join-Path $env:LOCALAPPDATA "PAOFI-Database-Data\cloud-database.json"
$legacyLocalAppDataConfig = Join-Path $env:LOCALAPPDATA "PAOFI-LP-Database-Data\cloud-database.json"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null

if ($env:TURSO_DATABASE_URL -and $env:TURSO_AUTH_TOKEN) {
  $config = [ordered]@{
    provider = "turso"
    url = $env:TURSO_DATABASE_URL
    authToken = $env:TURSO_AUTH_TOKEN
  }

  $config | ConvertTo-Json | Set-Content -LiteralPath $targetPath -Encoding UTF8
  Write-Host "Cloud defaults prepared from TURSO_DATABASE_URL/TURSO_AUTH_TOKEN."
  exit 0
}

if ($env:LPDB_CLOUD_CONFIG -and (Test-Path -LiteralPath $env:LPDB_CLOUD_CONFIG)) {
  Copy-Item -LiteralPath $env:LPDB_CLOUD_CONFIG -Destination $targetPath -Force
  Write-Host "Cloud defaults prepared from LPDB_CLOUD_CONFIG."
  exit 0
}

if (Test-Path -LiteralPath $localAppDataConfig) {
  Copy-Item -LiteralPath $localAppDataConfig -Destination $targetPath -Force
  Write-Host "Cloud defaults prepared from the local app cloud config."
  exit 0
}

if (Test-Path -LiteralPath $legacyLocalAppDataConfig) {
  Copy-Item -LiteralPath $legacyLocalAppDataConfig -Destination $targetPath -Force
  Write-Host "Cloud defaults prepared from the legacy local app cloud config."
  exit 0
}

"{}" | Set-Content -LiteralPath $targetPath -Encoding UTF8
Write-Warning "No Turso cloud config was found. The installer will not include bundled cloud defaults."
