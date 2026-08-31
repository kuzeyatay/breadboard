// Typed access to the OpenMAIC server this integration stands on.
//
// Three routes, all read from the clone's `app/api/`:
//   POST /api/generate-classroom          → 202 { jobId, pollUrl, pollIntervalMs }
//   GET  /api/generate-classroom/[jobId]  → the job's step, progress, and result
//   GET  /api/classroom?id=               → the persisted classroom (stage + scenes)
// plus GET /api/health, which is what "ready" means for the service.
//
// Every response is unwrapped from OpenMAIC's `{ success, data }` envelope here,
// so the run manager reads plain objects and the envelope is one fact in one
// place. `tests/classroom-agent.test.mjs` reads the clone and asserts these
// routes and fields still exist.

const REQUEST_TIMEOUT_MS = 30_000;

export interface ClassroomJobRequest {
  requirement: string;
  pdfContent?: { text: string; images: string[] };
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  enableTTS?: boolean;
  agentMode?: "default" | "generate";
}

export interface ClassroomJobStart {
  jobId: string;
  pollIntervalMs: number;
}

export interface ClassroomJobSnapshot {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  step: string;
  progress: number;
  message: string;
  scenesGenerated: number;
  totalScenes: number | null;
  result: { classroomId: string; url: string; scenesCount: number } | null;
  error: string | null;
  done: boolean;
}

export interface ClassroomDocument {
  id: string;
  stage: Record<string, unknown>;
  scenes: unknown[];
  createdAt: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function envelope(response: Response): Promise<Record<string, unknown>> {
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok || body.success === false) {
    const message =
      text(body.error) ||
      text(record(body.error).message) ||
      `OpenMAIC answered ${response.status}.`;
    throw new Error(message);
  }
  // Successful answers are { success: true, ...fields } — the fields sit
  // beside the flag, not under a `data` key.
  return body;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export async function health(baseUrl: string): Promise<{ version: string }> {
  const data = await envelope(await request(`${baseUrl}/api/health`, { cache: "no-store" }));
  return { version: text(data.version) };
}

export async function startClassroomJob(
  baseUrl: string,
  body: ClassroomJobRequest,
): Promise<ClassroomJobStart> {
  const data = await envelope(
    await request(`${baseUrl}/api/generate-classroom`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const jobId = text(data.jobId);
  if (!jobId) throw new Error("OpenMAIC did not return a generation job id.");
  const pollIntervalMs = count(data.pollIntervalMs);
  return { jobId, pollIntervalMs: pollIntervalMs > 0 ? pollIntervalMs : 5_000 };
}

export async function readClassroomJob(
  baseUrl: string,
  jobId: string,
): Promise<ClassroomJobSnapshot> {
  const data = await envelope(
    await request(`${baseUrl}/api/generate-classroom/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    }),
  );
  const status = text(data.status);
  const result = record(data.result);
  return {
    jobId: text(data.jobId, jobId),
    status:
      status === "queued" || status === "running" || status === "succeeded" || status === "failed"
        ? status
        : "running",
    step: text(data.step),
    progress: count(data.progress),
    message: text(data.message),
    scenesGenerated: count(data.scenesGenerated),
    totalScenes: typeof data.totalScenes === "number" ? data.totalScenes : null,
    result: text(result.classroomId)
      ? {
          classroomId: text(result.classroomId),
          url: text(result.url),
          scenesCount: count(result.scenesCount),
        }
      : null,
    error: text(data.error) || null,
    done: data.done === true || status === "succeeded" || status === "failed",
  };
}

export async function readClassroom(
  baseUrl: string,
  classroomId: string,
): Promise<ClassroomDocument> {
  // This one route wraps its answer once more: { success, classroom: {...} }.
  const data = record(
    (
      await envelope(
        await request(`${baseUrl}/api/classroom?id=${encodeURIComponent(classroomId)}`, {
          cache: "no-store",
        }),
      )
    ).classroom,
  );
  return {
    id: text(data.id, classroomId),
    stage: record(data.stage),
    scenes: Array.isArray(data.scenes) ? data.scenes : [],
    createdAt: text(data.createdAt),
  };
}
