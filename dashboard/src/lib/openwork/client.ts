// A typed client for the OpenWork server's HTTP API.
//
// Only the handful of endpoints a Breadboard run needs are modelled. The
// notable one is session creation: OpenWork has no separate "send a prompt"
// endpoint, because `POST /workspace/:id/sessions` accepts the prompt and
// starts the turn itself. One call is therefore the whole trigger, and the
// transcript is read back from the messages endpoint afterwards.

export interface OpenworkConnection {
  serverUrl: string;
  token: string;
  workspaceId: string;
}

export interface OpenworkSession {
  id: string;
  title: string;
  started: boolean;
}

export interface OpenworkMessagePart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; title?: string; error?: unknown };
}

export interface OpenworkMessage {
  id: string;
  role: string;
  parts: OpenworkMessagePart[];
  error?: unknown;
  tokens?: { input?: number; output?: number; reasoning?: number };
  cost?: number;
}

export interface OpenworkArtifact {
  id: string;
  path: string;
  size: number;
  updatedAt: number;
}

const REQUEST_TIMEOUT_MS = 60_000;

export class OpenworkApiError extends Error {
  // Declared and assigned rather than written as a constructor parameter
  // property: the repo's tests run TypeScript through Node's strip-only mode,
  // which refuses that syntax outright.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenworkApiError";
    this.status = status;
  }
}

async function request<T>(
  connection: OpenworkConnection,
  method: string,
  pathname: string,
  body?: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const response = await fetch(new URL(pathname, connection.serverUrl), {
    method,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    // The server answers errors as {error, message}; fall back to the body so a
    // proxy's HTML error page is still readable in a chat event.
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      detail = String(parsed.message ?? parsed.error ?? detail);
    } catch {
      // Not JSON — the raw body is the best message available.
    }
    throw new OpenworkApiError(detail || `request failed (${response.status})`, response.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Start a session, and with it the turn. `providerId`/`modelId` name the model
 * inside the engine's config; `variant` is how OpenCode expresses reasoning
 * effort, and the generated config declares one variant per effort so any of
 * them resolves.
 */
export async function createSession(
  connection: OpenworkConnection,
  input: { title: string; prompt: string; model: string; variant?: string },
): Promise<OpenworkSession> {
  const body = await request<{ item?: { id?: unknown; title?: unknown }; started?: unknown }>(
    connection,
    "POST",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/sessions`,
    {
      title: input.title,
      prompt: input.prompt,
      providerId: "chatmock",
      modelId: input.model,
      ...(input.variant ? { variant: input.variant } : {}),
    },
  );
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("OpenWork did not return a session.");
  return {
    id,
    title: typeof body.item?.title === "string" ? body.item.title : input.title,
    started: body.started === true,
  };
}

function normalizeMessage(raw: unknown): OpenworkMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as { info?: Record<string, unknown>; parts?: unknown };
  const info = entry.info ?? {};
  const id = typeof info.id === "string" ? info.id : "";
  const role = typeof info.role === "string" ? info.role : "";
  if (!id || !role) return null;
  const parts = Array.isArray(entry.parts)
    ? entry.parts.flatMap((part): OpenworkMessagePart[] => {
        if (!part || typeof part !== "object") return [];
        const value = part as Record<string, unknown>;
        return [
          {
            type: typeof value.type === "string" ? value.type : "unknown",
            ...(typeof value.text === "string" ? { text: value.text } : {}),
            ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
            ...(value.state && typeof value.state === "object"
              ? { state: value.state as OpenworkMessagePart["state"] }
              : {}),
          },
        ];
      })
    : [];
  const tokens = info.tokens as OpenworkMessage["tokens"] | undefined;
  return {
    id,
    role,
    parts,
    ...(info.error === undefined ? {} : { error: info.error }),
    ...(tokens ? { tokens } : {}),
    ...(typeof info.cost === "number" ? { cost: info.cost } : {}),
  };
}

export async function listMessages(
  connection: OpenworkConnection,
  sessionId: string,
): Promise<OpenworkMessage[]> {
  const body = await request<{ items?: unknown[] }>(
    connection,
    "GET",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  return (body.items ?? []).flatMap((item) => normalizeMessage(item) ?? []);
}

export async function abortSession(
  connection: OpenworkConnection,
  sessionId: string,
): Promise<void> {
  await request(
    connection,
    "POST",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/sessions/${encodeURIComponent(sessionId)}/abort`,
    {},
    HEALTH_TIMEOUT_MS,
  );
}

export async function listArtifacts(
  connection: OpenworkConnection,
): Promise<OpenworkArtifact[]> {
  const body = await request<{ items?: OpenworkArtifact[] }>(
    connection,
    "GET",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/artifacts`,
  );
  return (body.items ?? []).filter(
    (item): item is OpenworkArtifact =>
      Boolean(item) && typeof item.id === "string" && typeof item.path === "string",
  );
}

export async function readArtifact(
  connection: OpenworkConnection,
  artifactId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(
    new URL(
      `/workspace/${encodeURIComponent(connection.workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
      connection.serverUrl,
    ),
    {
      headers: { authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new OpenworkApiError(`artifact could not be read (${response.status})`, response.status);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

const HEALTH_TIMEOUT_MS = 8_000;

export async function health(
  serverUrl: string,
): Promise<{ ok: boolean; version?: string; opencodeVersion?: string }> {
  try {
    const response = await fetch(new URL("/health", serverUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false };
    const body = (await response.json()) as { version?: unknown; opencodeVersion?: unknown };
    return {
      ok: true,
      ...(typeof body.version === "string" ? { version: body.version } : {}),
      ...(typeof body.opencodeVersion === "string"
        ? { opencodeVersion: body.opencodeVersion }
        : {}),
    };
  } catch {
    return { ok: false };
  }
}
