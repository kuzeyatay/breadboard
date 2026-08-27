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
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;

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
  options: { timeoutMs?: number; signal?: AbortSignal; maximumBytes?: number } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const response = await fetch(new URL(pathname, connection.serverUrl), {
    method,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  const maximumBytes = response.ok
    ? options.maximumBytes ?? MAX_JSON_RESPONSE_BYTES
    : MAX_ERROR_BYTES;
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new OpenworkApiError("response exceeded its bound", 502);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new OpenworkApiError("response exceeded its bound", 502);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  ).toString("utf8");
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
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new OpenworkApiError("OpenWork returned invalid JSON.", 502);
  }
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
  signal?: AbortSignal,
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
    { signal, maximumBytes: 256 * 1024 },
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
  signal?: AbortSignal,
): Promise<OpenworkMessage[]> {
  const body = await request<{ items?: unknown[] }>(
    connection,
    "GET",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
    undefined,
    { signal, maximumBytes: MAX_JSON_RESPONSE_BYTES },
  );
  return (body.items ?? []).flatMap((item) => normalizeMessage(item) ?? []);
}

export async function abortSession(
  connection: OpenworkConnection,
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    connection,
    "POST",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/sessions/${encodeURIComponent(sessionId)}/abort`,
    {},
    { timeoutMs: HEALTH_TIMEOUT_MS, signal, maximumBytes: 64 * 1024 },
  );
}

export async function listArtifacts(
  connection: OpenworkConnection,
  signal?: AbortSignal,
): Promise<OpenworkArtifact[]> {
  const body = await request<{ items?: OpenworkArtifact[] }>(
    connection,
    "GET",
    `/workspace/${encodeURIComponent(connection.workspaceId)}/artifacts`,
    undefined,
    { signal, maximumBytes: MAX_JSON_RESPONSE_BYTES },
  );
  return (body.items ?? []).filter(
    (item): item is OpenworkArtifact =>
      Boolean(item) && typeof item.id === "string" && typeof item.path === "string",
  );
}

export async function openArtifact(
  connection: OpenworkConnection,
  artifactId: string,
  options: { signal?: AbortSignal; maximumBytes: number },
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  declaredSize: number | null;
}> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(
    new URL(
      `/workspace/${encodeURIComponent(connection.workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
      connection.serverUrl,
    ),
    {
      headers: { authorization: `Bearer ${connection.token}` },
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new OpenworkApiError(`artifact could not be read (${response.status})`, response.status);
  }
  const declared = response.headers.get("content-length");
  const declaredSize = declared !== null && /^\d+$/u.test(declared) ? Number(declared) : null;
  if (
    !response.body ||
    (declared !== null && declaredSize === null) ||
    (declaredSize !== null && declaredSize > options.maximumBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new OpenworkApiError("artifact exceeded its bound", 502);
  }
  return {
    stream: response.body,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    declaredSize,
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
