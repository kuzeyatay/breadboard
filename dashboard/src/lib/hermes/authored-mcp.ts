import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { addLocalMcpBrokerConnection, callLocalMcpBrokerTool, disconnectLocalMcpBrokerConnection, LocalMcpBrokerError } from "../agent-runtime/local-mcp-broker.ts";
import { addProxyMcpConnection } from "../agent-runtime/mcp-proxy.ts";
import { ApiError } from "./route-core.ts";
import { discardLocalMcpProbe, isApprovedLocalMcpProfileReference, loadApprovedLocalMcpProfile, LocalMcpProfileError, prepareApprovedLocalMcpLaunch, sealApprovedLocalMcpProfile, type LegacyApprovedLocalMcpDefinition } from "./local-mcp-approved-profile.ts";
import { createVerifiedMcpConnection, mcpSlug, runtimeMcpConfig, type McpConnectionRecord } from "./mcp-connections.ts";
import { MCP_AUTHOR_EXAMPLE } from "./mcp-installer-context.ts";
import { runtimeProcessPath } from "../../../scripts/runtime-v2-paths.mjs";

const STRING = { type: "string" };
const FIELD_TYPES = ["string", "number", "integer", "boolean", "array", "object"];
export const AUTHOR_MCP_TOOL = {
  name: "author",
  description: "Code and register a persistent local MCP server. Each tool is a synchronous JavaScript function body with args and private JSON state. Return a JSON value. Submit one real example and its expected result. The example runs with disposable state before publication.",
  inputSchema: { type: "object", required: ["name", "tools", "test"], properties: {
    name: STRING, tools: { type: "array", items: { type: "object", required: ["name", "description", "parameters", "readOnly", "code"], properties: {
      name: STRING, description: STRING, readOnly: { type: "boolean" },
      parameters: { type: "array", items: { type: "object", required: ["name", "type"], properties: {
        name: STRING, type: { type: "string", enum: FIELD_TYPES }, required: { type: "boolean" }, description: STRING,
      } } },
      code: { type: "string", description: "JavaScript body, e.g. return args.values.reduce((a,b) => a+b, 0). Mutate state only in writable tools. No host imports, filesystem or network." },
    } } },
    test: { type: "object", required: ["tool", "args", "expected"], properties: { tool: STRING, args: { type: "object" }, expected: {} } },
  } },
};

function invalid(message: string): never {
  throw new ApiError(400, "invalid_authored_mcp", message + " Author arguments example: " + JSON.stringify(MCP_AUTHOR_EXAMPLE));
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function field(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) invalid(`Provide ${label} (1–${limit} characters).`);
  return value.trim();
}
function identifier(value: unknown, used: Set<string>): string {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value) ||
    used.has(value) || Object.hasOwn(Object.prototype, value)) invalid("Use distinct, plain tool and parameter names.");
  used.add(value);
  return value;
}

function definition(args: Record<string, unknown>) {
  const name = field(args.name, 80, "a server name");
  if (!Array.isArray(args.tools) || !args.tools.length || args.tools.length > 16) invalid("Provide 1–16 tools.");
  const names = new Set<string>();
  const tools = args.tools.map(raw => {
    if (!record(raw) || typeof raw.readOnly !== "boolean" || !Array.isArray(raw.parameters) || raw.parameters.length > 32) invalid("Each tool needs parameters and a readOnly flag.");
    const toolName = identifier(raw.name, names);
    const properties: Record<string, { type: string; description?: string }> = Object.create(null);
    const required: string[] = [];
    const fields = new Set<string>();
    for (const param of raw.parameters) {
      if (!record(param) || !FIELD_TYPES.includes(String(param.type))) invalid("Choose a supported parameter type.");
      const key = identifier(param.name, fields);
      properties[key] = { type: String(param.type), ...(param.description ? { description: field(param.description, 500, "a parameter description") } : {}) };
      if (param.required === true) required.push(key);
    }
    return { name: toolName, description: field(raw.description, 1000, "a tool description"), readOnly: raw.readOnly,
      inputSchema: { type: "object", properties, required, additionalProperties: false }, code: field(raw.code, 24_000, "JavaScript code") };
  });
  if (!record(args.test) || !names.has(String(args.test.tool)) || !record(args.test.args) || !Object.hasOwn(args.test, "expected")) invalid("Provide a test with a declared tool, args and expected JSON result.");
  return { name, tools, test: { tool: String(args.test.tool), args: args.test.args, expected: args.test.expected } };
}

function serverDirectory(userId: number, slug: string, digest: string) {
  return path.join(dashboardDataDir(), "authored-mcp", String(userId), slug, digest);
}

function serverLaunch(directory: string, digest: string): LegacyApprovedLocalMcpDefinition {
  // The Windows supervisor uses extended-length paths. Node's module loader
  // needs the ordinary spelling when the entry point is a CommonJS script.
  const cwd = runtimeProcessPath(directory);
  const script = runtimeProcessPath(path.join(repositoryRoot(), "dashboard", "scripts", "authored-mcp-server.cjs"));
  return { transport: "local", executable: runtimeProcessPath(process.execPath),
    args: [script, path.join(cwd, "server.json"), digest],
    cwd, environmentNames: [], timeout: 15_000 };
}

