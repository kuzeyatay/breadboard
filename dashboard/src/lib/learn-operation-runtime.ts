import type {
  LearnTaskHandoff,
  LearnWorkerRequest,
} from "@/lib/learn-background";

/** TypeScript-visible contract replaced by next.config.ts at compile time. */
export async function executeLearnOperationForRoute<T>(
  _request: LearnWorkerRequest,
  _label: string,
): Promise<LearnTaskHandoff<T>> {
  throw new Error("The Learn operation runtime alias is not configured.");
}
