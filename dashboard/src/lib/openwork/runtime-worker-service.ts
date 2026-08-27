// Endpoint-only access for one disposable OpenWork coordinator.
//
// Rust has already admitted service:openwork before this code runs. The worker
// receives only its authenticated loopback endpoint, then names the immutable
// profile the trusted dashboard wrote before submission. It has no provider
// secret, service lease, stop operation, supervisor capability, or spawn path.

export interface OpenworkWorkerScope {
  readonly userId: number;
  readonly runId: string;
}

export interface OpenworkWorkerService {
  readonly engineUrl: string;
  readonly serverUrl: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly startedAt: number;
  readonly models: readonly string[];
}

const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_RESPONSE_BYTES = 256 * 1024;
const READY_TIMEOUT_MS = 5 * 60_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function endpoint(env: NodeJS.ProcessEnv = process.env): { origin: string; token: string } {
  const raw = env.BREADBOARD_OPENWORK_SERVICE_URL?.trim() ?? "";
  const token = env.BREADBOARD_OPENWORK_SERVICE_TOKEN?.trim() ?? "";
  const tokenBytes = Buffer.byteLength(token, "utf8");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("The Runtime-injected OpenWork capability is unavailable.");
  }
  if (
    tokenBytes < 32 ||
    tokenBytes > 1_024 ||
    !/^[\x21-\x7e]+$/u.test(token) ||
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("The Runtime-injected OpenWork capability is unavailable.");
  }
  return { origin: parsed.origin, token };
}

function loopbackOrigin(value: unknown, label: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 2_048) {
    throw new Error(`The prepared OpenWork ${label} is invalid.`);
  }
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["", "/"].includes(parsed.pathname)
  ) {
    throw new Error(`The prepared OpenWork ${label} is invalid.`);
  }
  return parsed.origin;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The OpenWork service response exceeded its bound.");
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The OpenWork service response exceeded its bound.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"),
    );
  } catch {
    throw new Error("The OpenWork service returned invalid JSON.");
  }
}

export async function preparedOpenworkService(
  scope: OpenworkWorkerScope,
  signal?: AbortSignal,
): Promise<OpenworkWorkerService> {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !SCOPE_ID.test(scope.runId)
  ) {
    throw new Error("The OpenWork Runtime worker scope is invalid.");
  }
  const target = endpoint();
  const timeout = AbortSignal.timeout(READY_TIMEOUT_MS);
  const response = await fetch(new URL("/v1/ensure", target.origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    // This exact shape is intentional: provider configuration never crosses
    // from the Runtime service into the disposable coordinator.
    body: JSON.stringify({ scope }),
    cache: "no-store",
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const envelope = record(await boundedJson(response));
  const result = record(envelope.result);
  if (!response.ok || envelope.ok !== true) {
    const error = record(envelope.error);
    throw new Error(
      typeof error.message === "string"
        ? error.message.slice(0, 2_000)
        : `The OpenWork service could not be prepared (${response.status}).`,
    );
  }
  const workspaceId = typeof result.workspaceId === "string" ? result.workspaceId : "";
  const workspacePath = typeof result.workspacePath === "string" ? result.workspacePath : "";
  const token = typeof result.token === "string" ? result.token : "";
  const models = Array.isArray(result.models)
    ? result.models.filter(
        (model): model is string =>
          typeof model === "string" &&
          model.length > 0 &&
          Buffer.byteLength(model, "utf8") <= 256 &&
          !/\p{Cc}/u.test(model),
      ).slice(0, 256)
    : [];
  if (
    !/^[A-Za-z0-9._:-]{1,256}$/u.test(workspaceId) ||
    !pathIsAbsolute(workspacePath) ||
    Buffer.byteLength(workspacePath, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(workspacePath) ||
    Buffer.byteLength(token, "utf8") < 16 ||
    Buffer.byteLength(token, "utf8") > 1_024 ||
    !Number.isFinite(result.startedAt) ||
    !models.length
  ) {
    throw new Error("The prepared OpenWork service projection is invalid.");
  }
  return {
    engineUrl: loopbackOrigin(result.engineUrl, "engine endpoint"),
    serverUrl: loopbackOrigin(result.serverUrl, "server endpoint"),
    token,
    workspaceId,
    workspacePath,
    startedAt: Number(result.startedAt),
    models,
  };
}

function pathIsAbsolute(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/)/u.test(value);
}
