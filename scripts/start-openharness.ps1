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

if (-not (Test-Path $openharnessDir)) {
  Write-Host "OpenHarness directory not found at $openharnessDir" -ForegroundColor Red
  exit 1
}

# Server password: reuse OPENHARNESS_PASSWORD if set, else a local dev default.
$password = if ($env:OPENHARNESS_PASSWORD) { $env:OPENHARNESS_PASSWORD } else { "breadboard-local-dev" }
$env:OPENCODE_SERVER_PASSWORD = $password
$env:OPENCODE_SERVER_USERNAME = if ($env:OPENHARNESS_USERNAME) { $env:OPENHARNESS_USERNAME } else { "breadboard" }
$env:OPENCODE_CONFIG_DIR = $configDir
$env:CHATMOCK_BASE_URL = if ($env:CHATMOCK_BASE_URL) { $env:CHATMOCK_BASE_URL } else { "http://127.0.0.1:8765/v1" }
$env:CHATMOCK_API_KEY = if ($env:CHATMOCK_API_KEY) { $env:CHATMOCK_API_KEY } elseif ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY } else { "local" }
$env:CHATMOCK_MODEL = if ($env:CHATMOCK_MODEL) { $env:CHATMOCK_MODEL } else { "gpt-5" }

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
