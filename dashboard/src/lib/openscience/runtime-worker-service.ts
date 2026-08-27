// Endpoint-only service access for one disposable OpenScience worker.
//
// Rust has already admitted and retained service:openscience before this code
// runs. The worker receives only that service's loopback URL and bearer. It has
// no supervisor token, provider credential, lease operation, stop operation,
// or process-launch fallback.

export interface OpenscienceWorkerScope {
  readonly userId: number;
  readonly runId: string;
  readonly conversationPublicId?: string;
}

export interface OpenscienceWorkerService {
  readonly baseUrl: string;
  readonly workspacePath: string;
  readonly startedAt: number;
  readonly models: readonly string[];
}

const MAX_RESPONSE_BYTES = 256 * 1024;
const SERVICE_READY_TIMEOUT_MS = 5 * 60_000;

function endpoint(env: NodeJS.ProcessEnv = process.env): { origin: string; token: string } {
  const raw = env.BREADBOARD_OPENSCIENCE_SERVICE_URL?.trim() ?? "";
  const token = env.BREADBOARD_OPENSCIENCE_SERVICE_TOKEN?.trim() ?? "";
  const tokenBytes = Buffer.byteLength(token, "utf8");
  if (
    tokenBytes < 32 ||
    tokenBytes > 1_024 ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) {
    throw new Error("The Runtime-injected OpenScience capability is unavailable.");
  }
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("The Runtime-injected OpenScience endpoint is invalid.");
  }
  return { origin: parsed.origin, token };
}

function validateScope(scope: OpenscienceWorkerScope): void {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(scope.runId) ||
    (
      scope.conversationPublicId !== undefined &&
      !/^conv_[A-Za-z0-9_-]{24}$/u.test(scope.conversationPublicId)
    )
  ) {
    throw new Error("The OpenScience Runtime worker scope is invalid.");
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The OpenScience service response exceeded its bound.");
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
      throw new Error("The OpenScience service response exceeded its bound.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"),
    );
  } catch {
    throw new Error("The OpenScience service returned invalid JSON.");
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function loopbackOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("The prepared OpenScience endpoint is invalid.");
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
    throw new Error("The prepared OpenScience endpoint is invalid.");
  }
  return parsed.origin;
}

/** Resolve the already-prepared inner service through the job-held dependency. */
export async function preparedService(
  scope: OpenscienceWorkerScope,
): Promise<OpenscienceWorkerService> {
  validateScope(scope);
  const target = endpoint();
  const response = await fetch(new URL("/v1/ensure", target.origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ scope }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(SERVICE_READY_TIMEOUT_MS),
  });
  const envelope = record(await boundedJson(response));
  const result = record(envelope.result);
  if (!response.ok || envelope.ok !== true) {
    const error = record(envelope.error);
    throw new Error(
      typeof error.message === "string"
        ? error.message.slice(0, 2_000)
        : `The OpenScience service could not be prepared (${response.status}).`,
    );
  }
  const workspacePath =
    typeof result.workspacePath === "string" ? result.workspacePath.trim() : "";
  const models = Array.isArray(result.models)
    ? result.models.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0 && value.length <= 256,
      ).slice(0, 256)
    : [];
  if (
    !workspacePath ||
    workspacePath.length > 4_096 ||
    !/^(?:[A-Za-z]:[\\/]|\/)/u.test(workspacePath) ||
    !Number.isFinite(result.startedAt) ||
    !models.length
  ) {
    throw new Error("The prepared OpenScience service projection is invalid.");
  }
  return {
    baseUrl: loopbackOrigin(result.baseUrl),
    workspacePath,
    startedAt: Number(result.startedAt),
    models,
  };
}
