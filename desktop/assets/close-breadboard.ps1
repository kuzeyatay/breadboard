# Gets the previous Breadboard install out of setup's way.
#
# Two stock electron-builder steps made upgrades fail with "Breadboard cannot
# be closed" although no Breadboard window was open:
#
#  1. The running-app check matches "Breadboard.exe" by name anywhere, kills
#     only that image name, and gives up on processes Windows is still tearing
#     down. Leftover helpers from the install folder (the runtime, Node and
#     Python services) are never closed.
#  2. Setup then runs the OLD version's uninstaller. With --updated it moves
#     every installed file (about 46,000) one by one into %TEMP%; one busy or
#     unmovable file makes it put everything back and fail, setup retries five
#     times (each a full pass, which is why it can take an hour) and then shows
#     that same dialog. That uninstaller ships with the old version, so a new
#     release cannot fix it.
#
# So, before the old uninstaller runs, this closes everything running from the
# install folder(s) and removes the previous app files itself with a
# long-path-safe delete. With its uninstaller gone, setup logs "not able to
# launch uninstaller" and installs fresh, rewriting the registry entry and
# shortcuts. Only application folders are touched: user data lives in
# %APPDATA%\breadboard-desktop (or the chosen data location) and is never here.
#
# -Mode close  : only close processes (used by the uninstaller).
# -Mode replace: close, then remove the previous application files.
# Exit 0 = ready. Exit 1 = something remains; stdout names it for the dialog.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [ValidateSet("close", "replace")][string]$Mode = "close"
)
$ErrorActionPreference = "SilentlyContinue"

