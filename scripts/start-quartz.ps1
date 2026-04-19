$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$quartzDir = Join-Path $repoRoot "quartz"
$sitePort = 8081
$wsPort = 3001

function Test-PortInUse {
  param([int]$Port)

  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
      return $true
    }
  }

  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
    $listener.ExclusiveAddressUse = $true
    $listener.Start()
    return $false
  } catch {
    return $true
  } finally {
    if ($listener -ne $null) {
      $listener.Stop()
    }
  }
}

Set-Location $quartzDir

while ($true) {
  if (Test-PortInUse $sitePort) {
    Write-Host ""
    Write-Host "Quartz already appears to be running on http://localhost:$sitePort."
    Write-Host "Close the existing Quartz window before starting another one."
    break
  }

  if (Test-PortInUse $wsPort) {
    Write-Host ""
    Write-Host "Quartz hot reload port $wsPort is already in use."
    Write-Host "Close the existing Quartz window before starting another one."
    break
  }

  Write-Host ""
  Write-Host "Starting Quartz on http://localhost:$sitePort ..."
  node .\quartz\bootstrap-cli.mjs build --serve --port $sitePort --wsPort $wsPort

  $exitCode = $LASTEXITCODE
  Write-Host ""
  Write-Host "Quartz stopped with exit code $exitCode. Restarting in 2 seconds..."
  Start-Sleep -Seconds 2
}
