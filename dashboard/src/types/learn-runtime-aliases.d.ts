declare module "breadboard-learn-operation-runtime" {
  export function executeLearnOperationForRoute<T>(
    request: import("@/lib/learn-background").LearnWorkerRequest,
    label: string,
  ): Promise<import("@/lib/learn-background").LearnTaskHandoff<T>>;
}

declare module "breadboard-learn-status-runtime" {
  export function getLearnStatusSnapshotForRoute(input: {
    gardenId: string;
    contentPath: string;
  }): Promise<Record<string, unknown>>;
}
