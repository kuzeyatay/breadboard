// Runtime discovery and readiness checks for the local ShapeR checkout.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export interface ShapeRRuntime {
  root: string;
  source: "configured" | "repository" | "cwd";
}

export interface ShapeRHealth {
  available: boolean;
  cloned: boolean;
  root: string | null;
  python: string | null;
  bridgeFound: boolean;
  dependenciesInstalled: boolean;
  cudaAvailable: boolean;
  missing: string[];
  reason: string | null;
}

const HEALTH_CACHE_MS = 30_000;
const PROBE_TIMEOUT_MS = 90_000;

type HealthCache = { at: number; health: ShapeRHealth };
const globals = globalThis as typeof globalThis & {
  __breadboardShapeRHealth?: HealthCache;
  __breadboardShapeRHealthInFlight?: Promise<ShapeRHealth>;
};

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function isShapeRClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "infer_shape.py")) &&
    fs.existsSync(path.join(candidate, "experimental", "workaround_dataproc.py")) &&
    fs.existsSync(path.join(candidate, "model", "flow_matching", "shaper_denoiser.py"))
  );
}

export function resolveShapeRRoot(env: NodeJS.ProcessEnv = process.env): ShapeRRuntime | null {
  const candidates: ShapeRRuntime[] = [];
  const explicit = configured(env.SHAPER_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isShapeRClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "ShapeR"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "ShapeR"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "ShapeR"), source: "cwd" });
  return candidates.find((candidate) => isShapeRClone(candidate.root)) ?? null;
}

export function shapeRPython(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.SHAPER_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidate =
    process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

export function shapeRBridgePath(): string | null {
  const candidates = [
    path.join(repositoryRoot(), "scripts", "shaper-bridge.py"),
    path.resolve(process.cwd(), "scripts", "shaper-bridge.py"),
    path.resolve(process.cwd(), "..", "scripts", "shaper-bridge.py"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function shapeRWorkspaceRoot(): string {
  const root = path.join(dashboardDataDir(), "formsmith-work");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function shapeREnv(
  root: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...extra,
  };
}

function runProbe(python: string, root: string): Promise<{ code: number | null; output: string }> {
  const script = [
    "import importlib.util, json, torch",
    "mods=['omegaconf','trimesh','cv2','PIL','numpy','depth_anything_3','fpsample','torchsparse','transformers','diffusers']",
    "missing=[m for m in mods if importlib.util.find_spec(m) is None]",
    "print(json.dumps({'missing':missing,'cuda':bool(torch.cuda.is_available())}))",
  ].join("\n");
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(python, ["-c", script], {
      cwd: root,
      windowsHide: true,
      env: shapeREnv(root),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: output.slice(-20_000) });
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output += chunk; });
    child.stderr?.on("data", (chunk: string) => { output += chunk; });
    child.on("error", () => finish(null));
    child.on("exit", finish);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish(null);
    }, PROBE_TIMEOUT_MS);
  });
}

async function probe(): Promise<ShapeRHealth> {
  const runtime = resolveShapeRRoot();
  const bridgeFound = Boolean(shapeRBridgePath());
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      python: null,
      bridgeFound,
      dependenciesInstalled: false,
      cudaAvailable: false,
      missing: [],
      reason: "The ShapeR checkout was not found next to Breadboard.",
    };
  }
  const python = shapeRPython(runtime.root);
  if (!python) {
    return {
      available: false,
      cloned: true,
      root: runtime.root,
      python: null,
      bridgeFound,
      dependenciesInstalled: false,
      cudaAvailable: false,
      missing: [],
      reason: "ShapeR is cloned, but its Python 3.10 environment has not been created. Follow ShapeR/INSTALL.md or set SHAPER_PYTHON.",
    };
  }
  if (!bridgeFound) {
    return {
      available: false,
      cloned: true,
      root: runtime.root,
      python,
      bridgeFound: false,
      dependenciesInstalled: false,
      cudaAvailable: false,
      missing: [],
      reason: "Breadboard's ShapeR bridge is missing.",
    };
  }
  const result = await runProbe(python, runtime.root);
  let report: { missing?: unknown; cuda?: unknown } | null = null;
  try {
    const line = result.output.trim().split(/\r?\n/).at(-1) ?? "";
    report = JSON.parse(line) as { missing?: unknown; cuda?: unknown };
  } catch {
    report = null;
  }
  const missing = Array.isArray(report?.missing)
    ? report.missing.filter((item): item is string => typeof item === "string")
    : ["ShapeR environment probe"];
  const cudaAvailable = report?.cuda === true;
  const dependenciesInstalled = result.code === 0 && missing.length === 0;
  const available = dependenciesInstalled && cudaAvailable;
  return {
    available,
    cloned: true,
    root: runtime.root,
    python,
    bridgeFound: true,
    dependenciesInstalled,
    cudaAvailable,
    missing,
    reason: !dependenciesInstalled
      ? `The ShapeR environment is missing ${missing.join(", ")}. Follow ShapeR/INSTALL.md.`
      : !cudaAvailable
        ? "ShapeR requires a CUDA GPU, but CUDA is not available in its Python environment."
        : null,
  };
}

export async function shapeRHealth(options: { force?: boolean } = {}): Promise<ShapeRHealth> {
  const cached = globals.__breadboardShapeRHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) return cached.health;
  if (globals.__breadboardShapeRHealthInFlight) return globals.__breadboardShapeRHealthInFlight;
  const request = probe()
    .then((health) => {
      globals.__breadboardShapeRHealth = { at: Date.now(), health };
      return health;
    })
    .finally(() => { globals.__breadboardShapeRHealthInFlight = undefined; });
  globals.__breadboardShapeRHealthInFlight = request;
  return request;
}
