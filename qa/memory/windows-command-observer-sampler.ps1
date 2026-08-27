param(
  [ValidateSet('sample-server', 'terminate-exact-trees')]
  [string]$Mode = 'sample-server'
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;
public static class BreadboardCommandObserverPerformanceInfo {
  [StructLayout(LayoutKind.Sequential)] public struct PERFORMANCE_INFORMATION {
    public uint cb; public UIntPtr CommitTotal; public UIntPtr CommitLimit; public UIntPtr CommitPeak;
    public UIntPtr PhysicalTotal; public UIntPtr PhysicalAvailable; public UIntPtr SystemCache;
    public UIntPtr KernelTotal; public UIntPtr KernelPaged; public UIntPtr KernelNonpaged;
    public UIntPtr PageSize; public uint HandleCount; public uint ProcessCount; public uint ThreadCount;
  }
  [StructLayout(LayoutKind.Sequential)] public struct FILETIME {
    public uint LowDateTime;
    public uint HighDateTime;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_BASIC_INFORMATION {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("psapi.dll", SetLastError=true)]
  public static extern bool GetPerformanceInfo(out PERFORMANCE_INFORMATION value, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetProcessTimes(
    IntPtr process,
    out FILETIME creation,
    out FILETIME exit,
    out FILETIME kernel,
    out FILETIME user
  );
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("ntdll.dll")]
  public static extern int NtQueryInformationProcess(
    IntPtr process,
    int processInformationClass,
    out PROCESS_BASIC_INFORMATION processInformation,
    uint processInformationLength,
    out uint returnLength
  );

  public static bool TryGetCreationFileTime(IntPtr process, out ulong fileTime) {
    FILETIME creation;
    FILETIME exit;
    FILETIME kernel;
    FILETIME user;
    fileTime = 0;
    if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) return false;
    fileTime = ((ulong)creation.HighDateTime << 32) | creation.LowDateTime;
    return true;
  }
  public static bool TryGetParentProcessId(IntPtr process, out int parentProcessId) {
    PROCESS_BASIC_INFORMATION information;
    uint returned;
    parentProcessId = 0;
    int status = NtQueryInformationProcess(
      process,
      0,
      out information,
      (uint)Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)),
      out returned
    );
    if (status != 0) return false;
    long value = information.InheritedFromUniqueProcessId.ToInt64();
    if (value < 0 || value > Int32.MaxValue) return false;
    parentProcessId = (int)value;
    return true;
  }
}
'@
Add-Type -TypeDefinition $source

function Get-BreadboardExactProcessSnapshot {
  Get-Process | ForEach-Object {
    $nativeProcess = $_
    try {
      $handle = [IntPtr]$nativeProcess.Handle
      $creationTime = [uint64]0
      $parentPid = [int]0
      if (-not [BreadboardCommandObserverPerformanceInfo]::TryGetCreationFileTime(
        $handle,
        [ref]$creationTime
      )) { throw 'creation_time_unavailable' }
      if (-not [BreadboardCommandObserverPerformanceInfo]::TryGetParentProcessId(
        $handle,
        [ref]$parentPid
      )) { throw 'parent_pid_unavailable' }
      $executablePath = try { [string]$nativeProcess.Path } catch { $null }
      [pscustomobject]@{
        pid = [int]$nativeProcess.Id
        parentPid = $parentPid
        creationTime = $creationTime
        creationTimeText = $creationTime.ToString([Globalization.CultureInfo]::InvariantCulture)
        creationTimeUnixMs = [long](([long]$creationTime - 116444736000000000) / 10000)
        name = [string]$nativeProcess.Name
        executablePath = $executablePath
        privateBytes = [uint64]$nativeProcess.PrivateMemorySize64
        workingSetBytes = [uint64]$nativeProcess.WorkingSet64
        process = $nativeProcess
        handle = $handle
      }
    } catch {
      $nativeProcess.Dispose()
    }
  }
}

