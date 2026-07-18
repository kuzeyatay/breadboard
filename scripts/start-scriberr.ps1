# Windows wrapper for the cross-platform Scriberr launcher.
# Used by start.bat; keeps the window open so Docker output stays visible.
$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
node (Join-Path $PSScriptRoot "start-scriberr.mjs")
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Scriberr did not start. Video transcription will be unavailable." -ForegroundColor Yellow
  Write-Host "See docs/VIDEO_TRANSCRIPTION.md for setup instructions." -ForegroundColor Yellow
}
