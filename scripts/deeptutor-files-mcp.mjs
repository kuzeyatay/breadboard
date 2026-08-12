// Breadboard's read-only file server for Deep Tutor, spoken as MCP over stdio.
//
// This is how the tutor reaches your material. DeepTutor's chat loop mounts
// exactly one extension surface — MCP tools — so a Breadboard-owned MCP server
// is the only way to widen what a turn can see without editing the clone. The
// scope is not decided here: Breadboard writes one `mcp.json` per tutoring
// home, and the roots it passes are the whole policy.
//
//   Garden chat  → the garden's directory (its pages, folders and uploads)
//   Terminal     → the Breadboard workspace, i.e. every file
//
// Everything is read-only and root-contained: a path that resolves outside the
// configured roots is refused, symlinks included, because resolution happens
// before the containment check rather than after.
//
// Protocol is hand-rolled rather than taken from @modelcontextprotocol/sdk on
// purpose: this process is spawned by Python inside the clone's venv, with a
// cwd that belongs to DeepTutor, so depending on the dashboard's node_modules
// resolving from there is a failure waiting to happen. The stdio subset MCP
// actually needs — initialize, tools/list, tools/call, ping — is small enough
// to own.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "breadboard-files", version: "1.0.0" };

const MAX_READ_CHARS = 120_000;
const MAX_LIST_ENTRIES = 400;
const MAX_SEARCH_HITS = 60;
const MAX_SEARCH_FILES = 4_000;
const MAX_SEARCHABLE_BYTES = 2 * 1024 * 1024;

/** Directories never worth a tutor's attention, and expensive to walk. */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".next-desktop",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "dist",
  "build",
  ".turbo",
  ".pytest_cache",
  ".ruff_cache",
]);

/** Extensions we will hand to a model as text. */
const TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".org", ".tex", ".bib",
  ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env",
  ".csv", ".tsv",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".kt", ".sh", ".ps1",
  ".sql", ".html", ".css", ".scss", ".svg", ".xml", ".vue", ".svelte",
]);

function parseRoots() {
  const raw = process.env.BREADBOARD_TUTOR_ROOTS ?? "";
  const roots = [];
  for (const entry of raw.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    let resolved;
    try {
      resolved = fs.realpathSync(path.resolve(trimmed));
    } catch {
      // A root that does not exist yet (an empty garden) is not an error; it
      // simply contributes nothing until something is written there.
      continue;
    }
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return roots;
}

const ROOTS = parseRoots();
const SCOPE_LABEL = process.env.BREADBOARD_TUTOR_SCOPE_LABEL || "your materials";

/**
 * Resolve a model-supplied path inside the allowed roots.
 *
 * Paths are relative to a root by default, and a bare `<root-name>/rest` form
 * is accepted too so a multi-root scope can be navigated from one listing.
 * Real paths are compared, so a symlink pointing out of a root is refused
 * rather than followed.
 */
function resolveInsideRoots(requested) {
  if (!ROOTS.length) throw new Error("No material is in scope for this session.");
  const raw = String(requested ?? "").trim();
  if (!raw || raw === "." || raw === "/" || raw === "./") {
    return { path: ROOTS[0], root: ROOTS[0] };
  }
  const candidates = [];
  if (path.isAbsolute(raw)) {
    candidates.push(raw);
  } else {
    for (const root of ROOTS) {
      candidates.push(path.resolve(root, raw));
      // `docs/intro.md` typed as `garden-name/docs/intro.md`.
      const [head, ...rest] = raw.split(/[\\/]/);
      if (rest.length && path.basename(root) === head) {
        candidates.push(path.resolve(root, rest.join(path.sep)));
      }
    }
  }
  for (const candidate of candidates) {
    let real;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      // Not on disk: fall back to the lexical path so "file not found" is what
      // the model is told, but only when it would have been inside a root.
      real = path.resolve(candidate);
    }
    const root = ROOTS.find(
      (item) => real === item || real.startsWith(item + path.sep),
    );
    if (root) return { path: real, root };
  }
  throw new Error(`That path is outside ${SCOPE_LABEL}: ${raw}`);
}

/** How a path is named back to the model: relative to its root. */
function displayPath(target, root) {
  const relative = path.relative(root, target);
  const prefix = ROOTS.length > 1 ? `${path.basename(root)}/` : "";
  return relative ? `${prefix}${relative.split(path.sep).join("/")}` : prefix || ".";
}

