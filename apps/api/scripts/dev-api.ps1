# Runs the VOP API in watch mode (foreground) with apps/api/.env loaded.
# Used by the VS Code task "API: dev". Ctrl+C stops it.
# Usage: powershell -ExecutionPolicy Bypass -File apps\api\scripts\dev-api.ps1
$ErrorActionPreference = 'Stop'
$apiDir = Split-Path -Parent $PSScriptRoot        # ...\apps\api
$envFile = Join-Path $apiDir '.env'

if (-not (Test-Path $envFile)) {
  Write-Error "Missing $envFile - copy .env.example to apps/api/.env and fill it in."
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process')
  }
}

# Free port 3000 if an earlier (e.g. detached) API instance still holds it.
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Set-Location $apiDir
corepack pnpm dev
