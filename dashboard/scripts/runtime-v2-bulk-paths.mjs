import path from "node:path";
import { randomUUID } from "node:crypto";
import { sameRuntimePath, runtimePathWithin, runtimeProcessPath } from "./runtime-v2-paths.mjs";

// Opaque runtime filesystem access prevents Next from tracing mutable installs
// into the standalone application. Neither a request nor a manifest supplies a
// module name or a storage root here; bulk authority comes from the native host.
const fs = Reflect.apply(Reflect.get(process, "getBuiltinModule"), process, ["node:fs"]);
export const BULK_READY_MARKER = ".breadboard-bulk-ready.json";
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VENV_SERVICES = new Set([
  "deep-tutor", "deer-flow", "legal", "money-printer", "openexecutive", "shorts", "stock-analyst", "tradingagents", "vibe-trading",
  "acestep", "comfyui", "resource2skill", "formsmith", "solidworks-mcp", "agent-reach", "matraix", "openmontage", "subsai",
  "colpali", "humanizer", "cad",
]);
const TOP_LEVEL = new Set(["hyperframes-cli", "hyperframes-browser", "openscience-cli", "openwork-runtime"]);
const TOOLCHAINS = new Set(["bolt-slides", "wardrobe", "openmontage", "comfyui", "google-images", "audio-analyzer", "career-ops-browsers", "openmaic", "openmaic-tools", "cache",
  "vlm-ocr-models", "voicebox"]);
const STATEFUL_TOOLCHAINS = new Set(["career-ops", "money-printer"]);
const CACHE_PAYLOADS = new Set([
  "runtime-v2/toolchains/cache", "runtime-v2/services/acestep/uv-cache", "runtime-v2/services/acestep/cache",
]);
const PAYLOAD_FILES = {
  "runtime-v2/toolchains/bolt-slides": ["node_modules/vite/bin/vite.js"],
  "runtime-v2/toolchains/wardrobe": ["node_modules/vite/bin/vite.js"],
  "runtime-v2/toolchains/openmontage": ["AGENT_GUIDE.md", "tools/tool_registry.py"],
  "runtime-v2/toolchains/google-images": ["src/index.js"],
  "runtime-v2/toolchains/vlm-ocr-models": ["HunyuanOCR-Q8_0.gguf", "mmproj-HunyuanOCR-Q8_0.gguf"],
  "runtime-v2/toolchains/voicebox": ["voicebox-server.exe"],
  "runtime-v2/toolchains/comfyui": ["main.py"],
  "runtime-v2/toolchains/openmaic": [".next/BUILD_ID", "packages/@openmaic/generation/dist/index.js", "public/vendor/maic-importer/index.js"],
  "hyperframes-cli": ["node_modules/hyperframes/bin/hyperframes.mjs"],
  "openscience-cli": ["node_modules/@synsci/openscience/bin/openscience"],
  "openwork-runtime": ["apps/server/src/cli.ts", "apps/server/node_modules/@opencode-ai/sdk/package.json"],
  "runtime-v2/services/acestep/source": ["acestep/api_server.py"],
};

function indirect(message) {
  const error = new Error(message);
  error.code = "setup_path_indirect";
  throw error;
}

function directAncestors(root, candidate) {
  if (!runtimePathWithin(root, candidate)) indirect("The managed dependency path escaped its storage root.");
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) break;
    if (metadata.isSymbolicLink() || !sameRuntimePath(fs.realpathSync.native(current), current)) {
      indirect("The managed dependency path is redirected.");
    }
    if (!sameRuntimePath(current, candidate) && !metadata.isDirectory()) indirect("The managed dependency ancestor is not a directory.");
  }
  return candidate;
}

export function runtimeBulkDataRoot(dataRoot, environment = process.env) {
  const configured = environment.BREADBOARD_BULK_DATA_DIR?.trim();
  if (!configured) return path.resolve(dataRoot);
  if (!path.isAbsolute(configured)) indirect("The sealed bulk storage root must be absolute.");
  const root = path.resolve(configured);
  const metadata = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink() || !sameRuntimePath(fs.realpathSync.native(root), root)) {
    indirect("The sealed bulk storage root is unavailable or redirected.");
  }
  return root;
}

function payloadParts(relative) {
  const parts = relative.split("/");
  const servicePayload = parts.length === 4 && parts[0] === "runtime-v2" && parts[1] === "services"
    && IDENTIFIER.test(parts[2]) && ((parts[3] === ".venv" && VENV_SERVICES.has(parts[2]))
      || (parts[2] === "resource2skill" && parts[3] === "browsers")
      || (parts[2] === "acestep" && ["source", "uv-cache", "cache"].includes(parts[3])));
  const toolchain = parts.length === 3 && parts[0] === "runtime-v2" && parts[1] === "toolchains"
    && (TOOLCHAINS.has(parts[2]) || STATEFUL_TOOLCHAINS.has(parts[2]));
  if (!(servicePayload || toolchain || (parts.length === 1 && TOP_LEVEL.has(parts[0])))) {
    throw new Error("The managed dependency namespace is invalid.");
  }
  return parts;
}

