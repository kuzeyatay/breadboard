import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const ALLOWED_TOOLS = new Set([
  "create_part",
  "create_sketch",
  "add_line",
  "add_rectangle",
  "add_circle",
  "add_arc",
  "add_polygon",
  "add_sketch_dimension",
  "add_sketch_constraint",
  "exit_sketch",
  "create_extrusion",
  "create_cut_extrude",
  "add_fillet",
  "save_as",
  "export_step",
  "get_mass_properties",
]);
const MAX_JSON_NODES = 4096;
const MAX_STRING_BYTES = 16 * 1024;

function fail(message, status = 500, code = "solidworks_bridge_failed") {
  throw Object.assign(new Error(message), { status, code });
}

function exactRecord(value, keys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sourceLayout() {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(dashboardRoot);
  const development = fs.existsSync(
    path.join(dashboardRoot, "src", "lib", "cad", "solidworks", "bridge.ts"),
  );
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const sourceRoot = development
    ? path.join(dashboardRoot, "src")
    : path.join(packagedDashboardRoot, "worker-src");
  for (const relative of [
    "lib/cad/solidworks/bridge.ts",
    "lib/cad/solidworks/availability.ts",
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, ...relative.split("/")))) {
      fail("The staged SolidWorks bridge source closure is unavailable.");
    }
  }
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = development
    ? dashboardRoot
    : packagedDashboardRoot;
  return { dashboardRoot, sourceRoot };
}

function moduleUrl(sourceRoot, relative) {
  return pathToFileURL(path.join(sourceRoot, ...relative.split("/"))).href;
}

function validateJson(value) {
  const stack = [value];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("The SolidWorks tool arguments are too complex.", 400, "invalid_solidworks_request");
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail("The SolidWorks tool arguments are invalid.", 400, "invalid_solidworks_request");
      continue;
    }
    if (typeof current === "string") {
      if (Buffer.byteLength(current, "utf8") > MAX_STRING_BYTES) {
        fail("A SolidWorks tool argument is too large.", 400, "invalid_solidworks_request");
      }
      continue;
    }
    if (Array.isArray(current)) {
      if (current.length > 1024) fail("The SolidWorks tool arguments are too large.", 400, "invalid_solidworks_request");
      stack.push(...current);
      continue;
    }
    if (current && typeof current === "object") {
      const entries = Object.entries(current);
      if (entries.length > 256) fail("The SolidWorks tool arguments are too large.", 400, "invalid_solidworks_request");
      for (const [key, item] of entries) {
        if (!key || Buffer.byteLength(key, "utf8") > 256 || /\p{Cc}/u.test(key)) {
          fail("A SolidWorks tool argument name is invalid.", 400, "invalid_solidworks_request");
        }
        stack.push(item);
      }
      continue;
    }
    fail("The SolidWorks tool arguments are invalid.", 400, "invalid_solidworks_request");
  }
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validateOutputPath(tool, args) {
  if (tool !== "save_as" && tool !== "export_step") return;
  const candidate = args.file_path;
  const configuredRoot = process.env.BREADBOARD_SOLIDWORKS_WORKSPACE?.trim();
  if (typeof candidate !== "string" || !path.isAbsolute(candidate) || !configuredRoot) {
    fail("The SolidWorks output path is invalid.", 400, "solidworks_export_escaped_workspace");
  }
  const root = path.resolve(configuredRoot);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("The SolidWorks output path escaped its workspace.", 400, "solidworks_export_escaped_workspace");
  }
  const parent = path.dirname(target);
  let canonicalRoot;
  let canonicalParent;
  try {
    canonicalRoot = fs.realpathSync.native(root);
    canonicalParent = fs.realpathSync.native(parent);
  } catch {
    fail("The SolidWorks output workspace is unavailable.", 400, "solidworks_export_escaped_workspace");
  }
  if (!samePath(canonicalRoot, root)) {
    fail("The SolidWorks workspace is indirect.", 400, "solidworks_export_escaped_workspace");
  }
  const canonicalRelative = path.relative(canonicalRoot, canonicalParent);
  if (
    canonicalRelative === ".." ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalRelative)
  ) {
    fail("The SolidWorks output path escaped its workspace.", 400, "solidworks_export_escaped_workspace");
  }
}

async function main() {
  if (
    process.env.BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED !== "1" ||
    process.env.BREADBOARD_SOLIDWORKS_BRIDGE_OWNER !== "runtime-v2-service"
  ) {
    fail("The SolidWorks bridge must be launched by Runtime V2.");
  }
  const { dashboardRoot, sourceRoot } = sourceLayout();
  await import(
    pathToFileURL(path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs")).href
  );
  const [{ solidworksBridge }, { solidworksAvailability }] = await Promise.all([
    import(moduleUrl(sourceRoot, "lib/cad/solidworks/bridge.ts")),
    import(moduleUrl(sourceRoot, "lib/cad/solidworks/availability.ts")),
  ]);
  const bridge = solidworksBridge();

  const route = async ({ method, path: routePath, body, signal }) => {
    if (method !== "POST") fail("Unsupported SolidWorks service method.", 405, "method_not_allowed");
    if (routePath === "/v1/status") {
      if (!exactRecord(body, [])) fail("The SolidWorks status request is invalid.", 400, "invalid_solidworks_request");
      return {
        availability: await solidworksAvailability(),
        bridge: bridge.status(),
      };
    }
    if (routePath === "/v1/ensure") {
      if (!exactRecord(body, [])) fail("The SolidWorks startup request is invalid.", 400, "invalid_solidworks_request");
      await bridge.ensureStarted();
      return { attachedToExistingSession: bridge.attachedToExistingSession() };
    }
    if (routePath === "/v1/list-tools") {
      if (!exactRecord(body, [])) fail("The SolidWorks tool-list request is invalid.", 400, "invalid_solidworks_request");
      return { count: await bridge.listTools() };
    }
    if (routePath === "/v1/call") {
      if (!exactRecord(body, ["name", "arguments", "timeoutMs"])) {
        fail("The SolidWorks tool request is invalid.", 400, "invalid_solidworks_request");
      }
      if (typeof body.name !== "string" || !ALLOWED_TOOLS.has(body.name)) {
        fail("The SolidWorks tool is not allowed.", 400, "solidworks_tool_failed");
      }
      if (!exactRecord(body.arguments, Object.keys(body.arguments ?? {}))) {
        fail("The SolidWorks tool arguments are invalid.", 400, "invalid_solidworks_request");
      }
      if (
        !Number.isSafeInteger(body.timeoutMs) ||
        body.timeoutMs < 1_000 ||
        body.timeoutMs > 300_000
      ) {
        fail("The SolidWorks tool timeout is invalid.", 400, "invalid_solidworks_request");
      }
      validateJson(body.arguments);
      validateOutputPath(body.name, body.arguments);
      return await bridge.callTool(body.name, body.arguments, {
        timeoutMs: body.timeoutMs,
        signal,
      });
    }
    fail("Unknown SolidWorks service request.", 404, "solidworks_route_not_found");
  };

  await startRuntimeV2GatewayHttpService({
    name: "solidworks-mcp",
    tokenEnvironmentName: "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN",
    route,
    onStop: async () => bridge.shutdown(),
    maximumRequestBytes: 512 * 1024,
    maximumResponseBytes: 512 * 1024,
  });
}

void main().catch((error) => {
  process.stderr.write(
    `[runtime-v2-solidworks-mcp-service] startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
