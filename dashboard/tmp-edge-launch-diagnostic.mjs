import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-edge-diag-"));
const html = path.join(root, "blank.html");
fs.writeFileSync(html, "<!doctype html><html><body><main>edge headless diagnostic</main></body></html>", "utf8");
const url = pathToFileURL(html).href;

const base = [
  "--headless=new",
  "--disable-gpu",
  "--disable-gpu-shader-disk-cache",
  "--disable-skia-graphite",
  "--disable-features=SkiaGraphiteUsePersistentCache",
  "--disable-extensions",
  "--disable-background-networking",
  "--no-first-run",
  "--window-size=375,667",
  "--virtual-time-budget=1000",
  "--dump-dom",
];

const variants = [
  ["current", []],
  ["webgpu-disabled", ["--disable-features=WebGPU"]],
  ["vulkan-disabled", ["--disable-features=Vulkan"]],
  ["swiftshader-angle", ["--use-angle=swiftshader"]],
  ["swiftshader-gl", ["--use-gl=swiftshader"]],
  ["in-process-gpu", ["--in-process-gpu"]],
  ["disable-gpu-sandbox", ["--disable-gpu-sandbox"]],
];

for (const [name, extra] of variants) {
  const profile = path.join(root, `profile-${name}`);
  const result = spawnSync(edge, [
    `--user-data-dir=${profile}`,
    ...base,
    ...extra,
    url,
  ], { encoding: "utf8", timeout: 25_000, windowsHide: true });
  console.log(JSON.stringify({
    name,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: String(result.stdout ?? "").slice(-800),
    stderr: String(result.stderr ?? "").slice(-2400),
  }));
}

console.log(JSON.stringify({ root }));
