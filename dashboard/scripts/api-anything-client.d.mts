export type ApiAnythingResult = Record<string, unknown> & {
  ok?: boolean;
  approvalRequired?: boolean;
  preview?: Record<string, unknown>;
  fallback?: { recommended: boolean };
};
export interface ApiAnythingOptions {
  userId: number;
  tool: string;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
  repoRoot?: string;
  dataRoot?: string;
  scopeId?: string;
  permissionGranted?: boolean;
  timeoutMs?: number;
}
export function apiAnythingPaths(options?: Partial<ApiAnythingOptions>): { bundle: string; sites: string; worker: string; home: string };
export function apiAnythingAvailable(options?: Partial<ApiAnythingOptions>): boolean;
export function callApiAnythingTool(options: ApiAnythingOptions): Promise<ApiAnythingResult>;
export function callApiAnythingAgentTool(options: Omit<ApiAnythingOptions, "tool" | "args"> & { input: Record<string, unknown> }): Promise<ApiAnythingResult>;
