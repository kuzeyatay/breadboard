$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;
public static class BreadboardMemoryQaPerformanceInfo {
  [StructLayout(LayoutKind.Sequential)] public struct PERFORMANCE_INFORMATION {
    public uint cb; public UIntPtr CommitTotal; public UIntPtr CommitLimit; public UIntPtr CommitPeak;
    public UIntPtr PhysicalTotal; public UIntPtr PhysicalAvailable; public UIntPtr SystemCache;
    public UIntPtr KernelTotal; public UIntPtr KernelPaged; public UIntPtr KernelNonpaged;
    public UIntPtr PageSize; public uint HandleCount; public uint ProcessCount; public uint ThreadCount;
  }
  [DllImport("psapi.dll", SetLastError=true)]
  public static extern bool GetPerformanceInfo(out PERFORMANCE_INFORMATION value, uint size);
}
'@
Add-Type -TypeDefinition $source

while (($request = [Console]::In.ReadLine()) -ne $null) {
  if ($request -ne 'sample' -and $request -ne 'sample-with-listeners') {
    [Console]::Out.WriteLine('{"error":"malformed_request"}')
    continue
  }
  try {
    $performance = New-Object BreadboardMemoryQaPerformanceInfo+PERFORMANCE_INFORMATION
    $performance.cb = [Runtime.InteropServices.Marshal]::SizeOf($performance)
    if (-not [BreadboardMemoryQaPerformanceInfo]::GetPerformanceInfo([ref]$performance, $performance.cb)) {
      throw 'GetPerformanceInfo failed'
    }
    $page = [uint64]$performance.PageSize
    $parents = @{}
    Get-CimInstance Win32_Process | ForEach-Object {
      $parents[[int]$_.ProcessId] = [int]$_.ParentProcessId
    }
    $processes = @(Get-Process | ForEach-Object {
      $pidValue = [int]$_.Id
      [pscustomobject]@{
        pid = $pidValue
        parentPid = if ($parents.ContainsKey($pidValue)) { $parents[$pidValue] } else { 0 }
        name = [string]$_.ProcessName
        privateBytes = [uint64]$_.PrivateMemorySize64
        workingSetBytes = [uint64]$_.WorkingSet64
      }
    })
    $listeners = @()
    if ($request -eq 'sample-with-listeners') {
      try {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object {
          [pscustomobject]@{
            localAddress = [string]$_.LocalAddress
            port = [uint16]$_.LocalPort
            ownerPid = [int]$_.OwningProcess
          }
        })
      } catch {
        # Process and commit evidence remains useful on Windows editions where
        # the NetTCPIP provider is unavailable. Callers that need listener
        # ownership fail that gate explicitly instead of treating it as a skip.
      }
    }
    [pscustomobject]@{
      sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      commitTotalMb = ([uint64]$performance.CommitTotal * $page) / 1MB
      commitLimitMb = ([uint64]$performance.CommitLimit * $page) / 1MB
      physicalTotalMb = ([uint64]$performance.PhysicalTotal * $page) / 1MB
      physicalAvailableMb = ([uint64]$performance.PhysicalAvailable * $page) / 1MB
      processCount = [uint32]$performance.ProcessCount
      processes = $processes
      listeningPorts = $listeners
    } | ConvertTo-Json -Compress -Depth 4
  } catch {
    [pscustomobject]@{ error = [string]$_.Exception.Message } | ConvertTo-Json -Compress
  }
}
