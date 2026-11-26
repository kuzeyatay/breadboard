import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { addLocalMcpBrokerConnection, callLocalMcpBrokerTool, disconnectLocalMcpBrokerConnection, LocalMcpBrokerError } from "../agent-runtime/local-mcp-broker.ts";
import { addProxyMcpConnection } from "../agent-runtime/mcp-proxy.ts";
import { ApiError } from "./route-core.ts";
import { discardLocalMcpProbe, isApprovedLocalMcpProfileReference, loadApprovedLocalMcpProfile, LocalMcpProfileError, prepareApprovedLocalMcpLaunch, sealApprovedLocalMcpProfile, type LegacyApprovedLocalMcpDefinition } from "./local-mcp-approved-profile.ts";
import { createVerifiedMcpConnection, getMcpConnectionBySlug, mcpSlug, runtimeMcpConfig, type McpConnectionRecord } from "./mcp-connections.ts";
import { MCP_AUTHOR_EXAMPLE } from "./mcp-installer-context.ts";
import { runtimeProcessPath } from "../../../scripts/runtime-v2-paths.mjs";

const STRING = { type: "string" };
const FIELD_TYPES = ["string", "number", "integer", "boolean", "array", "object"];
const exampleSchema = { type: "object", required: ["tool", "args", "expected"], properties: { tool: STRING, args: { type: "object" }, expected: {} } };
export const AUTHOR_MCP_TOOL = {
  name: "author",
  description: "Code or update a persistent local MCP server. Provide a test and ordered follow-up checks covering every tool. Checks share disposable state and use example HTTP responses. Call the installed server for live API results.",
  inputSchema: { type: "object", required: ["name", "tools", "test"], properties: {
    name: STRING, updateFrom: {type:"string", description:"Revision returned by read_authored when updating an existing server."},
    tools: { type: "array", items: { type: "object", required: ["name", "description", "parameters", "readOnly", "code"], properties: {
      name: STRING, description: STRING, readOnly: { type: "boolean" },
      parameters: { type: "array", items: { type: "object", required: ["name", "type"], properties: {
        name: STRING, type: { type: "string", enum: FIELD_TYPES }, required: { type: "boolean" }, description: STRING,
      } } },
      http: { type:"object", required:["url","example"], description:"Call a public HTTPS JSON endpoint. A path segment can be a declared argument such as /items/{id}. query lists argument names to send as query parameters. body names a JSON argument. example supplies a sample API response during installation.", properties:{
        url:STRING, method:{enum:["GET","POST","PUT","PATCH","DELETE"]}, query:{type:"array",items:STRING}, body:STRING, example:{} } },
      code: { type: "string", description: "JavaScript body with args, state and response (parsed JSON from the declared HTTP API). Mutate state only in writable tools." },
    } } },
    test: exampleSchema, then: {type:"array",items:exampleSchema, description:"Ordered follow-up checks sharing the disposable test state. Verify reads after writes."},
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

function httpRequest(value: unknown, fields: Set<string>, readOnly: boolean) {
  if (!record(value) || !Object.hasOwn(value, "example")) invalid("Supply an HTTP endpoint and an example JSON response.");
  const url = typeof value.url === "string" && URL.canParse(value.url) ? new URL(value.url) : null;
  if (!url || url.protocol !== "https:" || url.username || url.password || url.hash || url.href.length > 2048)
    invalid("Choose a fixed public HTTPS endpoint without embedded credentials or a fragment.");
  if (/[{}]/.test(url.hostname)) invalid("Use a fixed API hostname.");
  for (const segment of url.pathname.split("/")) {
    if (!/%7b|%7d/i.test(segment)) continue;
    const parameter = /^%7B([a-zA-Z][a-zA-Z0-9_]*)%7D$/i.exec(segment)?.[1];
    if (!parameter || !fields.has(parameter)) invalid("Use a declared argument for each complete {parameter} path segment.");
  }
  const method = value.method ?? "GET";
  if (typeof method !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) || (method !== "GET" && readOnly))
    invalid("Use a supported HTTP method and declare tools that write to an API writable.");
  const query = value.query ?? [];
  if (!Array.isArray(query) || query.some(key => typeof key !== "string" || !fields.has(key))) invalid("Choose declared tool arguments for the query parameters.");
  const body = value.body;
  if (body !== undefined && (method === "GET" || typeof body !== "string" || !fields.has(body))) invalid("A JSON request body must name a declared argument on a write method.");
  return { url: url.href, method, query, ...(body === undefined ? {} : { body }), example: value.example };
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
    const http = raw.http === undefined ? undefined : httpRequest(raw.http, fields, raw.readOnly);
    return { name: toolName, description: field(raw.description, 1000, "a tool description"), readOnly: raw.readOnly, ...(http ? { http } : {}),
      inputSchema: { type: "object", properties, required, additionalProperties: false }, code: field(raw.code, 24_000, "JavaScript code") };
  });
  const following = args.then ?? [];
  if (!Array.isArray(following) || following.length > 31) invalid("Provide at most 31 follow-up checks.");
  const tests = [args.test, ...following].map(check => {
    if (!record(check) || !names.has(String(check.tool)) || !record(check.args) || !Object.hasOwn(check, "expected")) invalid("Provide a test with a declared tool, args and expected JSON result.");
    return {tool:String(check.tool), args:check.args, expected:check.expected};
  });
  const missing = tools.filter(tool => !tests.some(test => test.tool === tool.name)).map(tool=>tool.name);
  if (missing.length) invalid("Add a check in then for each untested tool: " + missing.join(", "));
  return {name,tools,tests};
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

// Only this host enforces authored tools' state and declared HTTP contracts.
// Other connections can use the same prefix or supply similar annotations.
export function usesAuthoredMcpHost(connection: McpConnectionRecord): boolean {
  if (!connection.slug.startsWith("custom-") || !isApprovedLocalMcpProfileReference(connection.config)) return false;
  const profile = loadApprovedLocalMcpProfile(connection.userId, connection.slug, connection.config);
  const digest = profile.arguments[2];
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return false;
  const launch = serverLaunch(serverDirectory(connection.userId, connection.slug, digest), digest);
  return isDeepStrictEqual(profile.arguments, launch.args) && profile.executable.path === fs.realpathSync.native(process.execPath) &&
    profile.environmentNames.length === 0 && profile.cwd === fs.realpathSync.native(launch.cwd!);
}

export function readAuthoredMcp(userId: number, slug: string, connection = getMcpConnectionBySlug(userId, slug)) {
  if (!connection?.enabled || !isApprovedLocalMcpProfileReference(connection.config) || !usesAuthoredMcpHost(connection))
    throw new ApiError(404, "authored_mcp_missing", "Choose an installed server authored by Bread.");
  const profile = loadApprovedLocalMcpProfile(userId, slug, connection.config);
  const revision = profile.arguments[2]!;
  const bytes = fs.readFileSync(path.join(serverDirectory(userId,slug,revision), "server.json"));
  if (createHash("sha256").update(bytes).digest("hex") !== revision) throw new ApiError(409,"mcp_definition_changed","The saved definition has changed on disk.");
  const stored = JSON.parse(bytes.toString("utf8")) as {name:string;tools:ReturnType<typeof definition>["tools"]};
  return {name:stored.name,revision,tools:stored.tools.map(({inputSchema,...tool})=>({...tool,
    parameters:Object.entries(inputSchema.properties).map(([name, field])=>({name,...field,required:inputSchema.required.includes(name)}))}))};
}

export async function authorMcpServer(userId: number, args: Record<string, unknown>, approved: boolean, signal?: AbortSignal) {
  const { name, tools, tests } = definition(args);
  const slug = mcpSlug("custom-" + name);
  if (!slug.startsWith("custom-") || !/[a-z0-9]/.test(slug.slice(7))) invalid("Include a letter or digit in the server name.");
  const bytes = JSON.stringify({ name, tools });
  const digest = createHash("sha256").update(bytes).digest("hex");
  let previousProfile: string | undefined;
  let previousRevision: string | undefined;
  const existing = getMcpConnectionBySlug(userId, slug);
  if (existing) {
    if (!existing.enabled || !usesAuthoredMcpHost(existing)) throw new ApiError(409, "mcp_name_in_use", "Another connection is using this name.");
    const current = readAuthoredMcp(userId, slug, existing);
    if (current.revision !== digest && current.revision !== args.updateFrom)
      throw new ApiError(409, "mcp_revision_changed", "Use read_authored and apply your edits to the current revision.");
    previousRevision = current.revision;
    if (isApprovedLocalMcpProfileReference(existing.config)) previousProfile = existing.config.profileDigest;
  } else if (args.updateFrom !== undefined) throw new ApiError(409, "mcp_revision_changed", "The server to update is no longer installed.");
  const endpoints = tools.flatMap(t => t.http ? [t.http.method + " " + t.http.url] : []);
  if (!approved) throw new ApiError(428, "connected_app_permission_required",
    `${previousProfile ? "Update" : "Install"} “${name}”? Tools: ${tools.map(t => t.name).join(", ")}. ${endpoints.length ? "API endpoints: " + endpoints.join(", ") + ". " : ""}Revision ${digest.slice(0, 12)}.`);
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
      for (const test of tests) {
        prepareApprovedLocalMcpLaunch(userId, probe, reference);
        const result = await callLocalMcpBrokerTool({ userId, slug: probe, config, tool: test.tool, args: test.args, signal });
        const part = record(result) && Array.isArray(result.content) ? result.content[0] : undefined;
        if (!record(result) || result.isError || typeof part?.text !== "string") invalid(`The example for ${test.tool} failed: ${String(part?.text ?? "no result").slice(0, 400)}`);
        if (!isDeepStrictEqual(JSON.parse(part.text), test.expected)) invalid(`The example for ${test.tool} returned ${part.text.slice(0, 400)}. Check the implementation and expected result.`);
      }
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
  signal?.throwIfAborted();
  // Point every revision at the original SQLite file, including a legacy
  // server that still has it open. Linking a complete immutable definition
  // avoids moving a live database or copying stale writes.
  const origin = path.join(directory, "..", "state-origin.json");
  if (!fs.existsSync(origin)) {
    let original = previousRevision ?? digest;
    if (!existing && !fs.existsSync(path.join(directory,"state.sqlite"))) {
      const old = fs.readdirSync(path.dirname(directory)).filter(item=>/^[0-9a-f]{64}$/.test(item) && fs.existsSync(path.join(directory,"..",item,"state.sqlite")));
      if (old.length > 1) throw new ApiError(409,"mcp_legacy_state_ambiguous","Reinstall the original revision to select its saved data.");
      original = old[0] ?? original;
    }
    try { fs.linkSync(path.join(serverDirectory(userId,slug,original),"server.json"),origin); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const saved = createVerifiedMcpConnection(userId, slug, name, launch, previousProfile);
  const status = await addProxyMcpConnection(userId, slug, runtimeMcpConfig(saved));
  if (status[slug]?.status !== "connected") throw new ApiError(503, "mcp_not_connected", "The verified server was saved, but could not reconnect. Check its connection in Settings.");
  return { installed: true, connection: slug, revision:digest, tools: tools.map(t => t.name), verified: tests[0], checks:tests.length,
    usage: `Use mcp_call with connection=${slug} to do the user's actual task now. Later chats discover this saved connection.` };
}
