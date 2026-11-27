# Closes the Breadboard install that setup is about to replace or remove.
#
# electron-builder's stock check finds "Breadboard.exe" by name, force-kills,
# and after two tries says "Breadboard cannot be closed" even when no window is
# open: a process Windows has not finished tearing down (a hung GPU driver call
# holds it), or one started elevated, survives taskkill. It also matched any
# Breadboard.exe at all, such as a development copy elsewhere.
#
# This closes only what runs from the install folder (Breadboard.exe and the
# bundled runtime, Node and Python), gives a normal shutdown time first, and
# reports what still remains so the dialog can name it. Exit 0 = nothing left.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = "SilentlyContinue"
$root = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'

function Get-InstallProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and (
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or
      # Path is hidden for an elevated or exiting process; a Breadboard.exe
      # we cannot see into still blocks the files, so it counts.
      (-not $_.ExecutablePath -and $_.Name -ieq "Breadboard.exe")
    )
  }
}

function Wait-Gone([int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  do {
    $left = @(Get-InstallProcesses)
    if ($left.Count -eq 0) { return $left }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $until)
  return @(Get-InstallProcesses)
}

$running = @(Get-InstallProcesses)
if ($running.Count -eq 0) { exit 0 }

# Ask open windows to quit normally; Breadboard then stops its runtime (~5 s).
# Leftover helpers without a Breadboard.exe get only a moment before closing.
$app = @($running | Where-Object { $_.Name -ieq "Breadboard.exe" })
foreach ($p in $app) {
  $proc = Get-Process -Id $p.ProcessId
  if ($proc -and $proc.MainWindowHandle -ne 0) { [void]$proc.CloseMainWindow() }
}
$left = Wait-Gone $(if ($app.Count -gt 0) { 20 } else { 2 })
if ($left.Count -eq 0) { exit 0 }

foreach ($p in $left) { Stop-Process -Id $p.ProcessId -Force }
$left = Wait-Gone 10
if ($left.Count -eq 0) { exit 0 }

& taskkill.exe /F /T @($left | ForEach-Object { "/PID"; "$($_.ProcessId)" }) *> $null
$left = Wait-Gone 5
if ($left.Count -eq 0) { exit 0 }

$left | ForEach-Object { "$($_.Name) (process $($_.ProcessId))" } | Select-Object -Unique
exit 1
