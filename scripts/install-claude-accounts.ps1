# Install the per-user PowerShell entry point beside the existing native Claude CLI.
$ErrorActionPreference = 'Stop'
$native = (Get-Command claude.exe -CommandType Application | Select-Object -First 1).Source
$bin = Split-Path -Parent $native
$entry = Join-Path $bin 'claude.ps1'
$source = Join-Path $PSScriptRoot 'claude.ps1'
if ((Test-Path -LiteralPath $entry) -and (Get-FileHash -LiteralPath $entry).Hash -ne (Get-FileHash -LiteralPath $source).Hash) {
    throw "An existing PowerShell launcher already owns $entry."
}
$library = Join-Path $bin 'breadboard-claude'
New-Item -ItemType Directory -Path $library -Force | Out-Null
foreach ($module in 'claude-accounts-cli.mjs', 'claude-profiles.mjs') {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\dashboard\scripts\$module") -Destination (Join-Path $library $module)
}
Copy-Item -LiteralPath $source -Destination $entry
Write-Output "Installed the Claude account launcher at $entry"