// Only this host confines writes to private JSON state. A user-configured
// connection may have the same prefix or tool annotations and run other code.
export function usesAuthoredMcpHost(connection: McpConnectionRecord): boolean {
  if (!connection.slug.startsWith("custom-") || !isApprovedLocalMcpProfileReference(connection.config)) return false;
  const profile = loadApprovedLocalMcpProfile(connection.userId, connection.slug, connection.config);
  const digest = profile.arguments[2];
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return false;
  const launch = serverLaunch(serverDirectory(connection.userId, connection.slug, digest), digest);
  return isDeepStrictEqual(profile.arguments, launch.args) && profile.executable.path === fs.realpathSync.native(process.execPath) &&
    profile.environmentNames.length === 0 && profile.cwd === fs.realpathSync.native(launch.cwd!);
}

export async function authorMcpServer(userId: number, args: Record<string, unknown>, approved: boolean, signal?: AbortSignal) {
  const { name, tools, test } = definition(args);
  const slug = mcpSlug("custom-" + name);
  if (!slug.startsWith("custom-") || !/[a-z0-9]/.test(slug.slice(7))) invalid("Include a letter or digit in the server name.");
  const bytes = JSON.stringify({ name, tools });
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!approved) throw new ApiError(428, "connected_app_permission_required",
    `Add “${name}” to your MCP connections? Tools: ${tools.map(t => t.name).join(", ")}. The JavaScript runs locally with private server storage. Revision ${digest.slice(0, 12)}.`);
  const parent = path.join(dashboardDataDir(), "authored-mcp", String(userId));
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(parent, "pending-"));
  const pending = path.join(staging, "server.json");
  // Test through the real broker. A temporary connection never replaces a
  // working server and cannot be discovered through another chat's registry.
  const probe = "probe-" + randomUUID();
  const directory = serverDirectory(userId, slug, digest);
  const launch = serverLaunch(directory, digest);
  let stage = "write the server definition";
  try {
    fs.writeFileSync(pending, bytes, { flag: "wx", mode: 0o600 });
    const probeLaunch = serverLaunch(staging, digest);
    stage = "seal the test launch profile";
    const { reference } = sealApprovedLocalMcpProfile(userId, probe, { ...probeLaunch, args: [...probeLaunch.args, "--probe"] });
    const config = { type: "local" as const, profileRevision: reference.profileRevision, profileDigest: reference.profileDigest, enabled: true, timeout: launch.timeout };
    try {
      stage = "authorize the test launch";
      prepareApprovedLocalMcpLaunch(userId, probe, reference);
      stage = "start the test server";
      const connected = await addLocalMcpBrokerConnection({ userId, slug: probe, config });
      if (connected.status.status !== "connected" || !tools.every(t => connected.tools.some(found => found.name === t.name))) {
        invalid("The test server could not start or list all declared tools. Check each JavaScript body.");
      }
      stage = "run the example";
      prepareApprovedLocalMcpLaunch(userId, probe, reference);
      const result = await callLocalMcpBrokerTool({ userId, slug: probe, config, tool: test.tool, args: test.args, signal });
      const part = record(result) && Array.isArray(result.content) ? result.content[0] : undefined;
      if (!record(result) || result.isError || typeof part?.text !== "string") invalid(`The example failed: ${String(part?.text ?? "no result").slice(0, 400)}`);
      if (!isDeepStrictEqual(JSON.parse(part.text), test.expected)) invalid(`The example returned ${part.text.slice(0, 400)}. Check the implementation and expected result.`);
    } finally {
      await disconnectLocalMcpBrokerConnection({ userId, slug: probe }).catch(() => {});
      discardLocalMcpProbe(userId, probe);
    }
    stage = "publish the tested definition";
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.linkSync(pending, path.join(directory, "server.json")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } catch (error) {
    if (error instanceof LocalMcpBrokerError) {
      throw new ApiError(503, "local_mcp_probe_failed", `Could not ${stage}. Local MCP broker: ${error.code}.`);
    }
    if (error instanceof ApiError) throw error;
    if (error instanceof LocalMcpProfileError) throw new ApiError(503, "local_mcp_profile_unavailable", `Could not ${stage}. ${error.message}`);
    const code = (error as NodeJS.ErrnoException)?.code ?? "";
    throw new ApiError(500, "authored_mcp_storage_failed", `Could not ${stage}${/^[A-Z_]{2,32}$/.test(code) ? " (" + code + ")" : ""}.`);
  } finally {
    fs.rmSync(pending, { force: true });
    fs.rmdirSync(staging);
  }
  const saved = createVerifiedMcpConnection(userId, slug, name, launch);
  const status = await addProxyMcpConnection(userId, slug, runtimeMcpConfig(saved));
  if (status[slug]?.status !== "connected") throw new ApiError(503, "mcp_not_connected", "The verified server was saved, but could not reconnect. Check its connection in Settings.");
  return { installed: true, connection: slug, tools: tools.map(t => t.name), verified: test,
    usage: `Use mcp_call with connection=${slug} to do the user's actual task now. Later chats discover this saved connection.` };
}
