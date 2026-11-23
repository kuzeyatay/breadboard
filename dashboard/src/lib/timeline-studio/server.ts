import "server-only";

import { spawn } from "node:child_process";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

// Timeline Studio (vendored at timeline-studio/) is Video Studio's editor. It is a static
// browser app: timeline-studio/breadboard/serve.mjs serves its build on one loopback port
// and injects the bridge that lets the Video Studio page call the editor's own tools.

export const TIMELINE_STUDIO_PORT = Number(process.env.TIMELINE_STUDIO_PORT) || 8797;
const ORIGIN = `http://127.0.0.1:${TIMELINE_STUDIO_PORT}`;

let starting: Promise<{ port: number }> | null = null;

const home = () => path.join(repositoryRoot(), "timeline-studio");
export const studioDataDir = () => path.join(dashboardDataDir(), "timeline-studio");

async function healthy(): Promise<boolean> {
  try { return (await fetch(`${ORIGIN}/__breadboard/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

function run(args: string[], cwd: string, log: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(log, "a");
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", out, out], windowsHide: true, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" } });
    child.on("error", reject);
    child.on("exit", code => { fs.closeSync(out); code === 0 ? resolve() : reject(new Error(`Video Studio setup failed (exit ${code}); see ${log}`)); });
  });
}

/** A source checkout builds the editor on first use; installed builds ship dist/. */
async function build(log: string): Promise<void> {
  if (fs.existsSync(path.join(home(), "dist", "index.html"))) return;
  if (!fs.existsSync(path.join(home(), "node_modules", "vite"))) {
    const npm = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    await run([npm, "ci", "--no-audit", "--no-fund", "--ignore-scripts"], home(), log);
  }
  await run([path.join(home(), "node_modules", "vite", "bin", "vite.js"), "build"], home(), log);
}

/** The editor's server running; first use in a checkout installs and builds it. */
export function ensureTimelineStudio(): Promise<{ port: number }> {
  if (starting) return starting;
  starting = (async () => {
    if (await healthy()) return { port: TIMELINE_STUDIO_PORT };
    const serve = path.join(home(), "breadboard", "serve.mjs");
    if (!fs.existsSync(serve)) throw new Error("Video Studio (timeline-studio/) is not part of this installation.");
    fs.mkdirSync(studioDataDir(), { recursive: true });
    const log = path.join(studioDataDir(), "timeline-studio.log");
    await build(log);
    const out = fs.openSync(log, "a");
    const child = spawn(process.execPath, [serve, "--port", String(TIMELINE_STUDIO_PORT)], {
      cwd: home(), detached: true, stdio: ["ignore", out, out], windowsHide: true, env: { ...process.env, NODE_OPTIONS: "" },
    });
    child.on("error", () => {});
    child.unref();
    fs.closeSync(out);
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await healthy()) return { port: TIMELINE_STUDIO_PORT };
      if (child.exitCode !== null) throw new Error(`Video Studio stopped while starting (exit ${child.exitCode}); see ${log}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Video Studio did not start in time; see ${log}`);
  })().finally(() => { starting = null; });
  return starting;
}