function Invoke-BreadboardExactTreeTermination {
  param([object[]]$RequestedIdentities)

  if ($RequestedIdentities.Count -gt 16384) { throw 'too_many_identities' }
  $requests = @{}
  foreach ($request in $RequestedIdentities) {
    if ($null -eq $request.pid -or $null -eq $request.creationTime) {
      throw 'invalid_identity'
    }
    $pidValue = [int64]$request.pid
    $creationText = [string]$request.creationTime
    if ($creationText -notmatch '^[0-9]{1,20}$') { throw 'invalid_identity' }
    $creationValue = [uint64]$creationText
    if ($pidValue -le 0 -or $pidValue -gt [int]::MaxValue) {
      throw 'invalid_identity'
    }
    $key = "${pidValue}@${creationValue}"
    $requests[$key] = [pscustomobject]@{
      pid = [int]$pidValue
      creationTime = [uint64]$creationValue
    }
  }

  $owned = @{}
  $ownedByPid = @{}
  $hadFailure = $false
  $matchedCount = 0
  $terminatedCount = 0
  $discoveryRoundCount = 0

  $openExact = {
    param([int]$TargetPid, [uint64]$ExpectedCreationTime, [int]$Depth)
    $nativeProcess = $null
    try {
      $nativeProcess = Get-Process -Id $TargetPid -ErrorAction Stop
      $handle = [IntPtr]$nativeProcess.Handle
      $actualCreationTime = [uint64]0
      if (-not [BreadboardCommandObserverPerformanceInfo]::TryGetCreationFileTime(
        $handle,
        [ref]$actualCreationTime
      )) {
        $nativeProcess.Dispose()
        return $null
      }
      if ($actualCreationTime -ne $ExpectedCreationTime) {
        $nativeProcess.Dispose()
        return $null
      }
      [pscustomobject]@{
        pid = $TargetPid
        creationTime = $ExpectedCreationTime
        depth = $Depth
        process = $nativeProcess
        handle = $handle
        terminationAttempted = $false
      }
    } catch {
      if ($null -ne $nativeProcess) { $nativeProcess.Dispose() }
      $null
    }
  }

  $matchedRequests = @{}
  foreach ($request in $requests.Values) {
    $entry = & $openExact $request.pid $request.creationTime 0
    if ($null -eq $entry) { continue }
    $key = "$($entry.pid)@$($entry.creationTime)"
    $owned[$key] = $entry
    $ownedByPid[$entry.pid] = $entry
    $matchedRequests[$key] = $true
    $matchedCount += 1
  }

  $stableZeroDescendantScan = $false
  for ($round = 0; $round -lt 8; $round += 1) {
    $discoveryRoundCount += 1
    $snapshot = @(Get-BreadboardExactProcessSnapshot)
    $newOwnedCount = 0
    $changed = $true
    while ($changed) {
      $changed = $false
      foreach ($record in $snapshot) {
        $key = "$($record.pid)@$($record.creationTime)"
        if ($owned.ContainsKey($key)) { continue }
        if ($requests.ContainsKey($key)) {
          $record | Add-Member -NotePropertyName depth -NotePropertyValue 0
          $record | Add-Member -NotePropertyName terminationAttempted -NotePropertyValue $false
          $owned[$key] = $record
          $ownedByPid[$record.pid] = $record
          if (-not $matchedRequests.ContainsKey($key)) {
            $matchedRequests[$key] = $true
            $matchedCount += 1
          }
          $newOwnedCount += 1
          $changed = $true
          continue
        }
        if ($ownedByPid.ContainsKey($record.pid)) { continue }
        $parent = $ownedByPid[$record.parentPid]
        if (
          $null -eq $parent -or
          $record.creationTime -lt $parent.creationTime
        ) { continue }
        $record | Add-Member -NotePropertyName depth -NotePropertyValue ($parent.depth + 1)
        $record | Add-Member -NotePropertyName terminationAttempted -NotePropertyValue $false
        $owned[$key] = $record
        $ownedByPid[$record.pid] = $record
        $newOwnedCount += 1
        $changed = $true
      }
    }
    foreach ($record in $snapshot) {
      $key = "$($record.pid)@$($record.creationTime)"
      if (-not $owned.ContainsKey($key)) { $record.process.Dispose() }
      elseif ($owned[$key].process -ne $record.process) { $record.process.Dispose() }
    }

    $pending = @($owned.Values | Where-Object { -not $_.terminationAttempted } | Sort-Object depth)
    foreach ($entry in $pending) {
      $entry.terminationAttempted = $true
      $waitResult = [BreadboardCommandObserverPerformanceInfo]::WaitForSingleObject($entry.handle, 0)
      if ($waitResult -ne 258) { continue }
      if ([BreadboardCommandObserverPerformanceInfo]::TerminateProcess($entry.handle, 1)) {
        $terminatedCount += 1
      }
    }
    foreach ($entry in $pending) {
      [void][BreadboardCommandObserverPerformanceInfo]::WaitForSingleObject($entry.handle, 5000)
    }
    $allOwnedExited = @($owned.Values | Where-Object {
      [BreadboardCommandObserverPerformanceInfo]::WaitForSingleObject($_.handle, 0) -eq 258
    }).Count -eq 0
    if ($newOwnedCount -eq 0 -and $pending.Count -eq 0 -and $allOwnedExited) {
      $stableZeroDescendantScan = $true
      break
    }
    if ($round -lt 7) { Start-Sleep -Milliseconds 100 }
  }

  $survivingCount = 0
  foreach ($entry in $owned.Values) {
    if ([BreadboardCommandObserverPerformanceInfo]::WaitForSingleObject($entry.handle, 0) -eq 258) {
      $survivingCount += 1
    }
  }
  foreach ($entry in $owned.Values) { $entry.process.Dispose() }

  foreach ($request in $requests.Values) {
    $key = "$($request.pid)@$($request.creationTime)"
    if ($matchedRequests.ContainsKey($key)) { continue }
    if ($null -ne (Get-Process -Id $request.pid -ErrorAction SilentlyContinue)) {
      $hadFailure = $true
    }
  }

  $status = if (
    -not $hadFailure -and
    $survivingCount -eq 0 -and
    $stableZeroDescendantScan
  ) { 'complete' } else { 'incomplete' }
  [pscustomobject]@{
    status = $status
    requestedCount = $requests.Count
    matchedCount = $matchedCount
    terminatedCount = $terminatedCount
    survivingCount = $survivingCount
    ownedProcessCount = $owned.Count
    discoveryRoundCount = $discoveryRoundCount
    postTerminationStableScan = $stableZeroDescendantScan
  }
}

