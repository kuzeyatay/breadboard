import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createDisposableScratch, releaseDisposableScratch } from "../storage/scratch.ts";
import path from "node:path";

const metafileTypes = new Map([
  ["image/emf", "emf"],
  ["image/x-emf", "emf"],
  ["image/wmf", "wmf"],
  ["image/x-wmf", "wmf"],
]);

// Fixed script and environment variables keep untrusted document names and
// bytes out of the PowerShell command line. GDI+ is available on Windows, where
// the desktop document importer runs; other platforms retain the source asset.
const renderScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$inputPath = $env:BREADBOARD_METAFILE_INPUT
$outputPath = $env:BREADBOARD_METAFILE_OUTPUT
$image = [System.Drawing.Imaging.Metafile]::FromFile($inputPath)
try {
  $width = [int][Math]::Min(4096, [Math]::Max(1, $image.Width * 2))
  $height = [int][Math]::Min(4096, [Math]::Max(1, $image.Height * 2))
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image, [System.Drawing.Rectangle]::new(0, 0, $width, $height))
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose() }
  } finally { $bitmap.Dispose() }
} finally { $image.Dispose() }
`;

/** Give embedded Office metafiles a browser- and vision-readable PNG copy. */
export function renderWindowsMetafileToPng(data: Buffer, mediaType: string): Buffer | null {
  const extension = metafileTypes.get(mediaType.toLowerCase());
  if (!extension || process.platform !== "win32" || data.length === 0 || data.length > 25 * 1024 * 1024) return null;
  let directory: string | undefined;
  try {
    directory = createDisposableScratch("metafile-render");
    const inputPath = path.join(directory, `image.${extension}`);
    const outputPath = path.join(directory, "image.png");
    writeFileSync(inputPath, data, { flag: "wx" });
    // Runtime workers get no PATH (only SystemRoot), so a bare "powershell.exe" never resolves there.
    const render = spawnSync(windowsPowerShellPath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", renderScript], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, BREADBOARD_METAFILE_INPUT: inputPath, BREADBOARD_METAFILE_OUTPUT: outputPath },
    });
    if (render.status !== 0 || render.error) return null;
    const png = readFileSync(outputPath);
    return png.length >= 8 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? png : null;
  } catch { return null; }
  finally { if (directory) { releaseDisposableScratch(directory); rmSync(directory, { recursive: true, force: true }); } }
}

export function windowsPowerShellPath(environment: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = environment.SystemRoot || environment.SYSTEMROOT || environment.windir || "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
