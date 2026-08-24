import "server-only";

import { getLearnStatusSnapshot } from "@/lib/learn";

export async function getLearnStatusSnapshotForRoute(input: {
  gardenId: string;
  contentPath: string;
}): Promise<Record<string, unknown>> {
  return getLearnStatusSnapshot(input) as unknown as Record<string, unknown>;
}