/** Installer target only. Never falls back to a legacy installation. */
export function managedPayloadTarget(dataRoot, relative, environment = process.env) {
  const parts = payloadParts(relative);
  const root = parts[1] === "toolchains" && STATEFUL_TOOLCHAINS.has(parts[2])
    ? path.resolve(dataRoot) : runtimeBulkDataRoot(dataRoot, environment);
  return directAncestors(root, path.join(root, ...parts));
}

export function managedPayloadReady(root, relative) {
  const filename = directAncestors(root, path.join(root, BULK_READY_MARKER));
  const metadata = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.size < 2 || metadata.size > 4096) return false;
  let value;
  try { value = JSON.parse(fs.readFileSync(filename, "utf8")); } catch { return false; }
  if (!value || Object.keys(value).sort().join(",") !== "relative,verifiedAt,version"
      || value.version !== 1 || value.relative !== relative
      || typeof value.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.verifiedAt)
      || !Number.isFinite(Date.parse(value.verifiedAt)) || new Date(value.verifiedAt).toISOString() !== value.verifiedAt) return false;
  const files = relative.endsWith("/.venv")
    ? [process.platform === "win32" ? "Scripts/python.exe" : "bin/python"]
    : PAYLOAD_FILES[relative] ?? [];
  return files.every((entry) => {
    const filename = directAncestors(root, path.join(root, ...entry.split("/")));
    return fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() === true;
  });
}

/** Only verified payloads supersede a legacy install. Caches carry no code
 * authority and can use the bulk destination immediately. Actual health still
 * probes packages/services; a marker never manufactures a Ready result. */
export function managedPayloadRoot(dataRoot, relative, environment = process.env) {
  const target = managedPayloadTarget(dataRoot, relative, environment);
  const legacy = path.join(path.resolve(dataRoot), ...payloadParts(relative));
  if (sameRuntimePath(target, legacy) || CACHE_PAYLOADS.has(relative)) return target;
  if (managedPayloadReady(target, relative)) return target;
  directAncestors(path.resolve(dataRoot), legacy);
  return legacy;
}

export function managedVenvRoot(dataRoot, serviceId, environment = process.env) {
  if (!IDENTIFIER.test(serviceId)) throw new Error("Invalid Runtime V2 service identifier.");
  return managedPayloadRoot(dataRoot, `runtime-v2/services/${serviceId}/.venv`, environment);
}

/** New model downloads follow the sealed bulk preference. This only returns
 * fixed cache paths; it never moves existing models or changes user state. */
export function managedModelCacheEnvironment(dataRoot, environment = process.env) {
  if (!environment.BREADBOARD_BULK_DATA_DIR?.trim()) return {};
  const cache = managedPayloadTarget(dataRoot, "runtime-v2/toolchains/cache", environment);
  const huggingface = directAncestors(cache, path.join(cache, "huggingface"));
  const hub = directAncestors(cache, path.join(huggingface, "hub"));
  const torch = directAncestors(cache, path.join(cache, "torch"));
  // Native authority uses extended Windows paths, but CTranslate2 cannot open
  // model.bin through that spelling. Normalize only after containment and
  // redirection checks; all consumers still use the same verified D: cache.
  return Object.fromEntries(Object.entries({
    HF_HOME: huggingface, HF_HUB_CACHE: hub, HUGGINGFACE_HUB_CACHE: hub, TORCH_HOME: torch,
  }).map(([key, value]) => [key, runtimeProcessPath(value)]));
}

/** A native environment records the selected path at process startup. For our
 * own fixed C/D namespaces, reselect after each verified setup instead of
 * allowing that older environment string to mask the current marker. Explicit
 * standalone paths outside these namespaces retain their existing meaning. */
export function configuredManagedPayloadRoot(dataRoot, relative, configured, environment = process.env) {
  const parts = payloadParts(relative);
  const explicit = typeof configured === "string" && configured.trim() ? path.resolve(configured.trim()) : null;
  if (explicit) {
    const legacy = path.join(path.resolve(dataRoot), ...parts);
    const bulk = environment.BREADBOARD_BULK_DATA_DIR?.trim();
    const bulkTarget = bulk && path.isAbsolute(bulk) ? path.join(path.resolve(bulk), ...parts) : null;
    if (!sameRuntimePath(explicit, legacy) && !(bulkTarget && sameRuntimePath(explicit, bulkTarget))) return explicit;
  }
  return managedPayloadRoot(dataRoot, relative, environment);
}

export function clearManagedPayloadReady(dataRoot, relative, environment = process.env) {
  const target = managedPayloadTarget(dataRoot, relative, environment);
  const marker = directAncestors(target, path.join(target, BULK_READY_MARKER));
  if (fs.lstatSync(marker, { throwIfNoEntry: false })) fs.unlinkSync(marker);
  return target;
}

export function markManagedPayloadReady(dataRoot, relative, environment = process.env) {
  const target = managedPayloadTarget(dataRoot, relative, environment);
  const metadata = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!metadata?.isDirectory()) return;
  const marker = directAncestors(target, path.join(target, BULK_READY_MARKER));
  const temporary = path.join(target, `${BULK_READY_MARKER}.${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({version: 1, relative, verifiedAt: new Date().toISOString()}), {flag: "wx", mode: 0o600});
  try { fs.renameSync(temporary, marker); } finally { fs.rmSync(temporary, {force: true}); }
}
