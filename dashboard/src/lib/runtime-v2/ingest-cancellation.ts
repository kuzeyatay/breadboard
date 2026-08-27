if (typeof window !== "undefined") {
  throw new Error("Runtime V2 ingestion cancellation is server-only.");
}

import type { RuntimeJobSnapshot } from "@/lib/supervisor-control";

export type RuntimeIngestCancellationDisposition = {
  readonly jobId: string;
  readonly state: RuntimeJobSnapshot["state"];
  readonly accepted: boolean;
};

export function runtimeIngestCancellationDisposition(
  job: RuntimeJobSnapshot,
): RuntimeIngestCancellationDisposition {
  return {
    jobId: job.jobId,
    state: job.state,
    accepted:
      job.cancellationRequested ||
      job.state === "cancelling" ||
      job.state === "cancelled",
  };
}
