import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as os from "node:os";
import { MIB, type SystemMemorySnapshot } from "./memory-policy";
import type { SystemMemoryMetricSource } from "./memory-governor";

interface PendingSample {
  resolve: (snapshot: SystemMemorySnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Persistent, secret-free GetPerformanceInfo bridge.
 *
 * PowerShell loads the tiny P/Invoke declaration once and then answers one
 * line per `sample` request. Keeping it alive avoids launching a 40-80 MB
 * PowerShell process on every governor tick while still using the Windows API
 * that Task Manager's commit figures are based on.
 */
export class WindowsPerformanceInfoSource implements SystemMemoryMetricSource {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending: PendingSample[] = [];
  private stdout = "";

  async sample(): Promise<SystemMemorySnapshot> {
    this.ensureChild();
    const child = this.child;
    if (!child) throw new Error("Windows commit metric helper is unavailable.");
    return new Promise<SystemMemorySnapshot>((resolve, reject) => {
      const pending: PendingSample = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.pending.indexOf(pending);
          if (index >= 0) this.pending.splice(index, 1);
          reject(new Error("GetPerformanceInfo metric request timed out."));
        }, 10_000),
      };
      pending.timer.unref?.();
      this.pending.push(pending);
      child.stdin.write("sample\n", (error) => {
        if (!error) return;
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        clearTimeout(pending.timer);
        reject(error);
      });
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Windows commit metric helper stopped."));
    }
    if (!child) return;
    child.stdin.end();
    child.kill();
  }

  private ensureChild(): void {
    if (this.child && this.child.exitCode === null) return;
    if (process.platform !== "win32") {
      throw new Error("GetPerformanceInfo is available only on Windows.");
    }
    const script = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class BreadboardPerformanceInfo {
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
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line -ne 'sample') { [Console]::Out.WriteLine('{"error":"malformed_request"}'); continue }
  $value = New-Object BreadboardPerformanceInfo+PERFORMANCE_INFORMATION
  $value.cb = [Runtime.InteropServices.Marshal]::SizeOf($value)
  if (-not [BreadboardPerformanceInfo]::GetPerformanceInfo([ref]$value, $value.cb)) {
    [Console]::Out.WriteLine('{"error":"GetPerformanceInfo_failed"}')
    continue
  }
  $page = [uint64]$value.PageSize
  [pscustomobject]@{
    sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    commitTotalMb = ([uint64]$value.CommitTotal * $page) / 1MB
    commitLimitMb = ([uint64]$value.CommitLimit * $page) / 1MB
    physicalTotalMb = ([uint64]$value.PhysicalTotal * $page) / 1MB
    physicalAvailableMb = ([uint64]$value.PhysicalAvailable * $page) / 1MB
  } | ConvertTo-Json -Compress
}
`;
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.stderr.resume();
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      for (const pending of this.pending.splice(0)) {
        clearTimeout(pending.timer);
        pending.reject(new Error("GetPerformanceInfo metric helper exited."));
      }
    });
  }

  private consume(chunk: string): void {
    this.stdout += chunk;
    for (;;) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending.shift();
      if (!pending) continue;
      clearTimeout(pending.timer);
      try {
        const value = JSON.parse(line) as Partial<SystemMemorySnapshot> & { error?: string };
        if (value.error) throw new Error(value.error);
        for (const key of [
          "sampledAt",
          "commitTotalMb",
          "commitLimitMb",
          "physicalTotalMb",
          "physicalAvailableMb",
        ] as const) {
          if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
            throw new Error(`GetPerformanceInfo returned an invalid ${key}.`);
          }
        }
        pending.resolve(value as SystemMemorySnapshot);
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

export const portableSystemMemorySource: SystemMemoryMetricSource = {
  async sample(): Promise<SystemMemorySnapshot> {
    const physicalTotalMb = os.totalmem() / MIB;
    const physicalAvailableMb = os.freemem() / MIB;
    return {
      sampledAt: Date.now(),
      // POSIX has no Windows commit limit. Treat physical use as committed so
      // the same admission state machine remains conservative and testable.
      commitTotalMb: physicalTotalMb - physicalAvailableMb,
      commitLimitMb: physicalTotalMb,
      physicalTotalMb,
      physicalAvailableMb,
    };
  },
};

export function defaultSystemMemorySource(): SystemMemoryMetricSource & { stop?: () => void } {
  return process.platform === "win32"
    ? new WindowsPerformanceInfoSource()
    : portableSystemMemorySource;
}
