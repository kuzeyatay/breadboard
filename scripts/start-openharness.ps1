# Starts the OpenHarness agent runtime for Breadboard.
#
# OpenHarness is the interactive agent harness (a renamed OpenCode fork). It binds
# to 127.0.0.1:4096 and is protected with a server password. Breadboard's dashboard
# is the only client. This script is intentionally focused on OpenHarness only —
# use start.bat (or the npm scripts) to start everything together.

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$openharnessDir = Join-Path $repoRoot "openharness"
$configDir = Join-Path $repoRoot "openharness-config"
$port = if ($env:OPENHARNESS_PORT) { $env:OPENHARNESS_PORT } else { "4096" }

# `start.bat` launches this script directly, while Next loads dashboard/.env.local
# itself. Import only the shared OpenHarness credential values when the parent
# process did not already provide them so both services authenticate with the
# same values. Values are never written to the console.
$dashboardEnv = Join-Path $repoRoot "dashboard\.env.local"
function Read-LocalEnvValue([string]$name) {
  if (-not (Test-Path -LiteralPath $dashboardEnv)) { return $null }
  $prefix = "$name="
  $line = Get-Content -LiteralPath $dashboardEnv | Where-Object {
    $_.StartsWith($prefix, [System.StringComparison]::Ordinal)
  } | Select-Object -Last 1
  if (-not $line) { return $null }
  $value = $line.Substring($prefix.Length).Trim()
  if (
    $value.Length -ge 2 -and
    (($value.StartsWith('"') -and $value.EndsWith('"')) -or
     ($value.StartsWith("'") -and $value.EndsWith("'")))
  ) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

if (-not $env:OPENHARNESS_USERNAME) {
  $env:OPENHARNESS_USERNAME = Read-LocalEnvValue "OPENHARNESS_USERNAME"
}
if (-not $env:OPENHARNESS_PASSWORD) {
  $env:OPENHARNESS_PASSWORD = Read-LocalEnvValue "OPENHARNESS_PASSWORD"
}
if (-not $env:OPENHARNESS_TOOL_SECRET) {
  $env:OPENHARNESS_TOOL_SECRET = Read-LocalEnvValue "OPENHARNESS_TOOL_SECRET"
}

if (-not (Test-Path $openharnessDir)) {
  Write-Host "OpenHarness directory not found at $openharnessDir" -ForegroundColor Red
  exit 1
}

# Server password: reuse OPENHARNESS_PASSWORD if set, else a local dev default.
$password = if ($env:OPENHARNESS_PASSWORD) { $env:OPENHARNESS_PASSWORD } else { "breadboard-local-dev" }
$env:OPENCODE_SERVER_PASSWORD = $password
$env:OPENCODE_SERVER_USERNAME = if ($env:OPENHARNESS_USERNAME) { $env:OPENHARNESS_USERNAME } else { "breadboard" }
$env:OPENCODE_CONFIG_DIR = $configDir
$env:BREADBOARD_INTERNAL_URL = if ($env:BREADBOARD_INTERNAL_URL) { $env:BREADBOARD_INTERNAL_URL } else { "http://127.0.0.1:3000" }
$env:OPENHARNESS_TOOL_SECRET = if ($env:OPENHARNESS_TOOL_SECRET) { $env:OPENHARNESS_TOOL_SECRET } else { $password }
$env:CHATMOCK_BASE_URL = if ($env:CHATMOCK_BASE_URL) { $env:CHATMOCK_BASE_URL } else { "http://127.0.0.1:8765/v1" }
$env:CHATMOCK_API_KEY = if ($env:CHATMOCK_API_KEY) { $env:CHATMOCK_API_KEY } elseif ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY } else { "local" }
$env:CHATMOCK_MODEL = if ($env:CHATMOCK_MODEL) { $env:CHATMOCK_MODEL } else { "gpt-5.6-sol" }
$env:OPENCODE_ENABLE_EXA = if ($env:OPENCODE_ENABLE_EXA) { $env:OPENCODE_ENABLE_EXA } else { "1" }
$env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = if ($env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS) { $env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS } else { "true" }

# Reuse an already-running instance instead of letting Bun fail to bind the
# port and die with an opaque ServeError (mirrors the Scriberr launcher).
$authHeader = @{
  Authorization = "Basic " + [Convert]::ToBase64String(
    [Text.Encoding]::ASCII.GetBytes("$($env:OPENCODE_SERVER_USERNAME):$password"))
}
$existingStatus = $null
try {
  $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$port/global/health" -Headers $authHeader -TimeoutSec 3 -UseBasicParsing
  $existingStatus = [int]$probe.StatusCode
} catch {
  $response = $_.Exception.Response
  if ($response) { $existingStatus = [int]$response.StatusCode.value__ }
}
if ($existingStatus -eq 200) {
  Write-Host "OpenHarness already running and healthy on 127.0.0.1:$port - reusing it." -ForegroundColor Green
  exit 0
}
if ($null -ne $existingStatus) {
  Write-Host "Port $port is already in use (the existing server answered HTTP $existingStatus)." -ForegroundColor Yellow
  Write-Host "Stop the stale or differently-configured server (or another service on this port), or set OPENHARNESS_PORT, then retry." -ForegroundColor Yellow
  exit 1
}

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  Write-Host "Bun is not installed. OpenHarness requires Bun (bun@1.3.14+)." -ForegroundColor Yellow
  Write-Host "Install from https://bun.sh, then run 'bun install' in $openharnessDir." -ForegroundColor Yellow
  Write-Host "Use OPENHARNESS_MODE=legacy only when intentional prior behavior is required." -ForegroundColor Yellow
  exit 1
}

Write-Host "Starting OpenHarness on 127.0.0.1:$port (config: $configDir)" -ForegroundColor Green
Push-Location $openharnessDir
try {
  & bun run packages/opencode/src/index.ts serve --port $port --hostname 127.0.0.1
} finally {
  Pop-Location
}
