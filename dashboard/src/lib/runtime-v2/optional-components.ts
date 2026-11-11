import "server-only";
import {
  inspectRuntimeJob,
  readSupervisedServiceSnapshots,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
  type SupervisedServiceId,
} from "../supervisor-control.ts";
import {
  ManagedSetupExecutionError,
  readManagedSetupResult,
  submitManagedSetupJob,
} from "./managed-setup-job.ts";

/**
 * Components the installer deliberately leaves out. Each one would push the
 * NSIS package past its 2 GiB packed limit, so installed Breadboard builds or
 * downloads it here on request through the Runtime's managed-setup job, pinned
 * to the same versions development staging uses
 * (dashboard/scripts/runtime-v2-managed-setup-executor.mjs).
 */
export const OPTIONAL_COMPONENTS = Object.freeze([
  {
    id: "vlm-ocr",
    name: "Local OCR model",
    detail: "HunyuanOCR weights behind “Parse using VLM”. 1.3 GB download.",
  },
  {
    id: "colpali",
    name: "Visual document search",
    detail: "ColPali Python environment with PyTorch. About 1.4 GB.",
  },
  {
    id: "humanizer",
    name: "Natural rewriting",
    detail: "Humanizer Python environment with PyTorch. About 1.3 GB.",
  },
  {
    id: "cad",
    name: "Parametric CAD",
    detail: "CadQuery Python environment. About 700 MB.",
  },
  {
    id: "voicebox",
    name: "Voicebox speech server",
    detail: "Local text-to-speech server. 675 MB download.",
  },
] as const);

export type OptionalComponentId = (typeof OPTIONAL_COMPONENTS)[number]["id"];
export type OptionalComponentAction = "install" | "remove";

const IDS = new Set<string>(OPTIONAL_COMPONENTS.map((component) => component.id));

export function isOptionalComponentId(value: unknown): value is OptionalComponentId {
  return typeof value === "string" && IDS.has(value);
}

export interface OptionalComponentState {
  id: OptionalComponentId;
  name: string;
  detail: string;
  /** null when the Runtime is not reachable, so nothing can be claimed. */
  installed: boolean | null;
}

export async function readOptionalComponentStates(): Promise<OptionalComponentState[]> {
  const ids = OPTIONAL_COMPONENTS.map((component) => component.id as SupervisedServiceId);
  const snapshots = await readSupervisedServiceSnapshots(ids).catch(() => null);
  const states = new Map(snapshots?.map((snapshot) => [snapshot.id, snapshot.state]) ?? []);
  return OPTIONAL_COMPONENTS.map((component) => {
    const state = states.get(component.id as SupervisedServiceId);
    return {
      id: component.id,
      name: component.name,
      detail: component.detail,
      installed: state === undefined ? null : state !== "installation-unavailable",
    };
  });
}

function authority(userId: number): RuntimeJobAuthority {
  return { userId, gardenId: null, conversationId: null };
}

/** Hand the install or removal to the Runtime and return once it owns the job. */
export async function startOptionalComponentJob(
  userId: number,
  id: OptionalComponentId,
  action: OptionalComponentAction,
  signal?: AbortSignal,
): Promise<string> {
  const snapshot = await submitManagedSetupJob({ userId, serviceId: id, action, signal });
  return snapshot.jobId;
}

export interface OptionalComponentJobStatus {
  jobId: string;
  state: RuntimeJobSnapshot["state"];
  done: boolean;
  ok: boolean | null;
  message: string;
}

const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export async function inspectOptionalComponentJob(
  userId: number,
  jobId: string,
): Promise<OptionalComponentJobStatus> {
  const job = await inspectRuntimeJob(authority(userId), jobId);
  if (job.jobType !== "managed-setup") throw new Error("Not an optional component job.");
  if (!TERMINAL.has(job.state)) {
    return { jobId, state: job.state, done: false, ok: null, message: "Working…" };
  }
  if (job.state !== "succeeded") {
    return {
      jobId,
      state: job.state,
      done: true,
      ok: false,
      message: job.failureMessage ?? (job.state === "cancelled" ? "Cancelled." : "Setup failed."),
    };
  }
  try {
    const result = await readManagedSetupResult(userId, job);
    return { jobId, state: job.state, done: true, ok: result.ok, message: result.message };
  } catch (error) {
    if (error instanceof ManagedSetupExecutionError) {
      return { jobId, state: job.state, done: true, ok: false, message: error.message };
    }
    throw error;
  }
}