function Get-BreadboardExactIdentity {
  param([int]$TargetPid)
  $nativeProcess = $null
  try {
    $nativeProcess = Get-Process -Id $TargetPid -ErrorAction Stop
    $handle = [IntPtr]$nativeProcess.Handle
    $creationTime = [uint64]0
    if (-not [BreadboardCommandObserverPerformanceInfo]::TryGetCreationFileTime(
      $handle,
      [ref]$creationTime
    )) { return $null }
    [pscustomobject]@{
      status = 'found'
      pid = $TargetPid
      creationTime = $creationTime.ToString([Globalization.CultureInfo]::InvariantCulture)
    }
  } catch {
    $null
  } finally {
    if ($null -ne $nativeProcess) { $nativeProcess.Dispose() }
  }
}

function Write-BreadboardSample {
  $performance = New-Object BreadboardCommandObserverPerformanceInfo+PERFORMANCE_INFORMATION
  $performance.cb = [Runtime.InteropServices.Marshal]::SizeOf($performance)
  if (-not [BreadboardCommandObserverPerformanceInfo]::GetPerformanceInfo(
    [ref]$performance,
    $performance.cb
  )) {
    throw 'GetPerformanceInfo failed'
  }

  $page = [uint64]$performance.PageSize
  $snapshot = @(Get-BreadboardExactProcessSnapshot)
  try {
    $processes = @($snapshot | ForEach-Object {
      [pscustomobject]@{
        pid = $_.pid
        parentPid = $_.parentPid
        creationTime = [string]$_.creationTimeText
        creationTimeUnixMs = $_.creationTimeUnixMs
        name = $_.name
        executablePath = $_.executablePath
        privateBytes = [uint64]$_.privateBytes
        workingSetBytes = [uint64]$_.workingSetBytes
      }
    })
  } finally {
    foreach ($record in $snapshot) { $record.process.Dispose() }
  }

  [pscustomobject]@{
    sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    commitTotalMb = ([uint64]$performance.CommitTotal * $page) / 1MB
    commitLimitMb = ([uint64]$performance.CommitLimit * $page) / 1MB
    physicalTotalMb = ([uint64]$performance.PhysicalTotal * $page) / 1MB
    physicalAvailableMb = ([uint64]$performance.PhysicalAvailable * $page) / 1MB
    processCount = [uint32]$performance.ProcessCount
    processes = $processes
  }
}

if ($Mode -eq 'terminate-exact-trees') {
  try {
    $payload = [Console]::In.ReadLine()
    if ($null -eq $payload -or $payload.Length -gt 1048576) { throw 'invalid_payload' }
    $requested = @($payload | ConvertFrom-Json)
    $result = Invoke-BreadboardExactTreeTermination -RequestedIdentities $requested
    $result | ConvertTo-Json -Compress
    if ($result.status -ne 'complete') { exit 1 }
    exit 0
  } catch {
    [pscustomobject]@{ error = 'termination_failed' } | ConvertTo-Json -Compress
    exit 1
  }
}

while (($request = [Console]::In.ReadLine()) -ne $null) {
  if ($request -eq 'close') { break }
  if ($request -eq 'sample') {
    try {
      Write-BreadboardSample | ConvertTo-Json -Compress -Depth 4
    } catch {
      [pscustomobject]@{ error = 'sample_failed' } | ConvertTo-Json -Compress
    }
    continue
  }
  if ($request.StartsWith('identity ')) {
    try {
      $pidText = $request.Substring(9)
      if ($pidText -notmatch '^[0-9]{1,10}$') { throw 'invalid_pid' }
      $pidValue = [int64]$pidText
      if ($pidValue -le 0 -or $pidValue -gt [int]::MaxValue) { throw 'invalid_pid' }
      $identity = Get-BreadboardExactIdentity -TargetPid ([int]$pidValue)
      if ($null -eq $identity) {
        [pscustomobject]@{ status = 'not-found' } | ConvertTo-Json -Compress
      } else {
        $identity | ConvertTo-Json -Compress
      }
    } catch {
      [pscustomobject]@{ error = 'identity_failed' } | ConvertTo-Json -Compress
    }
    continue
  }
  if ($request.StartsWith('terminate ')) {
    try {
      $payload = $request.Substring(10)
      if ($payload.Length -gt 1048576) { throw 'invalid_payload' }
      $requested = @($payload | ConvertFrom-Json)
      Invoke-BreadboardExactTreeTermination -RequestedIdentities $requested |
        ConvertTo-Json -Compress
    } catch {
      [pscustomobject]@{ error = 'termination_failed' } | ConvertTo-Json -Compress
    }
    continue
  }
  [Console]::Out.WriteLine('{"error":"malformed_request"}')
}
