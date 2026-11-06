import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

await import("../scripts/learn-worker-import-hook.mjs");
const { renderWindowsMetafileToPng, windowsPowerShellPath } = await import("../src/lib/anydoc/render-windows-metafile.ts");

test("PowerShell resolves from SystemRoot", () => {
  assert.equal(windowsPowerShellPath({ SystemRoot: "D:\\Win" }), "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});

// telecom-1 (2026-10-11): the ingestion worker gets SystemRoot but no PATH, so a bare
// "powershell.exe" never spawned and pptx figures were saved as browser-unreadable EMF.
test("an EMF renders to PNG without PATH", { skip: process.platform !== "win32" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "metafile-test-"));
  try {
    const emf = path.join(dir, "line.emf");
    const make = spawnSync(windowsPowerShellPath(), ["-NoProfile", "-NonInteractive", "-Command", `
      Add-Type -AssemblyName System.Drawing
      $b = [System.Drawing.Bitmap]::new(1, 1); $g = [System.Drawing.Graphics]::FromImage($b); $h = $g.GetHdc()
      $m = [System.Drawing.Imaging.Metafile]::new('${emf}', $h); $g.ReleaseHdc($h)
      $mg = [System.Drawing.Graphics]::FromImage($m); $mg.DrawLine([System.Drawing.Pens]::Black, 0, 0, 40, 20); $mg.Dispose(); $m.Dispose()`]);
    assert.equal(make.status, 0, String(make.stderr));
    const savedPath = process.env.PATH;
    delete process.env.PATH;
    let png;
    try { png = renderWindowsMetafileToPng(readFileSync(emf), "image/emf"); } finally { process.env.PATH = savedPath; }
    assert.ok(png, "renderer returned null");
    assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