function isTextFile(file) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function listDirectory(args) {
  const { path: target, root } = resolveInsideRoots(args.path);
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return `${displayPath(target, root)} is a file, not a directory.`;
  }
  const recursive = args.recursive === true;
  const lines = [];
  let truncated = false;

  const walk = (directory, depth) => {
    if (truncated) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (lines.length >= MAX_LIST_ENTRIES) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${displayPath(full, root)}/`);
        if (recursive && depth < 6) walk(full, depth + 1);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          // Vanished between readdir and stat; report it without a size.
        }
        lines.push(`${displayPath(full, root)} (${formatBytes(size)})`);
      }
    }
  };

  walk(target, 0);
  if (!lines.length) return `${displayPath(target, root)} is empty.`;
  const header = `${lines.length} entr${lines.length === 1 ? "y" : "ies"} under ${displayPath(target, root)}`;
  const footer = truncated ? `\n… listing stopped at ${MAX_LIST_ENTRIES} entries.` : "";
  return `${header}:\n${lines.join("\n")}${footer}`;
}

function readFile(args) {
  const { path: target, root } = resolveInsideRoots(args.path);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return listDirectory({ path: args.path });
  if (!isTextFile(target)) {
    return `${displayPath(target, root)} is not a text file (${formatBytes(stat.size)}). Attach it to the conversation instead — the tutor reads PDFs and Office documents that way.`;
  }
  const content = fs.readFileSync(target, "utf8");
  const lines = content.split(/\r?\n/);
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.max(1, Number(args.limit) || lines.length);
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  if (!slice.length) {
    return `${displayPath(target, root)} has ${lines.length} lines; line ${offset} is past the end.`;
  }
  let body = slice.join("\n");
  let clipped = "";
  if (body.length > MAX_READ_CHARS) {
    body = body.slice(0, MAX_READ_CHARS);
    clipped = "\n… truncated; read a later range with offset.";
  }
  const end = offset - 1 + slice.length;
  const range = end < lines.length ? ` (lines ${offset}–${end} of ${lines.length})` : "";
  return `# ${displayPath(target, root)}${range}\n\n${body}${clipped}`;
}

function searchFiles(args) {
  const query = String(args.query ?? "").trim();
  if (!query) return "Give a word or phrase to search for.";
  const lowered = query.toLowerCase();
  const scope = args.path ? [resolveInsideRoots(args.path)] : ROOTS.map((root) => ({ path: root, root }));
  const hits = [];
  let filesSeen = 0;

  const walk = (directory, root) => {
    if (hits.length >= MAX_SEARCH_HITS || filesSeen >= MAX_SEARCH_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= MAX_SEARCH_HITS || filesSeen >= MAX_SEARCH_FILES) return;
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full, root);
        continue;
      }
      if (!entry.isFile() || !isTextFile(full)) continue;
      filesSeen += 1;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_SEARCHABLE_BYTES) continue;
      let content;
      try {
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(lowered)) continue;
        hits.push(`${displayPath(full, root)}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);
        if (hits.length >= MAX_SEARCH_HITS) return;
      }
    }
  };

  for (const entry of scope) {
    let stat;
    try {
      stat = fs.statSync(entry.path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(entry.path, entry.root);
  }

  if (!hits.length) return `No line matching "${query}" in ${SCOPE_LABEL}.`;
  const capped = hits.length >= MAX_SEARCH_HITS ? `\n… stopped at ${MAX_SEARCH_HITS} matches.` : "";
  return `${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}":\n${hits.join("\n")}${capped}`;
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const TOOLS = [
  {
    name: "list_materials",
    description: `List the files and folders in ${SCOPE_LABEL}. Start here to see what is available before reading anything.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder to list. Omit for the top level." },
        recursive: { type: "boolean", description: "Include sub-folders (up to 6 deep)." },
      },
    },
    run: listDirectory,
  },
  {
    name: "read_material",
    description: `Read a text file from ${SCOPE_LABEL} — notes, source code, data files. Use list_materials or search_materials first to find the path.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path as reported by list_materials." },
        offset: { type: "integer", description: "First line to read (1-indexed)." },
        limit: { type: "integer", description: "How many lines to read." },
      },
      required: ["path"],
    },
    run: readFile,
  },
  {
    name: "search_materials",
    description: `Find which files in ${SCOPE_LABEL} mention a word or phrase, with the matching lines. Use this when you do not know where something is written.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for (case-insensitive)." },
        path: { type: "string", description: "Restrict the search to this folder." },
      },
      required: ["query"],
    },
    run: searchFiles,
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(request) {
  const { id, method, params } = request;
  // Notifications carry no id and expect no reply.
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: `Read-only access to ${SCOPE_LABEL}.`,
    });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") {
    respond(id, {});
    return;
  }
  if (method === "tools/list") {
    respond(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const tool = TOOLS.find((item) => item.name === name);
    if (!tool) {
      respondError(id, -32602, `Unknown tool: ${name}`);
      return;
    }
    try {
      const text = tool.run(params?.arguments ?? {});
      respond(id, { content: [{ type: "text", text: String(text) }], isError: false });
    } catch (error) {
      // A refusal is a result, not a transport failure: the model should read
      // it and try a different path rather than see the tool disappear.
      respond(id, {
        content: [{ type: "text", text: error instanceof Error ? error.message : "The file could not be read." }],
        isError: true,
      });
    }
    return;
  }
  if (!isNotification) respondError(id, -32601, `Unsupported method: ${method}`);
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }
  const batch = Array.isArray(request) ? request : [request];
  for (const item of batch) {
    try {
      handle(item);
    } catch (error) {
      if (item?.id !== undefined && item?.id !== null) {
        respondError(item.id, -32603, error instanceof Error ? error.message : "internal error");
      }
    }
  }
});
input.on("close", () => process.exit(0));
