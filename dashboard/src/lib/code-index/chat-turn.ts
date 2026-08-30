import { addStdioProxyConnection } from "../agent-runtime/mcp-proxy.ts";
import { resolveConnectedRepository } from "../opencode/repository.ts";
import { graftEnabledForGarden } from "./garden.ts";
import { graftServerFor, type GraftIndexState } from "./index-service.ts";
import { refreshGraphInBackground } from "./graph-refresh.ts";
import {
  codeIndexConnectionSlug,
  codeIndexToolMap,
  describeRepository,
  renderConnectedRepositoryContext,
  type CodeIndexToolSummary,
  type RepositoryDigest,
} from "./repository-digest.ts";
import { ensureGraftIndex } from "./runtime-build.ts";

/**
 * A Garden's connected repository, as one chat turn sees it.
 *
 * Until now the repository reached only the coding agents (Codex, OpenCode,
 * Ruflo): a Garden could have a repository connected and its own chat would
 * not know the repository existed. This hands the same repository to Garden
 * Chat and to a Terminal turn with that Garden active — a description read
 * from the checkout itself, and the graft code index as tools when the graph
 * is ready — so a question about the code is answered from the code.
 */
export interface ConnectedRepositoryTurn {
  repository: RepositoryDigest;
  garden: { slug: string; name: string };
  codeIndex: GraftIndexState;
  /** The proxy connection name, when the index is reachable this turn. */
  connection: string | null;
  tools: Record<string, boolean>;
  systemContext: string;
}

const EMPTY_TOOLS: CodeIndexToolSummary[] = [];
/**
 * Under the Hermes plugin's 45 s request budget for a tool call, so a slow
 * answer reaches the model as a clear failure from this route rather than as
 * the plugin's generic "tool service is unavailable".
 */
const CODE_INDEX_CALL_TIMEOUT_MS = 40_000;

/**
 * Resolve the repository connected to `gardenSlug` for this user. Null when
 * the Garden has none, or its folder is gone: a turn with no repository is
 * exactly the turn it was before, never an error.
 */
export async function connectedRepositoryForTurn(input: {
  userId: number;
  gardenSlug: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): Promise<ConnectedRepositoryTurn | null> {
  const gardenSlug = input.gardenSlug?.trim();
  if (!gardenSlug) return null;
  let connected: ReturnType<typeof resolveConnectedRepository>;
  try {
    connected = resolveConnectedRepository(input.userId, gardenSlug);
  } catch {
    return null;
  }
  const digest = describeRepository(connected.path);
  if (!digest) return null;
  const garden = { slug: connected.gardenSlug, name: connected.gardenName };
  const index = await codeIndexForRepository(input.userId, connected, input.env);
  return {
    repository: digest,
    garden,
    codeIndex: index.state,
    connection: index.connection,
    tools: index.connection ? codeIndexToolMap(index.connection, index.tools) : {},
    systemContext: renderConnectedRepositoryContext({
      garden,
      digest,
      codeIndex: { state: index.state, connection: index.connection, tools: index.tools },
    }),
  };
}

/**
 * The code index of the repository behind an mcp_call, for the route that
 * serves it. The slug the model used has to be the one derived from the
 * repository this session's Garden is connected to: a session cannot reach a
 * different repository's index by naming its connection.
 */
export async function codeIndexConnectionForSession(input: {
  userId: number;
  gardenSlug: string | null;
  slug: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ tools: CodeIndexToolSummary[]; repositoryPath: string } | null> {
  const gardenSlug = input.gardenSlug?.trim();
  if (!gardenSlug) return null;
  let connected: ReturnType<typeof resolveConnectedRepository>;
  try {
    connected = resolveConnectedRepository(input.userId, gardenSlug);
  } catch {
    return null;
  }
  if (codeIndexConnectionSlug(connected.path) !== input.slug) return null;
  const index = await codeIndexForRepository(input.userId, connected, input.env);
  if (!index.connection) return null;
  return { tools: index.tools, repositoryPath: connected.path };
}

async function codeIndexForRepository(
  userId: number,
  connected: { path: string; gardenSlug: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ state: GraftIndexState; connection: string | null; tools: CodeIndexToolSummary[] }> {
  if (!graftEnabledForGarden(userId, connected.gardenSlug)) {
    return { state: "missing", connection: null, tools: EMPTY_TOOLS };
  }
  // Starts the build when there is none; the turn proceeds without the index
  // and a later one gets it, the same rule the coding agents follow.
  let state: GraftIndexState;
  try {
    state = await ensureGraftIndex(userId, connected.path, { env });
  } catch {
    state = "missing";
  }
  if (state !== "ready") return { state, connection: null, tools: EMPTY_TOOLS };
  const server = graftServerFor(connected.path, env);
  if (!server) return { state: "unavailable", connection: null, tools: EMPTY_TOOLS };
  const slug = codeIndexConnectionSlug(connected.path);
  // graft refreshes the graph before it answers, and on a large repository
  // that has drifted far since the last query that refresh alone can take
  // minutes — longer than the Hermes plugin waits for any tool (45 s), so the
  // model saw a timeout, called again, and the turn never ended. Chat needs
  // the opposite trade from the coding agents: answer now from the graph as it
  // is, and bring the graph up to date in the background. GRAFT_NO_REFRESH is
  // graft's own switch for exactly that; refreshGraphInBackground is the other
  // half.
  const proxied = await addStdioProxyConnection(
    userId,
    slug,
    {
      command: server.command,
      args: server.args,
      cwd: connected.path,
      env: { GRAFT_NO_REFRESH: "1" },
    },
    CODE_INDEX_CALL_TIMEOUT_MS,
  );
  refreshGraphInBackground(connected.path, env);
  if (proxied.status.status !== "connected" || !proxied.tools.length) {
    return { state: "unavailable", connection: null, tools: EMPTY_TOOLS };
  }
  return { state, connection: slug, tools: proxied.tools };
}
