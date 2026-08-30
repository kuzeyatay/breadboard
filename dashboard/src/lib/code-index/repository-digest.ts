import { execFileSync } from "node:child_process";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { graftRepositoryKey, type GraftIndexState } from "./index-service.ts";

/**
 * What a chat turn is told about the repository its Garden is connected to.
 *
 * Nothing here is written by hand: every line is read from the repository at
 * the moment of the turn — its git identity, its top-level layout, the opening
 * of its README — so the same code describes any repository a user connects.
 * The description is deliberately small (a few hundred tokens): it gives the
 * model a true picture of what the repository is and where to look, and the
 * code index does the rest when a question needs the code itself.
 */
export interface RepositoryDigest {
  name: string;
  path: string;
  branch: string | null;
  head: { sha: string; date: string; subject: string } | null;
  remote: string | null;
  /** Top-level entries, directories first and suffixed with `/`. */
  entries: string[];
  /** Entries beyond what `entries` lists. */
  hiddenEntryCount: number;
  readme: { file: string; excerpt: string } | null;
}

/** The Breadboard-owned MCP connection that exposes a repository's code index. */
export const CODE_INDEX_CONNECTION_PREFIX = "code-index-";

export function codeIndexConnectionSlug(repositoryPath: string): string {
  return `${CODE_INDEX_CONNECTION_PREFIX}${graftRepositoryKey(repositoryPath).slice(0, 8)}`;
}

export function isCodeIndexConnectionSlug(slug: string): boolean {
  return new RegExp(`^${CODE_INDEX_CONNECTION_PREFIX}[0-9a-f]{8}$`).test(slug);
}

const MAX_ENTRIES = 40;
const README_EXCERPT_CHARS = 1_200;
const GIT_TIMEOUT_MS = 3_000;
const DIGEST_TTL_MS = 60_000;
const IGNORED_ENTRIES = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db"]);
const README_NAMES = ["README.md", "README.MD", "readme.md", "README", "README.txt", "README.rst"];

const cache = new Map<string, { digest: RepositoryDigest; at: number }>();

