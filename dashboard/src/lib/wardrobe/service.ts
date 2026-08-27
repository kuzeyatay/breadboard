// The Wardrobe app, supervised as one long-lived local service.
//
// The runtime *is* the dev server. `scripts/import-job-api.mjs` is a Vite plugin,
// so `/api/import/*` — detection, generation, chroma removal, the atomic library
// write — only exists while Vite is running, and the same server is the gallery
// the person opens afterwards to look at what was imported. So it is started
// lazily on the first run and then left up rather than torn down with the run.
//
// Every model setting is passed through the child's environment rather than
// written into the clone's `.env`. Vite's `loadEnv` lets `process.env` win over
// a parsed `.env` file, so this both reaches the plugin and leaves a file the
// person may have written for their own use alone.

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { config } from "./client.ts";
import { ensureImagesBridge } from "./bridge.ts";
import {
  modelReferencePath,
  resolveWardrobeRoot,
  viteEntry,
  wardrobeDataDir,
  wardrobeRuntimeRoot,
} from "./runtime.ts";

export interface WardrobeService {
  /** The dev server's origin — the API base and the gallery address both. */
  baseUrl: string;
  root: string;
  startedAt: number;
}

interface ServiceState extends WardrobeService {
  child: ChildProcess;
  /** ChatMock's base URL this server's bridge was pointed at. */
  upstreamUrl: string;
  /** The settings it booted with. The clone reads them once, at config time. */
  model: string;
  quality: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardWardrobeService?: ServiceState | null;
  __breadboardWardrobeStarting?: Promise<WardrobeService> | null;
};

const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 500;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

/**
 * Two servers differ only in what the clone would have read at config time. It
 * reads its model and its image quality once, at boot, so a changed setting is a
 * restart rather than a flag — which is what the settings panel promises.
 */
function sameShape(state: ServiceState, options: StartOptions): boolean {
  return (
    state.upstreamUrl === options.upstreamUrl.replace(/\/$/, "") &&
    state.model === options.model &&
    state.quality === options.quality
  );
}

function stopChild(child: ChildProcess): void {
  try {
    child.kill();
  } catch {
    // Already gone.
  }
}

export function currentService(): WardrobeService | null {
  const state = runtimeGlobal.__breadboardWardrobeService;
  if (!state) return null;
  return { baseUrl: state.baseUrl, root: state.root, startedAt: state.startedAt };
}

export function stopService(): void {
  const state = runtimeGlobal.__breadboardWardrobeService;
  if (!state) return;
  stopChild(state.child);
  runtimeGlobal.__breadboardWardrobeService = null;
}

export interface StartOptions {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  upstreamUrl: string;
  /** The model id the clone should name on both its calls. */
  model: string;
  /** Image quality the clone asks the provider for. */
  quality: string;
}

async function waitForReady(baseUrl: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The Wardrobe server exited before it was ready. ${log().slice(-400)}`.trim(),
      );
    }
    try {
      await config(baseUrl);
      return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error("The Wardrobe server did not become ready in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

async function start(options: StartOptions): Promise<WardrobeService> {
  if (!resolveWardrobeRoot()) {
    throw new Error("The Wardrobe clone is missing. Clone tandpfun/wardrobe next to the dashboard.");
  }
  const root = wardrobeRuntimeRoot();
  const entry = viteEntry();
  if (!entry) {
    throw new Error("Wardrobe is not installed yet. Open its settings and install it once.");
  }

  const bridge = await ensureImagesBridge(options.upstreamUrl);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [entry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The clone reaches its model layer through the bridge, never directly:
        // ChatMock has no Images API, and this key is worthless anywhere else.
        OPENAI_API_KEY: bridge.apiKey,
        OPENAI_API_BASE_URL: bridge.baseUrl,
        OPENAI_VISION_MODEL: options.model,
        OPENAI_IMAGE_MODEL: options.model,
        OPENAI_IMAGE_QUALITY: options.quality,
        WARDROBE_MODEL_REFERENCE: modelReferencePath() ?? "data/model-reference.png",
        WARDROBE_DATA_DIR: wardrobeDataDir(),
        NODE_ENV: "development",
        NO_COLOR: "1",
        BROWSER: "none",
      },
    },
  );

  let log = "";
  const collect = (chunk: string) => {
    log = `${log}${chunk}`.slice(-4_000);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("exit", () => {
    if (runtimeGlobal.__breadboardWardrobeService?.child === child) {
      runtimeGlobal.__breadboardWardrobeService = null;
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl, child, () => log);
    const state: ServiceState = {
      baseUrl,
      root,
      startedAt: Date.now(),
      child,
      upstreamUrl: options.upstreamUrl.replace(/\/$/, ""),
      model: options.model,
      quality: options.quality,
    };
    runtimeGlobal.__breadboardWardrobeService = state;
    return currentService() as WardrobeService;
  } catch (error) {
    stopChild(child);
    throw error;
  }
}

/**
 * The running server, started if there is none and restarted when the model
 * layer it booted against has moved. The clone reads its settings once, at
 * config time, so a changed model or quality is a restart rather than a flag.
 */
export function ensureService(options: StartOptions): Promise<WardrobeService> {
  const existing = runtimeGlobal.__breadboardWardrobeService;
  if (existing && sameShape(existing, options)) {
    const service = currentService();
    if (service) return Promise.resolve(service);
  }
  if (runtimeGlobal.__breadboardWardrobeStarting) {
    return runtimeGlobal.__breadboardWardrobeStarting;
  }
  if (existing) stopService();
  const request = start(options).finally(() => {
    runtimeGlobal.__breadboardWardrobeStarting = null;
  });
  runtimeGlobal.__breadboardWardrobeStarting = request;
  return request;
}