function Normalize([string]$p) {
  if (-not $p) { return $null }
  $p = $p.Trim().Trim('"')
  try { return [System.IO.Path]::GetFullPath($p).TrimEnd('\') } catch { return $null }
}

# A folder we may empty: it holds a Breadboard executable or uninstaller and
# the app resources, and it is not a system, profile or drive root folder.
function Is-BreadboardAppFolder([string]$dir) {
  if (-not $dir -or -not (Test-Path -LiteralPath $dir -PathType Container)) { return $false }
  if ($dir.Length -le 3) { return $false }
  $hasExe = (Test-Path -LiteralPath (Join-Path $dir "Breadboard.exe")) -or
            (Test-Path -LiteralPath (Join-Path $dir "Uninstall Breadboard.exe"))
  $hasResources = (Test-Path -LiteralPath (Join-Path $dir "resources\app.asar")) -or
                  (Test-Path -LiteralPath (Join-Path $dir "resources\app-services")) -or
                  (Test-Path -LiteralPath (Join-Path $dir "resources.pak"))
  # A replacement interrupted by a held file leaves resources\ without the
  # executables; on Retry the same (target or registered) folder still counts.
  $leftover = (-not $hasExe) -and (Test-Path -LiteralPath (Join-Path $dir "resources") -PathType Container) -and
              @(Get-ChildItem -LiteralPath $dir -Force | Where-Object { $_.Name -ne "resources" }).Count -eq 0
  if (-not (($hasExe -and $hasResources) -or $leftover)) { return $false }
  # Never a data folder: those hold the database and runtime store.
  if ((Test-Path -LiteralPath (Join-Path $dir "Data\database")) -or
      (Test-Path -LiteralPath (Join-Path $dir "Data\runtime-v2"))) { return $false }
  $protected = @($env:USERPROFILE, $env:APPDATA, $env:LOCALAPPDATA, "$env:LOCALAPPDATA\Programs",
                 $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:SystemRoot, $env:TEMP,
                 [Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("MyDocuments")) |
               ForEach-Object { Normalize $_ } | Where-Object { $_ }
  foreach ($p in $protected) {
    if ($dir -ieq $p) { return $false }
    if ($p.StartsWith($dir + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
  }
  return $true
}

# Install folders: the target, plus every registered Breadboard install.
$roots = New-Object System.Collections.Generic.List[string]
$target = Normalize $InstallDir
if ($target) { $roots.Add($target) }
if ($Mode -eq "replace") {
  foreach ($hive in "HKCU:", "HKLM:") {
    foreach ($key in Get-ChildItem "$hive\Software\Microsoft\Windows\CurrentVersion\Uninstall") {
      $item = Get-ItemProperty -LiteralPath $key.PSPath
      if ($item.DisplayName -notlike "Breadboard*") { continue }
      $candidates = @($item.InstallLocation)
      if ($item.UninstallString -match '^\s*"([^"]+)"') { $candidates += (Split-Path -Parent $Matches[1]) }
      foreach ($c in $candidates) {
        $n = Normalize $c
        if ($n -and -not ($roots -contains $n)) { $roots.Add($n) }
      }
    }
  }
}

function Under-Roots([string]$path) {
  if (-not $path) { return $false }
  foreach ($r in $roots) {
    if ($path.StartsWith($r + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Get-InstallProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and (
      (Under-Roots $_.ExecutablePath) -or
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

function Close-Processes {
  $running = @(Get-InstallProcesses)
  if ($running.Count -eq 0) { return @() }
  # Ask open windows to quit normally; Breadboard then stops its runtime (~5 s).
  # Leftover helpers without a Breadboard.exe get only a moment before closing.
  $app = @($running | Where-Object { $_.Name -ieq "Breadboard.exe" })
  foreach ($p in $app) {
    $proc = Get-Process -Id $p.ProcessId
    if ($proc -and $proc.MainWindowHandle -ne 0) { [void]$proc.CloseMainWindow() }
  }
  $left = Wait-Gone $(if ($app.Count -gt 0) { 20 } else { 2 })
  if ($left.Count -eq 0) { return @() }
  foreach ($p in $left) { Stop-Process -Id $p.ProcessId -Force }
  $left = Wait-Gone 10
  if ($left.Count -eq 0) { return @() }
  & taskkill.exe /F /T @($left | ForEach-Object { "/PID"; "$($_.ProcessId)" }) *> $null
  return @(Wait-Gone 5)
}

$left = @(Close-Processes)
if ($left.Count -gt 0) {
  $left | ForEach-Object { "$($_.Name) (process $($_.ProcessId))" } | Select-Object -Unique
  exit 1
}
if ($Mode -ne "replace") { exit 0 }

# Remove the previous application files. `rd` takes \\?\ paths (no 260
# character limit) and removes junctions without following them.
$remaining = @()
foreach ($dir in $roots) {
  if (-not (Is-BreadboardAppFolder $dir)) { continue }
  for ($attempt = 0; $attempt -lt 3 -and (Test-Path -LiteralPath $dir); $attempt++) {
    & cmd.exe /d /c "rd /s /q `"\\?\$dir`"" *> $null
    if (-not (Test-Path -LiteralPath $dir)) { break }
    # A file someone still holds (an antivirus scan, a stray handle) cannot be
    # deleted but can be renamed: park it beside the folder, same volume.
    $park = Join-Path (Split-Path -Parent $dir) (".breadboard-replaced-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    foreach ($f in Get-ChildItem -LiteralPath $dir -Recurse -Force -File) {
      $dest = Join-Path $park ($f.FullName.Substring($dir.Length).TrimStart('\'))
      [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest))
      try { [System.IO.File]::Move("\\?\" + $f.FullName, "\\?\" + $dest) } catch { }
    }
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $dir) {
    $files = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -File | Select-Object -First 3)
    if ($files.Count -gt 0) { $remaining += $files | ForEach-Object { $_.FullName } }
    else { & cmd.exe /d /c "rd /s /q `"\\?\$dir`"" *> $null }
  }
}
# Parked leftovers from earlier upgrades go once nothing holds them.
foreach ($dir in $roots) {
  $parent = Split-Path -Parent $dir
  if (-not $parent) { continue }
  foreach ($old in Get-ChildItem -LiteralPath $parent -Directory -Force -Filter ".breadboard-replaced-*") {
    & cmd.exe /d /c "rd /s /q `"\\?\$($old.FullName)`"" *> $null
  }
}
if ($remaining.Count -gt 0) {
  # Name the program holding them (Windows Restart Manager), so the person
  # knows what to close instead of guessing.
  $holders = @()
  try {
    Add-Type -Language CSharp @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class BreadboardRm {
  [StructLayout(LayoutKind.Sequential)] struct UNIQUE_PROCESS { public int Pid; public System.Runtime.InteropServices.ComTypes.FILETIME Start; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct INFO {
    public UNIQUE_PROCESS Process; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string App;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Svc; public int Type; public int Status; public int Session; [MarshalAs(UnmanagedType.Bool)] public bool Restartable; }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, string key);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint n, string[] files, uint a, UNIQUE_PROCESS[] p, uint s, string[] svc);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint need, ref uint n, [In, Out] INFO[] info, ref uint reasons);
  public static List<string> Holders(string[] files) {
    var r = new List<string>(); uint h; if (RmStartSession(out h, 0, Guid.NewGuid().ToString()) != 0) return r;
    try { if (RmRegisterResources(h, (uint)files.Length, files, 0, null, 0, null) != 0) return r;
      uint need = 0, n = 0, reasons = 0; RmGetList(h, out need, ref n, null, ref reasons);
      if (need == 0) return r; var info = new INFO[need]; n = need;
      if (RmGetList(h, out need, ref n, info, ref reasons) != 0) return r;
      for (int i = 0; i < n; i++) r.Add(info[i].App + " (process " + info[i].Process.Pid + ")"); }
    finally { RmEndSession(h); } return r; } }
'@
    $holders = [BreadboardRm]::Holders([string[]]$remaining) | Select-Object -Unique
  } catch { }
  if ($holders.Count -gt 0) { "held open by: " + ($holders -join ", ") }
  "files that are still in use:"
  $remaining
  exit 1
}
exit 0
