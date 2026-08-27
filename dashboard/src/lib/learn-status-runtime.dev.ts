import "server-only";

import { mergeRuntimeV2LearnStatus } from "@/lib/learn-operation-runtime-v2";
import { getLearnStatusSnapshot } from "@/lib/learn-status-projection";

export async function getLearnStatusSnapshotForRoute(input: {
  userId: number;
  gardenId: string;
  contentPath: string;
}): Promise<Record<string, unknown>> {
  const snapshot = getLearnStatusSnapshot(input) as unknown as Record<
    string,
    unknown
  >;
  return mergeRuntimeV2LearnStatus(input, snapshot);
}
