if (typeof window !== "undefined") {
  throw new Error("Runtime V2 ingestion job validation is server-only.");
}

import type { RuntimeJobSnapshot } from "@/lib/supervisor-control";

export function isRuntimeDocumentIngestionJob(
  job: RuntimeJobSnapshot,
): boolean {
  return (
    job.jobType === "document-ingestion" &&
    job.workerKind === "document-ingestion-node" &&
    job.resourceClass === "document-processing" &&
    job.gardenId !== null &&
    job.conversationId === null
  );
}
