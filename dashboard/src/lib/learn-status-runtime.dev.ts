import "server-only";

import { getIsolatedLearnStatusSnapshot } from "@/lib/learn-status-client";

export async function getLearnStatusSnapshotForRoute(input: {
  gardenId: string;
  contentPath: string;
}): Promise<Record<string, unknown>> {
  const snapshot = await getIsolatedLearnStatusSnapshot(input);
  if (!snapshot) {
    throw new Error(
      "The development Learn status runtime refused its isolated worker path.",
    );
  }
  return snapshot;
}
