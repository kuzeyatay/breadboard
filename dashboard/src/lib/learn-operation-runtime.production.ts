import "server-only";

import {
  handOffDedicatedLearnTask,
  handOffLearnTask,
  type LearnTaskHandoff,
  type LearnWorkerRequest,
} from "@/lib/learn-background";
import { executeLearnOperation } from "@/lib/learn-operation-executor";

export async function executeLearnOperationForRoute<T>(
  request: LearnWorkerRequest,
  label: string,
): Promise<LearnTaskHandoff<T>> {
  const dedicated = await handOffDedicatedLearnTask<T>(request, label);
  if (dedicated) return dedicated;
  return handOffLearnTask(
    (yieldToResponse) =>
      executeLearnOperation(request, yieldToResponse) as Promise<T>,
    label,
  );
}
