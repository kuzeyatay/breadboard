import { createHmac, timingSafeEqual } from "node:crypto";

const RECOVERY_PATH = "/api/internal/task-recovery";
const OPERATION = "breadboard:task-recovery:v1";

function bearer(env: NodeJS.ProcessEnv): string {
  const secret = env.BREADBOARD_HERMES_TOOL_SECRET?.trim() || env.HERMES_TOOL_SECRET?.trim();
  if (!secret) throw new Error("Task recovery service authentication is unavailable.");
  return createHmac("sha256", secret).update(OPERATION).digest("hex");
}

function localUrl(raw: string, normalizedRequest = false): URL {
  const url = new URL(raw);
  // Next normalizes incoming loopback IPs to localhost. Outbound calls still
  // require a literal loopback address and never resolve a hostname.
  const local = ["127.0.0.1", "[::1]"].includes(url.hostname) || (normalizedRequest && url.hostname === "localhost");
  if (url.protocol !== "http:" || !local || url.username || url.password) {
    throw new Error("Task recovery requires the local dashboard.");
  }
  return url;
}

export interface RecoverySweepResult { version: 1; resumed: number; reconciled: number }

async function hasEmptyBody(request: Request): Promise<boolean> {
  const length = request.headers.get("content-length");
  if (length !== null && length !== "0") return false;
  if (!request.body) return true;
  // Next's Node adapter supplies a stream even for Content-Length: 0. Read
  // only its first item, with a bound, rather than treating the stream as data.
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read().then(result => result.done === true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2_000); }),
    ]);
  } catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}

/** The native scheduler retains ownership; this worker gets no job-control bearer. */
export async function requestRecoveryHandoff(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch): Promise<RecoverySweepResult> {
  const url = localUrl(env.BREADBOARD_INTERNAL_URL ?? "");
  const response = await transport(new URL(RECOVERY_PATH, url), {
    method: "POST", headers: { authorization: `Bearer ${bearer(env)}` },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Task recovery handoff failed (${response.status}).`);
  const value = await response.json();
  if (!value || value.version !== 1 || Object.keys(value).sort().join(",") !== "reconciled,resumed,version" ||
      !Number.isSafeInteger(value.resumed) || value.resumed < 0 || !Number.isSafeInteger(value.reconciled) || value.reconciled < 0) {
    throw new Error("Task recovery returned an invalid receipt.");
  }
  return value;
}

/** A closed, authenticated nudge: no request can choose a job, user, path or command. */
export function createRecoveryHandoffHandler(sweep: () => Promise<RecoverySweepResult>, env: NodeJS.ProcessEnv = process.env) {
  let pending: Promise<RecoverySweepResult> | undefined;
  return async (request: Request): Promise<Response> => {
    let expected: string;
    try { expected = `Bearer ${bearer(env)}`; } catch { return new Response(null, { status: 503 }); }
    const supplied = request.headers.get("authorization") ?? "";
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return new Response(null, { status: 401 });
    }
    let url: URL;
    try { url = localUrl(request.url, true); } catch { return new Response(null, { status: 400 }); }
    if (request.method !== "POST" || url.pathname !== RECOVERY_PATH || url.search || request.headers.has("origin") || !(await hasEmptyBody(request))) {
      return new Response(null, { status: 400 });
    }
    try {
      const work = pending ??= Promise.resolve().then(sweep);
      try { return Response.json(await work, { headers: { "cache-control": "no-store" } }); }
      finally { if (pending === work) pending = undefined; }
    } catch { return new Response(null, { status: 503 }); }
  };
}