function git(repositoryPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function topLevelEntries(repositoryPath: string): { entries: string[]; hidden: number } {
  let names: Array<{ name: string; directory: boolean }>;
  try {
    names = fs
      .readdirSync(repositoryPath, { withFileTypes: true })
      .filter((entry) => !IGNORED_ENTRIES.has(entry.name))
      .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
  } catch {
    return { entries: [], hidden: 0 };
  }
  names.sort((left, right) =>
    left.directory === right.directory
      ? left.name.localeCompare(right.name)
      : left.directory
        ? -1
        : 1,
  );
  const rendered = names.map((entry) => (entry.directory ? `${entry.name}/` : entry.name));
  return {
    entries: rendered.slice(0, MAX_ENTRIES),
    hidden: Math.max(0, rendered.length - MAX_ENTRIES),
  };
}

function readmeExcerpt(repositoryPath: string): RepositoryDigest["readme"] {
  for (const candidate of README_NAMES) {
    const file = path.join(repositoryPath, candidate);
    let text: string;
    try {
      if (!fs.statSync(file).isFile()) continue;
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const excerpt = text
      .replace(/<[^>\n]{1,200}>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, README_EXCERPT_CHARS)
      .trim();
    if (excerpt) return { file: candidate, excerpt };
  }
  return null;
}

/**
 * Read the repository. Null when the path is not a git checkout any more —
 * a moved or deleted folder is reported as absent rather than as an empty
 * repository the model might describe as such.
 */
export function describeRepository(
  repositoryPath: string,
  options: { now?: () => number; cache?: boolean } = {},
): RepositoryDigest | null {
  const now = options.now ?? Date.now;
  const resolved = path.resolve(repositoryPath);
  const useCache = options.cache !== false;
  const cached = useCache ? cache.get(resolved) : undefined;
  if (cached && now() - cached.at < DIGEST_TTL_MS) return cached.digest;
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
    if (!fs.existsSync(path.join(resolved, ".git"))) return null;
  } catch {
    return null;
  }
  const branch = git(resolved, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const headLine = git(resolved, ["log", "-1", "--format=%h%x1f%cs%x1f%s"]);
  const headParts = headLine ? headLine.split("\u001f") : [];
  const head =
    headParts.length === 3
      ? { sha: headParts[0], date: headParts[1], subject: headParts[2].slice(0, 160) }
      : null;
  const remote = git(resolved, ["config", "--get", "remote.origin.url"]);
  const listing = topLevelEntries(resolved);
  const digest: RepositoryDigest = {
    name: path.basename(resolved),
    path: resolved,
    branch: branch && branch !== "HEAD" ? branch : branch ? "detached HEAD" : null,
    head,
    remote: remote ? redactRemote(remote) : null,
    entries: listing.entries,
    hiddenEntryCount: listing.hidden,
    readme: readmeExcerpt(resolved),
  };
  if (useCache) cache.set(resolved, { digest, at: now() });
  return digest;
}

/** A remote URL can embed a token; the host and path are all the model needs. */
function redactRemote(url: string): string {
  return url.replace(/^(\w+:\/\/)[^@/]+@/, "$1");
}

export interface CodeIndexToolSummary {
  name: string;
  description?: string;
}

export function codeIndexToolMap(
  connection: string,
  tools: readonly CodeIndexToolSummary[],
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const tool of tools) map[`${connection}_${tool.name}`] = true;
  // The proxied tools are reached through mcp_call, which the map must name
  // explicitly: a selected MCP tool never widens the brokered policy, so an
  // entry the policy left unset would stay unset.
  if (tools.length) map.mcp_call = true;
  return map;
}

/**
 * The `# connected_repository` block. Placed right after the memory context so
 * the model reads the repository as something it knows about this Garden, not
 * as a capability advertisement at the end of the prompt.
 */
export function renderConnectedRepositoryContext(input: {
  garden: { slug: string; name: string };
  digest: RepositoryDigest;
  codeIndex: {
    state: GraftIndexState;
    connection: string | null;
    tools: readonly CodeIndexToolSummary[];
  };
}): string {
  const { digest, garden, codeIndex } = input;
  const identity = [
    digest.branch ? `Branch: ${digest.branch}` : "",
    digest.head
      ? `HEAD ${digest.head.sha} (${digest.head.date}) ${JSON.stringify(digest.head.subject)}`
      : "",
    digest.remote ? `origin: ${digest.remote}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const entries = digest.entries.length
    ? `Top level: ${digest.entries.join(", ")}${
        digest.hiddenEntryCount ? ` (+${digest.hiddenEntryCount} more)` : ""
      }`
    : "Top level: (empty)";
  const readme = digest.readme
    ? [`${digest.readme.file} (opening excerpt):`, '"""', digest.readme.excerpt, '"""'].join("\n")
    : "No README at the top level.";
  const toolLines = codeIndex.tools.map((tool) => {
    const description = tool.description?.replace(/\s+/g, " ").trim().slice(0, 200);
    return `- ${tool.name}${description ? ` — ${description}` : ""}`;
  });
  const indexSection =
    codeIndex.state === "ready" && codeIndex.connection && toolLines.length
      ? [
          `Its code index is live for this turn. Call Breadboard's mcp_call tool with connection=${JSON.stringify(codeIndex.connection)} and one of these exact tool names:`,
          ...toolLines,
          "Start with graft_find_code for \"how does X work\" or \"where is Y\"; graft_find_all for every occurrence of a literal; graft_trace_calls before describing what depends on a symbol; graft_file_api for one file's API; graft_repo_map to get oriented. Quote the file:line the index returns rather than guessing, and read the index before answering any question about how this code works.",
          "A handful of calls is enough for one answer. If a call fails or reports that the index could not answer, do not call it again this turn: answer from what you already have and say what needed the code itself.",
        ].join("\n")
      : codeIndex.state === "building"
        ? "Its code index is still being built, so this turn has the summary above and no code tools. Answer what the summary supports and say plainly when a question needs the code itself; the index will be ready for a later message."
        : codeIndex.state === "unavailable"
          ? "No code index is installed on this machine, so this turn has the summary above only; say plainly when a question needs the code itself."
          : "Its code index is not available for this turn, so answer from the summary above and say plainly when a question needs the code itself.";
  return [
    "# connected_repository",
    `The Garden ${JSON.stringify(garden.name)} (${garden.slug}) is connected to the local Git repository ${JSON.stringify(digest.name)} at ${digest.path}.`,
    identity,
    entries,
    readme,
    "Treat this repository as part of what you know about this Garden. When the user asks about it — what it is, how it is organised, how something in it works, where something lives, what changed — answer from the repository itself and name concrete paths. Never invent files, symbols or history it does not contain.",
    indexSection,
  ]
    .filter(Boolean)
    .join("\n");
}
