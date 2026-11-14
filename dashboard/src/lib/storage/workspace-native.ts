import { spawn } from "node:child_process";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { runtimeProcessPath } from "../../../scripts/runtime-v2-paths.mjs";

// Native tools can retain a writable handle after their chat finishes. On
// Windows, a revision check followed by unlink is therefore insufficient. This
// helper denies write/delete sharing, verifies both copies through the locked
// handles, then marks only the verified source for deletion on close. NTFS
// compression uses the same exclusive handle and never replaces a file/path.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class WorkspaceStorageNative {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int c,ref int b,int n);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h,uint c,ref short b,int n,IntPtr o,int z,out int r,IntPtr x);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle h,StringBuilder b,uint n,uint f);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetCompressedFileSizeW(string p,out uint high);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindFirstStreamW(string p,int level,out StreamInfo data,uint flags);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool FindNextStreamW(IntPtr h,out StreamInfo data);
 [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StreamInfo { public long Size; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=296)] public string Name; }
 [StructLayout(LayoutKind.Sequential, Pack=4)] struct Info { public uint Attributes; public long Created,Accessed,Modified; public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
 static Exception Failure() { return new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
 static string Normalize(string p) { return Path.GetFullPath(p.Replace(@"\\?\", "")).TrimEnd('\\'); }
 static FileStream Open(string root,string path,bool remove,bool write,string identity) {
  root=Normalize(root); path=Normalize(path);
  if(!path.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase)) throw new IOException("Path escapes storage root");
  for(string p=path;p!=null;p=Path.GetDirectoryName(p)) {
   if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0) throw new IOException("Redirected storage path");
   if(p.Equals(root,StringComparison.OrdinalIgnoreCase)) break;
  }
  var h=CreateFileW(path,0x80000000u|(remove?0x10000u:0u)|(write?0x40000000u:0u),1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
  if(h.IsInvalid) { h.Dispose(); throw Failure(); }
  try {
   var name=new StringBuilder(32768); if(GetFinalPathNameByHandleW(h,name,32768,0)==0) throw Failure();
   if(!Normalize(name.ToString()).Equals(path,StringComparison.OrdinalIgnoreCase)) throw new IOException("Redirected file handle");
   Info info; if(!GetFileInformationByHandle(h,out info)) throw Failure();
   if((info.Attributes & (0x400u|0x10u))!=0 || info.Links!=1) throw new IOException("Shared or redirected workspace file");
   string id=(((ulong)info.IndexHigh<<32)|info.IndexLow).ToString();
   if(identity!="" && id!=identity) throw new IOException("Workspace revision changed");
   StreamInfo stream; var search=FindFirstStreamW(path,0,out stream,0);
   if(search==new IntPtr(-1)) throw Failure();
   try { do {if(stream.Name!="::$DATA") throw new IOException("Workspace file has alternate streams");} while(FindNextStreamW(search,out stream)); }
   finally { FindClose(search); }
   return new FileStream(h,write?FileAccess.ReadWrite:FileAccess.Read,65536,false);
  } catch { h.Dispose(); throw; }
 }
 static string Hash(FileStream f) { f.Position=0; using(var h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(f)).Replace("-","").ToLowerInvariant(); }
 static long Allocated(string p) { uint hi; uint lo=GetCompressedFileSizeW(p,out hi); if(lo==uint.MaxValue && Marshal.GetLastWin32Error()!=0) throw Failure(); return (long)(((ulong)hi<<32)|lo); }
 public static long Apply(string root,string path,string obj,string sha,string identity,string action,bool newObject) {
  bool compress=action=="compress";
  using(var source=Open(root,path,action=="deduplicate",compress,identity)) {
   long before=Allocated(path); if(action=="inspect")return before;
   string original=Hash(source);
   if(sha!="" && original!=sha) throw new IOException("Workspace content changed");
   if(compress) {
    short format=2; int returned;
    if(!DeviceIoControl(source.SafeFileHandle,0x9c040,ref format,2,IntPtr.Zero,0,out returned,IntPtr.Zero)) throw Failure();
    source.Flush(true); if(Hash(source)!=original) throw new IOException("Compression verification failed");
    return Math.Max(0,before-Allocated(path));
   }
   using(var saved=Open(root,obj,false,false,"")) {
    if(source.Length!=saved.Length || Hash(saved)!=original) throw new IOException("Archive verification failed");
    if(newObject && Allocated(obj)>before+4096)throw new IOException("Archive would increase allocated storage");
    int dispose=1; if(!SetFileInformationByHandle(source.SafeFileHandle,4,ref dispose,4)) throw Failure();
    return before;
   }
  }
 }
}
'@
 $r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BREADBOARD_WORKSPACE_STORAGE_REQUEST)) | ConvertFrom-Json
 $released = [WorkspaceStorageNative]::Apply($r.root,$r.path,$r.object,$r.hash,$r.identity,$r.action,[bool]$r.newObject)
 @{bytesReleased=$released} | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export async function nativeWorkspaceFile(input: {
  root: string; path: string; object?: string; hash?: string; identity: string;
  action: "deduplicate" | "compress" | "inspect"; newObject?: boolean; signal?: AbortSignal;
}): Promise<number> {
  if (process.platform !== "win32") throw new Error("Workspace archival requires exclusive native file handles on this platform.");
  const { signal, ...request } = input;
  return new Promise((resolve, reject) => {
    // Runtime V2 intentionally strips the interactive user's tool PATH. Pin
    // the OS executable instead of searching a writable workspace or PATH.
    const executable=path.win32.join(runtimeProcessPath(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows"),"System32","WindowsPowerShell","v1.0","powershell.exe");
    // Add-Type starts the .NET Framework compiler, whose environment block
    // still has a 64 KiB limit. Next's standalone configuration alone can
    // exceed that. This OS-only helper needs neither application configuration
    // nor credentials; give it only the Windows compilation prerequisites.
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    const allowed = new Set(["systemroot", "windir", "temp", "tmp", "userprofile", "localappdata", "appdata", "programdata", "programfiles", "programfiles(x86)", "commonprogramfiles", "commonprogramfiles(x86)", "comspec", "pathext"]);
    for (const [name, value] of Object.entries(process.env)) if (allowed.has(name.toLowerCase()) && value !== undefined) environment[name.toUpperCase()] = value;
    // Older installed Runtime generations expose canonical \\?\ TEMP paths.
    // .NET Framework's compiler rejects that spelling, despite Node accepting
    // the same directory. Normalize only this child's presentation, retaining
    // exactly the runtime-owned temp directory and filesystem authority.
    for(const name of ["TEMP","TMP"] as const)if(environment[name])environment[name]=runtimeProcessPath(environment[name]);
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...environment, BREADBOARD_WORKSPACE_STORAGE_REQUEST: Buffer.from(JSON.stringify({ object: "", hash: "", ...request })).toString("base64") },
    });
    let output = "", errors = "";
    const stop = () => { child.kill(); };
    const timeout = setTimeout(stop, 20_000);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 4096) stop(); });
    child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-2048); });
    const finish = () => { clearTimeout(timeout); signal?.removeEventListener("abort", stop); };
    child.once("error", error => { finish(); reject(error); });
    child.once("close", code => {
      finish();
      if (code !== 0) { reject(new Error(errors.trim() || "Workspace maintenance interrupted; the durable copy is retained.")); return; }
      try {
        const value = JSON.parse(output);
        if (!Number.isSafeInteger(value.bytesReleased) || value.bytesReleased < 0) throw new Error("Invalid workspace storage receipt");
        resolve(value.bytesReleased);
      } catch (error) { reject(error); }
    });
  });
}
