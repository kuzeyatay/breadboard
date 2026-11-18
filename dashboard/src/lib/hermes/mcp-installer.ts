import { spawn } from "node:child_process";
import os from "node:os";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { addProxyMcpConnection, proxyMcpTools, setProxyMcpConnectionConnected } from "../agent-runtime/mcp-proxy.ts";
import { mcpSlug, parseMcpConfig, runtimeMcpConfig, saveMcpConnection, setMcpConnectionEnabled } from "./mcp-connections.ts";
import { ApiError } from "./route-core.ts";
import { MCP_INSTALLER_CONNECTION } from "./mcp-installer-context.ts";

/**
 * Built-in connection that lets a chat turn find an MCP server on GitHub and
 * add it to Breadboard. The saved connection is an ordinary hermes_mcp_connections
 * row, so every later turn and chat discovers it like one added in Settings.
 */
export { MCP_INSTALLER_CONNECTION, MCP_INSTALLER_CONTEXT } from "./mcp-installer-context.ts";

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const LAUNCHES = ["npx", "uvx", "clone", "remote"] as const;

const TOOLS = [
  {
    name: "search",
    description: "Search GitHub for MCP server repositories matching a program, service or topic. Returns candidates ranked by stars.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "inspect",
    description: "Read one repository's README, root files, npm/PyPI publication and entry points to decide how to launch it.",
    inputSchema: { type: "object", properties: { repo: { type: "string", description: "owner/name" } }, required: ["repo"] },
  },
  {
    name: "install",
    description: "Add the MCP server to Breadboard after the user approves the exact command, connect it and list its tools.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name on GitHub" },
        name: { type: "string", description: "Display name, e.g. PowerWorld" },
        launch: { type: "string", enum: LAUNCHES },
        package: { type: "string", description: "npm or PyPI package name when published" },
        command: { type: "string", description: "uvx from git: console-script name. clone: run command, e.g. 'python server.py' or 'node build/index.js'" },
        args: { type: "array", items: { type: "string" }, description: "Extra server arguments" },
        url: { type: "string", description: "remote: the server's HTTPS MCP URL" },
        ref: { type: "string", description: "clone: branch or tag to check out" },
        environmentNames: { type: "array", items: { type: "string" }, description: "Environment variable NAMES the server reads (never values)" },
      },
      required: ["repo", "launch"],
    },
  },
];

function str(value: unknown, field: string, max = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ApiError(400, "invalid_mcp_installer_call", `${field} is required.`);
  }
  return value.trim();
}

function repoName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "invalid_mcp_repo", "repo is required: retry the same call with repo=\"owner/name\" of the GitHub repository you inspected.");
  const repo = str(value, "repo", 201).replace(/^https:\/\/github\.com\//i, "").replace(/\.git$|\/$/g, "");
  if (!REPO.test(repo)) throw new ApiError(400, "invalid_mcp_repo", "repo must be owner/name on GitHub.");
  return repo;
}

async function github(route: string, signal?: AbortSignal, raw = false): Promise<any> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  const response = await fetch(`https://api.github.com${route}`, {
    signal,
    headers: {
      Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "User-Agent": "breadboard-mcp-installer",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(502, "github_unavailable", response.status === 403 || response.status === 429
      ? "GitHub rate-limited the search. Wait a minute and try again."
      : `GitHub returned ${response.status}.`);
  }
  return raw ? response.text() : response.json();
}

async function published(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    return (await fetch(url, { signal, method: "GET", headers: { Accept: "application/json" } })).ok;
  } catch {
    return false;
  }
}

async function search(args: Record<string, unknown>, signal?: AbortSignal) {
  // Filler words ("server", "GitHub") make GitHub's AND search miss the real repos.
  const raw = str(args.query, "query", 200);
  const query = raw
    .replace(/\b(?:mcp|model context protocol|servers?|github|repo(?:sitory)?|install|pypi|npm|for|the|an?)\b/gi, " ")
    .replace(/\s+/g, " ").trim() || raw;
  const q = encodeURIComponent(`${query} mcp`);
  const data = await github(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`, signal);
  const candidates = (data?.items ?? []).map((item: any) => ({
    repo: item.full_name,
    description: String(item.description ?? "").slice(0, 300),
    stars: item.stargazers_count,
    language: item.language,
    updated: item.pushed_at,
    archived: item.archived,
  }));
  return { query, candidates, next: candidates.length ? "Inspect the most relevant, maintained candidate." : "No repository matched; try a broader or alternate name." };
}

async function inspect(args: Record<string, unknown>, signal?: AbortSignal) {
  const repo = repoName(args.repo);
  const meta = await github(`/repos/${repo}`, signal);
  if (!meta) throw new ApiError(404, "mcp_repo_not_found", `${repo} was not found on GitHub.`);
  const [readme, root, packageJson, pyproject] = await Promise.all([
    github(`/repos/${repo}/readme`, signal, true).catch(() => null),
    github(`/repos/${repo}/contents`, signal).catch(() => null),
    github(`/repos/${repo}/contents/package.json`, signal, true).catch(() => null),
    github(`/repos/${repo}/contents/pyproject.toml`, signal, true).catch(() => null),
  ]);
  let npm: Record<string, unknown> | null = null;
  try {
    const parsed = packageJson ? JSON.parse(packageJson) : null;
    if (parsed) {
      npm = {
        name: parsed.name, bin: parsed.bin, main: parsed.main, buildScript: parsed.scripts?.build ?? null,
        publishedOnNpm: parsed.name && !parsed.private ? await published(`https://registry.npmjs.org/${String(parsed.name).replace("/", "%2f")}`, signal) : false,
      };
    }
  } catch { /* A malformed package.json just leaves npm unknown. */ }
  const pyName = typeof pyproject === "string" ? /^\s*name\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1] : undefined;
  const pyScripts = typeof pyproject === "string" ? /\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/.exec(pyproject)?.[1]?.trim() : undefined;
  return {
    repo,
    description: meta.description,
    stars: meta.stargazers_count,
    archived: meta.archived,
    defaultBranch: meta.default_branch,
    rootFiles: Array.isArray(root) ? root.map((entry: any) => entry.name).slice(0, 60) : [],
    npm,
    python: pyName ? { name: pyName, scripts: pyScripts ?? null, publishedOnPypi: await published(`https://pypi.org/pypi/${pyName}/json`, signal) } : null,
    readme: typeof readme === "string" ? readme.slice(0, 12_000) : null,
  };
}

