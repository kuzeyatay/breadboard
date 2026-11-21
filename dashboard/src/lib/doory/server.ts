import "server-only";

import { spawn } from "node:child_process";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { resolveUv } from "../subsai/runtime.ts";

// Doory (vendored at doory/) is the Design page's editor. It starts on first use:
// a Python venv for its Django backend, its built web app, then doory/breadboard/serve.py,
// which serves the editor, API, realtime and MCP server on one loopback port.
// Installed builds stage doory/ (backend, serve.py, built frontend/dist) into app-services.

export const DOORY_PORT = Number(process.env.DOORY_PORT) || 8796;
export const DOORY_ORIGIN = `http://127.0.0.1:${DOORY_PORT}`;

export interface DooryAccess { port: number; ticket: string; token: string }

let starting: Promise<DooryAccess> | null = null;
let lastFailure: { at: number; message: string } | null = null;

const home = () => path.join(repositoryRoot(), "doory");
const data = () => path.join(dashboardDataDir(), "doory");
// Its own venv beside its data: runtime-v2 service venvs are an allowlisted, Rust-mirrored namespace.
const venv = () => path.join(data(), ".venv");
const python = () => path.join(venv(), process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

async function healthy(): Promise<boolean> {
  try { return (await fetch(`${DOORY_ORIGIN}/mcp/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

function run(command: string, args: string[], cwd: string, log: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(log, "a");
    const child = spawn(command, args, { cwd, stdio: ["ignore", out, out], windowsHide: true,
      // uv fetches Python 3.12 when none is installed; it lives with Doory's data, not in the user profile.
      env: { ...process.env, NODE_OPTIONS: "", UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR || path.join(data(), "python") } });
    child.on("error", reject);
    child.on("exit", code => { fs.closeSync(out); code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args[0]} failed (exit ${code}); see ${log}`)); });
  });
}

async function install(log: string): Promise<void> {
  const ready = path.join(venv(), ".breadboard-doory-ready");
  if (!fs.existsSync(ready)) {
    // Installed builds ship uv in resources/bin, beside app-services (repositoryRoot()).
    const packagedUv = path.join(repositoryRoot(), "..", "bin", process.platform === "win32" ? "uv.exe" : "uv");
    const uv = resolveUv() ?? (fs.existsSync(packagedUv) ? packagedUv : null);
    if (!uv) throw new Error("Design needs uv to set up its Python environment.");
    await run(uv, ["venv", "--allow-existing", "--python", "3.12", venv()], home(), log);
    await run(uv, ["pip", "install", "--python", python(), "-r", path.join(home(), "backend", "requirements.txt")], home(), log);
    fs.writeFileSync(ready, new Date().toISOString());
  }
  const frontend = path.join(home(), "frontend");
  if (!fs.existsSync(path.join(frontend, "dist", "index.html"))) {
    const npm = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (!fs.existsSync(path.join(frontend, "node_modules"))) await run(process.execPath, [npm, "ci", "--no-audit", "--no-fund"], frontend, log);
    await run(process.execPath, [path.join(frontend, "node_modules", "vite", "bin", "vite.js"), "build"], frontend, log);
  }
}

function access(): DooryAccess {
  const read = (name: string) => fs.readFileSync(path.join(data(), name), "utf8").trim();
  return { port: DOORY_PORT, ticket: read("ticket"), token: read("mcp-token") };
}

/** Doory running, with this launch's sign-in ticket and Bread's MCP token. */
export function ensureDoory(): Promise<DooryAccess> {
  if (starting) return starting;
  starting = (async () => {
    if (await healthy()) return access();
    if (!fs.existsSync(path.join(home(), "breadboard", "serve.py"))) throw new Error("Design (doory/) is not part of this installation.");
    fs.mkdirSync(data(), { recursive: true });
    const log = path.join(data(), "doory.log");
    await install(log);
    const out = fs.openSync(log, "a");
    const child = spawn(python(), [path.join(home(), "breadboard", "serve.py"), "--port", String(DOORY_PORT), "--data", data()], {
      cwd: data(), detached: true, stdio: ["ignore", out, out], windowsHide: true,
      // The dashboard's own database and gateway keys belong to other services.
      env: { ...process.env, DATABASE_URL: "", OPENAI_API_KEY: "", PYTHONUTF8: "1" },
    });
    child.on("error", () => {});
    child.unref();
    fs.closeSync(out);
    for (let attempt = 0; attempt < 240; attempt++) {
      if (await healthy()) { lastFailure = null; return access(); }
      if (child.exitCode !== null) throw new Error(`Design stopped while starting (exit ${child.exitCode}); see ${log}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Design did not start within a minute; see ${log}`);
  })().catch(error => {
    lastFailure = { at: Date.now(), message: error instanceof Error ? error.message : String(error) };
    throw error;
  }).finally(() => { starting = null; });
  return starting;
}

export function dooryStatus() {
  return { starting: starting !== null, error: lastFailure?.message ?? null };
}

/** POST raw image bytes into Doory as a new design the size of the picture. */
export async function importIntoDoory(bytes: Buffer, title: string): Promise<{ designId: string }> {
  const { ticket } = await ensureDoory();
  const response = await fetch(`${DOORY_ORIGIN}/__breadboard/import?title=${encodeURIComponent(title.slice(0, 200))}`, {
    method: "POST", headers: { "X-Breadboard-Ticket": ticket, "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes),
  });
  if (!response.ok) throw new Error(`Design could not import the image (${response.status}).`);
  const body = await response.json() as { design_id: string };
  return { designId: body.design_id };
}

export { focusDesign, focusedDesign } from "./context.ts";

async function dooryClient() {
  const { token } = await ensureDoory();
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: "breadboard", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${DOORY_ORIGIN}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

type Content = { type: string; data?: string; mimeType?: string; text?: string };

/** One call to Doory's own MCP server for Bread (the built-in `doory` connection). */
export async function callDooryMcp(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const client = await dooryClient();
  try {
    if (tool === "__breadboard_list_tools") {
      const { tools } = await client.listTools(undefined, { signal });
      return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    }
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: 180_000 });
    // Exported pictures stay out of the model's context; the Design page saves them to the chat.
    const content = (result.content as Content[] | undefined)?.map(part => part.type === "image"
      ? { type: "text", text: `[${part.mimeType} image, ${Math.round((part.data?.length ?? 0) * 0.75 / 1024)} KiB — shown in the Design editor; the user saves it to the chat with "Save to chat"]` }
      : part);
    return { ...result, content };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Page 1 of a design as PNG bytes, drawn by Doory's server-side export. */
export async function exportDesignPng(designId: string): Promise<Buffer> {
  const client = await dooryClient();
  try {
    const result = await client.callTool({ name: "export_design", arguments: { design_id: designId, format: "png" } }, undefined, { timeout: 180_000 });
    const image = (result.content as Content[]).find(part => part.type === "image" && part.data);
    if (!image?.data) throw new Error((result.content as Content[]).find(part => part.text)?.text ?? "Design could not export this design.");
    return Buffer.from(image.data, "base64");
  } finally {
    await client.close().catch(() => {});
  }
}
