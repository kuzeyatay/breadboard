export interface SolidWorksToolResult {
  data: Record<string, unknown>;
  text: string;
  isError: boolean;
  raw: Record<string, unknown>;
}

export interface SolidWorksBridgeStatus {
  running: boolean;
  ownsSolidWorks: boolean;
  startedAt: string | null;
  toolCount: number;
  log: string;
}

export interface SolidWorksBridgeLike {
  ensureStarted(env?: NodeJS.ProcessEnv): Promise<void>;
  attachedToExistingSession(): boolean;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
  ): Promise<SolidWorksToolResult>;
  listTools?(options?: { env?: NodeJS.ProcessEnv }): Promise<number>;
}
