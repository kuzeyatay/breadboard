import "server-only";

import { mergeRuntimeV2LearnStatus } from "@/lib/learn-operation-runtime-v2";
import { getLearnStatusSnapshotAsync } from "@/lib/learn-status-projection";

export async function getLearnStatusSnapshotForRoute(input: {
  userId: number;
  gardenId: string;
  contentPath: string;
}): Promise<Record<string, unknown>> {
  const snapshot = await getLearnStatusSnapshotAsync(input) as unknown as Record<
    string,
    unknown
  >;
  return mergeRuntimeV2LearnStatus(input, snapshot);
}