function which(name: string): string {
  const directories = [
    ...(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter),
    path.join(os.homedir(), ".local", "bin"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs") : "",
  ].filter(Boolean);
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* keep looking */ }
    }
  }
  throw new ApiError(503, "mcp_launcher_missing", `${name} is not installed on this computer, so this MCP cannot be launched that way. Try another launch method or ask the user to install ${name}.`);
}

/**
 * npm and npx as `node <npm>/bin/<name>-cli.js`. Their Windows .cmd shims break
 * under an absolute "C:\Program Files" path when spawned without a shell
 * ("'C:Program Files' is not recognized"), so no launch goes through them.
 */
function npmTool(name: "npm" | "npx"): { executable: string; prefix: string[] } {
  for (const node of [(() => { try { return which("node"); } catch { return ""; } })(), process.execPath].filter(Boolean)) {
    const cli = path.join(path.dirname(node), "node_modules", "npm", "bin", `${name}-cli.js`);
    if (fs.existsSync(cli)) return { executable: node, prefix: [cli] };
  }
  const shim = which(name);
  return { executable: shim, prefix: [] };
}

function launcher(name: string): { executable: string; prefix: string[] } {
  if (name === "npm" || name === "npx") return npmTool(name);
  if (name === "node") return { executable: process.execPath, prefix: [] };
  return { executable: which(name), prefix: [] };
}

function run(executable: string, args: string[], cwd: string | undefined, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, signal, windowsHide: true, timeout: 10 * 60_000 });
    let tail = "";
    const keep = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-1_500); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new ApiError(502, "mcp_setup_failed", `${path.basename(executable)} ${args.slice(0, 2).join(" ")} failed: ${tail.trim()}`)));
  });
}

function strings(value: unknown, max = 30): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 500).slice(0, max) : [];
}

function plan(args: Record<string, unknown>) {
  const repo = repoName(args.repo);
  const launch = args.launch as typeof LAUNCHES[number];
  if (!LAUNCHES.includes(launch)) throw new ApiError(400, "invalid_mcp_launch", `launch must be exactly one of ${LAUNCHES.join(", ")}; put the package name in package and server arguments in args.`);
  const displayName = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 100) : repo.split("/")[1];
  const slug = mcpSlug(displayName);
  const extra = strings(args.args);
  const environmentNames = strings(args.environmentNames, 50);
  const pkg = typeof args.package === "string" && /^[@A-Za-z0-9._/\-=<>!~\[\],]{1,200}$/.test(args.package.trim()) ? args.package.trim() : null;
  const command = typeof args.command === "string" ? args.command.trim().split(/\s+/).filter(Boolean).slice(0, 30) : [];
  const directory = path.join(dashboardDataDir(), "mcp-servers", slug);
  const ref = typeof args.ref === "string" && /^[A-Za-z0-9._\/-]{1,100}$/.test(args.ref) && !args.ref.startsWith("-") ? args.ref : null;
  if (launch === "remote") {
    return { repo, launch, slug, displayName, directory, environmentNames, url: str(args.url, "url", 2_000), preview: `connect to ${args.url}` };
  }
  if (launch === "npx") {
    // Models often repeat the launcher's own flags; the server would receive them as arguments.
    const argv = ["-y", pkg ?? `github:${repo}`, ...extra.filter((value) => !["-y", "--yes", pkg].includes(value))];
    return { repo, launch, slug, displayName, directory, environmentNames, argv, preview: `npx ${argv.join(" ")}` };
  }
  if (launch === "uvx") {
    if (!pkg && !command.length) throw new ApiError(400, "mcp_command_required", "uvx from git needs command: the console-script name from pyproject [project.scripts].");
    const argv = pkg
      ? command.length ? ["--from", pkg, ...command, ...extra] : [pkg, ...extra]
      : ["--from", `git+https://github.com/${repo}`, ...command, ...extra];
    return { repo, launch, slug, displayName, directory, environmentNames, argv, preview: `uvx ${argv.join(" ")}` };
  }
  if (!command.length) throw new ApiError(400, "mcp_command_required", "clone needs command: how the README runs the server, e.g. 'python server.py'.");
  return {
    repo, launch, slug, displayName, directory, environmentNames, ref, command: [...command, ...extra],
    preview: `git clone${ref ? ` --branch ${ref}` : ""} https://github.com/${repo} into ${directory}, install its dependencies, then run ${[...command, ...extra].join(" ")}`,
  };
}

