import "server-only";

import {
  handOffDedicatedLearnTask,
  type LearnTaskHandoff,
  type LearnWorkerRequest,
} from "@/lib/learn-background";

export async function executeLearnOperationForRoute<T>(
  request: LearnWorkerRequest,
  label: string,
): Promise<LearnTaskHandoff<T>> {
  const execution = await handOffDedicatedLearnTask<T>(request, label);
  if (!execution) {
    throw new Error(
      "The development Learn operation runtime refused its dedicated worker path.",
    );
  }
  return execution;
}
