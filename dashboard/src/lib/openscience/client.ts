// The OpenScience server's HTTP API, as much of it as a Breadboard run needs.
//
// The server is loopback-only and unauthenticated by design, so there is no
// token to carry — the base URL is the whole handle. Every call is small and
// typed here rather than through the published SDK: the SDK is an ESM package
// built for Bun that expects to be bundled with the CLI, and three fetches are
// not worth that dependency.

const REQUEST_TIMEOUT_MS = 60_000;

export interface Connection {
  baseUrl: string;
}

export interface SessionInfo {
  id: string;
  title?: string;
}

export interface ProjectInfo {
  id: string;
  worktree?: string;
}

export interface TrustStatus {
  projectID: string;
  root: string;
  state: "trusted" | "untrusted" | "revoked";
  canExecuteProjectCode: boolean;
}

export interface MessagePart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; output?: string; title?: string; error?: unknown };
}

export interface MessageRecord {
  info?: { id?: string; role?: string; error?: unknown; tokens?: TokenCounts };
  parts?: MessagePart[];
}

export interface TokenCounts {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

async function call<T>(
  connection: Connection,
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwarded = init.signal;
  const onAbort = () => controller.abort();
  forwarded?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(new URL(path, connection.baseUrl), {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenScience refused ${path} (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
    forwarded?.removeEventListener("abort", onAbort);
  }
}

export async function health(connection: Connection): Promise<boolean> {
  return await call<unknown>(connection, "/config")
    .then(() => true)
    .catch(() => false);
}

export async function currentProject(connection: Connection): Promise<ProjectInfo> {
  return call<ProjectInfo>(connection, "/project/current");
}

export async function trustStatus(
  connection: Connection,
  projectId: string,
): Promise<TrustStatus> {
  return call<TrustStatus>(connection, `/project/${encodeURIComponent(projectId)}/trust`);
}

/**
 * Grant the workspace the right to execute its own code.
 *
 * A fresh project is untrusted, and an untrusted project may not start a
 * process at all: the shell, the Python kernel and every job capability fail
 * with `ExecutionAuthorityDeniedError`. The agent can still write a script, so
 * the run looks like it worked right up until it reports that it could not run
 * anything.
 *
 * The grant is safe to make on Breadboard's behalf because the root it names is
 * Breadboard's own workspace directory, created for this purpose and nothing
 * else. The server rejects a root that is not the project's canonical one, so
 * this cannot be pointed elsewhere.
 */
export async function grantTrust(
  connection: Connection,
  projectId: string,
  root: string,
): Promise<TrustStatus> {
  return call<TrustStatus>(connection, `/project/${encodeURIComponent(projectId)}/trust`, {
    method: "PUT",
    body: JSON.stringify({ trusted: true, root }),
  });
}

export async function createSession(
  connection: Connection,
  title: string,
): Promise<SessionInfo> {
  return call<SessionInfo>(connection, "/session", {
    method: "POST",
    body: JSON.stringify({
      title: title.slice(0, 200),
      // Nobody is watching a headless run, and an unanswered question stalls
      // the turn indefinitely rather than failing it.
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    }),
  });
}

export interface PromptInput {
  sessionId: string;
  agent: string;
  /** Provider id as declared in the written config. */
  providerId: string;
  model: string;
  variant?: string;
  text: string;
  signal?: AbortSignal;
}

/**
 * Send the turn and return as soon as the runtime has accepted it.
 *
 * The synchronous `/message` endpoint holds its response open for the whole
 * turn, which for a research run is minutes — long enough that any request
 * timeout worth having on the other calls would abort the work itself. The
 * async endpoint answers 204 immediately and publishes everything, including
 * session-level failures, on the event stream this run is already following.
 */
export async function prompt(connection: Connection, input: PromptInput): Promise<void> {
  await call<unknown>(
    connection,
    `/session/${encodeURIComponent(input.sessionId)}/prompt_async`,
    {
      method: "POST",
      signal: input.signal,
      body: JSON.stringify({
        agent: input.agent,
        model: { providerID: input.providerId, modelID: input.model },
        ...(input.variant ? { variant: input.variant } : {}),
        parts: [{ type: "text", text: input.text }],
      }),
    },
  );
}

export async function abortSession(
  connection: Connection,
  sessionId: string,
): Promise<void> {
  await call<unknown>(connection, `/session/${encodeURIComponent(sessionId)}/abort`, {
    method: "POST",
  }).catch(() => undefined);
}

export async function respondToPermission(
  connection: Connection,
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await call<unknown>(
    connection,
    `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
    { method: "POST", body: JSON.stringify({ response }) },
  ).catch(() => undefined);
}

export async function listMessages(
  connection: Connection,
  sessionId: string,
): Promise<MessageRecord[]> {
  return call<MessageRecord[]>(
    connection,
    `/session/${encodeURIComponent(sessionId)}/message`,
  ).catch(() => []);
}