async function localLaunch(step: ReturnType<typeof plan>, signal?: AbortSignal): Promise<{ executable: string; args: string[]; cwd?: string }> {
  if (step.launch === "npx") {
    const npx = npmTool("npx");
    return { executable: npx.executable, args: [...npx.prefix, ...step.argv!] };
  }
  if (step.launch === "uvx") return { executable: which("uvx"), args: step.argv! };
  const directory = step.directory;
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  await run(which("git"), ["clone", "--depth", "1", ...(step.ref ? ["--branch", step.ref] : []), `https://github.com/${step.repo}.git`, directory], undefined, signal);
  const command = step.command!;
  if (fs.existsSync(path.join(directory, "package.json"))) {
    const npm = npmTool("npm");
    await run(npm.executable, [...npm.prefix, "install", "--no-audit", "--no-fund"], directory, signal);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    if (manifest.scripts?.build) await run(npm.executable, [...npm.prefix, "run", "build"], directory, signal);
    const start = launcher(command[0]);
    return { executable: start.executable, args: [...start.prefix, ...command.slice(1)], cwd: directory };
  }
  // Python (pyproject or requirements.txt): uv resolves the environment per repo.
  const python = /^python3?$/i.test(command[0]);
  const requirements = !fs.existsSync(path.join(directory, "pyproject.toml")) && fs.existsSync(path.join(directory, "requirements.txt"))
    ? ["--with-requirements", path.join(directory, "requirements.txt")] : [];
  return {
    executable: which("uv"),
    args: ["run", "--directory", directory, ...requirements, ...(python ? ["python", ...command.slice(1)] : command)],
    cwd: directory,
  };
}

async function install(userId: number, args: Record<string, unknown>, permissionGranted: boolean, signal?: AbortSignal) {
  const step = plan(args);
  if (!permissionGranted) {
    // Reuses Hermes' native connected-app approval; the retry repeats the same arguments.
    throw new ApiError(428, "connected_app_permission_required",
      `Add MCP server ${step.repo} to Breadboard as "${step.displayName}"? This runs code from GitHub on this computer: ${step.preview}`);
  }
  const body = step.launch === "remote"
    ? { displayName: step.displayName, slug: step.slug, transport: "remote", url: step.url, oauth: false, timeout: 120_000 }
    : { displayName: step.displayName, slug: step.slug, transport: "local", approved: true, environmentNames: step.environmentNames, timeout: 120_000, ...(await localLaunch(step, signal)) };
  const connection = saveMcpConnection(userId, parseMcpConfig(body));
  const status = await addProxyMcpConnection(userId, step.slug, runtimeMcpConfig(connection));
  if (status[step.slug]?.status !== "connected") {
    // Keep the row (the user can retry in Settings) but do not advertise a dead server.
    setMcpConnectionEnabled(userId, connection.id, false);
    await setProxyMcpConnectionConnected(userId, step.slug, false).catch(() => {});
    const detail = (status[step.slug] as { error?: string } | undefined)?.error;
    throw new ApiError(502, "mcp_install_not_connected",
      `${step.repo} was saved as "${step.slug}" but did not start${detail ? `: ${detail}` : ""}. Check the README for required environment variables, a running desktop program, or a different run command, then install again.`);
  }
  const tools = proxyMcpTools(userId, step.slug).map((tool) => ({ name: tool.name, description: String(tool.description ?? "").slice(0, 200) }));
  return {
    installed: true,
    connection: step.slug,
    repo: step.repo,
    command: step.preview,
    tools,
    usage: `Call these with mcp_call connection=${JSON.stringify(step.slug)}. It is now available in every chat.`,
  };
}

export async function callMcpInstaller(input: {
  userId: number;
  tool: string;
  args: Record<string, unknown>;
  permissionGranted: boolean;
  signal?: AbortSignal;
}): Promise<{ data: unknown; installedSlug?: string }> {
  if (input.tool === "__breadboard_list_tools") return { data: { tools: TOOLS } };
  if (input.tool === "search") return { data: await search(input.args, input.signal) };
  if (input.tool === "inspect") return { data: await inspect(input.args, input.signal) };
  if (input.tool === "install") {
    const result = await install(input.userId, input.args, input.permissionGranted, input.signal);
    return { data: result, installedSlug: result.connection };
  }
  throw new ApiError(403, "mcp_tool_denied", "The MCP installer offers search, inspect and install.");
}
