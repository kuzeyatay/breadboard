// A small client for ComfyUI's HTTP API.
//
// Only the four things a picture needs: what the server can do, submit a graph,
// wait for it to finish, fetch the bytes. Everything is plain `fetch` against
// the routes in `comfyui/server.py`, so an install the user runs themselves is
// as usable as the vendored one.
//
// Deliberately not the websocket: progress is nice, but a socket that has to be
// held open across a Next route handler for the length of a render is a second
// failure mode for no extra capability. Polling `/history/{id}` is what the
// server itself treats as the durable record of a finished job.

export class ComfyUiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ComfyUiError";
    this.status = status;
    this.code = code;
  }
}

/** One image ComfyUI saved, addressed the way `/view` wants it. */
export interface ComfyUiImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

/** A node graph in ComfyUI's "API format": node id → class and inputs. */
export type ComfyUiPrompt = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export interface ComfyUiCapabilities {
  checkpoints: string[];
  samplers: string[];
  schedulers: string[];
  /** e.g. "cuda" / "cpu" / "mps", straight from `/system_stats`. */
  device: string | null;
  version: string | null;
}

const REQUEST_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 1_500;

async function request(
  baseUrl: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, { ...rest, signal: controller.signal });
  } catch (cause) {
    throw new ComfyUiError(
      503,
      "comfyui_unreachable",
      cause instanceof Error && cause.name === "AbortError"
        ? `ComfyUI did not answer ${path} in time.`
        : `ComfyUI is not reachable at ${baseUrl}.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ComfyUiError(
      response.status,
      "comfyui_request_failed",
      text.slice(0, 400) || `ComfyUI returned ${response.status} for ${what}.`,
    );
  }
  return (await response.json()) as T;
}

/** True when something is answering at `baseUrl`. Never throws. */
export async function comfyUiReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await request(baseUrl, "/system_stats", { timeoutMs: 4_000 });
    return response.ok;
  } catch {
    return false;
  }
}

function optionList(info: unknown, node: string, field: string): string[] {
  const record = info as Record<string, unknown> | null;
  const nodeInfo = record?.[node] as Record<string, unknown> | undefined;
  const input = nodeInfo?.input as Record<string, unknown> | undefined;
  const required = input?.required as Record<string, unknown> | undefined;
  const entry = required?.[field];
  // ComfyUI describes a combo widget as `[[...options], {…}]`, so the options
  // are the first element of the first element — not the field itself.
  const options = Array.isArray(entry) ? entry[0] : null;
  if (!Array.isArray(options)) return [];
  return options.filter((option): option is string => typeof option === "string");
}

/**
 * What this ComfyUI can actually do right now.
 *
 * The lists come from `/object_info`, which reports the live contents of the
 * models directory — so an empty `checkpoints` is the honest answer "you have
 * not put a model in yet", not a failure to ask.
 */
export async function comfyUiCapabilities(baseUrl: string): Promise<ComfyUiCapabilities> {
  const [checkpointInfo, samplerInfo, stats] = await Promise.all([
    request(baseUrl, "/object_info/CheckpointLoaderSimple").then((response) =>
      json<unknown>(response, "the checkpoint list"),
    ),
    request(baseUrl, "/object_info/KSampler").then((response) =>
      json<unknown>(response, "the sampler list"),
    ),
    request(baseUrl, "/system_stats")
      .then((response) => json<Record<string, unknown>>(response, "system stats"))
      .catch(() => null),
  ]);

  const system = stats?.system as Record<string, unknown> | undefined;
  const devices = stats?.devices as Array<Record<string, unknown>> | undefined;
  return {
    checkpoints: optionList(checkpointInfo, "CheckpointLoaderSimple", "ckpt_name"),
    samplers: optionList(samplerInfo, "KSampler", "sampler_name"),
    schedulers: optionList(samplerInfo, "KSampler", "scheduler"),
    device: typeof devices?.[0]?.type === "string" ? (devices[0].type as string) : null,
    version: typeof system?.comfyui_version === "string" ? system.comfyui_version : null,
  };
}

/** Queue a graph. Returns the id the history is keyed by. */
export async function queueComfyUiPrompt(
  baseUrl: string,
  prompt: ComfyUiPrompt,
  clientId: string,
): Promise<string> {
  const response = await request(baseUrl, "/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId }),
  });
  if (response.status === 400) {
    // A rejected graph names the node and the reason; that is far more useful
    // than "bad request", because it is usually a model that has been removed.
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: unknown; details?: unknown };
    };
    const message = [body.error?.message, body.error?.details]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" — ");
    throw new ComfyUiError(
      422,
      "comfyui_prompt_rejected",
      message || "ComfyUI rejected the workflow.",
    );
  }
  const body = await json<{ prompt_id?: unknown }>(response, "the queued prompt");
  if (typeof body.prompt_id !== "string" || !body.prompt_id) {
    throw new ComfyUiError(502, "comfyui_prompt_id_missing", "ComfyUI did not return a job id.");
  }
  return body.prompt_id;
}

interface HistoryEntry {
  status?: { completed?: unknown; status_str?: unknown; messages?: unknown };
  outputs?: Record<string, { images?: Array<Partial<ComfyUiImageRef>> }>;
}

function imagesFrom(entry: HistoryEntry): ComfyUiImageRef[] {
  const found: ComfyUiImageRef[] = [];
  for (const output of Object.values(entry.outputs ?? {})) {
    for (const image of output.images ?? []) {
      if (typeof image.filename !== "string" || !image.filename) continue;
      found.push({
        filename: image.filename,
        subfolder: typeof image.subfolder === "string" ? image.subfolder : "",
        type: typeof image.type === "string" ? image.type : "output",
      });
    }
  }
  return found;
}

/** The first line of a ComfyUI execution error, which is the one worth showing. */
function failureReason(entry: HistoryEntry): string {
  const messages = Array.isArray(entry.status?.messages) ? entry.status.messages : [];
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue;
    const detail = message[1] as Record<string, unknown> | undefined;
    const text = detail?.exception_message;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "ComfyUI could not finish the workflow.";
}

/**
 * Wait for a queued job and answer with the images it saved.
 *
 * A job that vanishes from both the queue and the history is treated as failed
 * rather than waited on forever: that is what a server restart mid-render looks
 * like from out here.
 */
export async function awaitComfyUiImages(
  baseUrl: string,
  promptId: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ComfyUiImageRef[]> {
  const deadline = Date.now() + options.timeoutMs;
  let seenQueued = false;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new ComfyUiError(499, "comfyui_generation_cancelled", "The render was cancelled.");
    }
    const history = await request(baseUrl, `/history/${encodeURIComponent(promptId)}`).then(
      (response) => json<Record<string, HistoryEntry>>(response, "the job history"),
    );
    const entry = history[promptId];
    if (entry) {
      const done = entry.status?.completed === true || entry.status?.status_str === "success";
      const failed = entry.status?.status_str === "error";
      if (failed) throw new ComfyUiError(502, "comfyui_execution_failed", failureReason(entry));
      if (done) {
        const images = imagesFrom(entry);
        if (!images.length) {
          throw new ComfyUiError(
            502,
            "comfyui_no_image",
            "The workflow finished without saving an image.",
          );
        }
        return images;
      }
    }

    const queue = await request(baseUrl, "/queue")
      .then((response) =>
        json<{ queue_running?: unknown[]; queue_pending?: unknown[] }>(response, "the queue"),
      )
      .catch(() => null);
    if (queue) {
      const waiting = JSON.stringify([queue.queue_running ?? [], queue.queue_pending ?? []]);
      if (waiting.includes(promptId)) seenQueued = true;
      else if (seenQueued && !entry) {
        throw new ComfyUiError(
          502,
          "comfyui_job_lost",
          "ComfyUI dropped the job before it produced an image.",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new ComfyUiError(
    504,
    "comfyui_generation_timeout",
    "ComfyUI did not finish the image in time.",
  );
}

/** Download one saved image. */
export async function readComfyUiImage(
  baseUrl: string,
  image: ComfyUiImageRef,
  timeoutMs = 60_000,
): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const response = await request(baseUrl, `/view?${query.toString()}`, { timeoutMs });
  if (!response.ok) {
    throw new ComfyUiError(
      response.status,
      "comfyui_image_unreadable",
      "ComfyUI would not return the image it just made.",
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
