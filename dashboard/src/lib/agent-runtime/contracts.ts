import type { ChatAttachment } from "../chat-attachments.ts";
import type { CapabilityDecision } from "../openharness/capability-policy.ts";
import type { FilesystemAccessMode } from "../openharness/runtime-store.ts";
import type { NormalizedAgentEvent } from "../openharness/events.ts";

export const RUNTIME_KINDS = ["openharness", "hermes"] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

export const RUNTIME_SURFACES = [
  "dashboard_terminal",
  "garden_chat",
  "quartz_ai",
] as const;
export type RuntimeSurface = (typeof RUNTIME_SURFACES)[number];

export interface RuntimeHealth {
  healthy: boolean;
  version: string;
}

export interface RuntimeAgent {
  name: string;
  mode?: string;
  description?: string;
}

export interface RuntimeModel {
  id: string;
  name: string;
  providerId: string;
  variants?: Record<string, unknown>;
}

export interface RuntimeCapabilities {
  tools: string[];
  mcp: Record<string, RuntimeMcpStatus>;
}

export type RuntimeMcpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error?: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration" };

export interface CreateRuntimeSessionInput {
  surface: RuntimeSurface;
  sessionKey: string;
  conversationKey?: string;
  gardenKey?: string;
  pageKey?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  filesystemMode: FilesystemAccessMode;
  previousDirectory?: string | null;
  authenticated?: boolean;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  reasoningEffort?: string;
}

export interface RuntimeSession {
  /** Runtime-owned durable identifier. Never returned directly to the browser. */
  externalSessionId: string;
  /** Optional live/transport identifier. It is disposable and non-canonical. */
  liveSessionId?: string;
  directory: string;
  runtimeDirectory: string;
  workspaceKey: string;
  agentName: string;
  metadata?: Record<string, unknown>;
}

export interface RestoreRuntimeSessionInput
  extends CreateRuntimeSessionInput {
  externalSessionId: string;
}

export interface StartRuntimeRunInput {
  externalSessionId: string;
  liveSessionId?: string;
  workspaceKey: string;
  directory?: string;
  agentName: string;
  text: string;
  attachments?: ChatAttachment[];
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  tools?: Record<string, boolean>;
  messageId?: string;
}

export interface ResolveRuntimeApprovalInput {
  externalSessionId: string;
  liveSessionId?: string;
  workspaceKey: string;
  directory?: string;
  requestId: string;
  decision: "once" | "always" | "reject";
}

export interface RuntimeSessionReference {
  externalSessionId: string;
  liveSessionId?: string;
  workspaceKey: string;
  directory?: string;
}

/**
 * Server-only runtime boundary. Existing `/api/openharness/*` routes remain
 * compatibility endpoints and call this interface; renderers never receive a
 * runtime URL, credential, or provider session id.
 */
export interface AgentRuntime {
  readonly kind: RuntimeKind;
  readonly enabled: boolean;

  health(): Promise<RuntimeHealth>;
  listAgents(surface?: RuntimeSurface): Promise<RuntimeAgent[]>;
  listModels(): Promise<RuntimeModel[]>;
  listCapabilities(
    directory?: string,
    userId?: number,
  ): Promise<RuntimeCapabilities>;

  createSession(input: CreateRuntimeSessionInput): Promise<RuntimeSession>;
  restoreSession(input: RestoreRuntimeSessionInput): Promise<RuntimeSession>;
  startRun(input: StartRuntimeRunInput): Promise<void>;
  steerRun(
    input: StartRuntimeRunInput & { clientRequestId: string },
  ): Promise<void>;
  streamSession(
    input: RuntimeSessionReference,
    signal?: AbortSignal,
    onConnected?: () => void,
  ): AsyncIterable<NormalizedAgentEvent>;
  resolveApproval(input: ResolveRuntimeApprovalInput): Promise<void>;
  stopRun(input: RuntimeSessionReference): Promise<void>;
  disposeSession(input: RuntimeSessionReference): Promise<void>;

  applyCapabilityDecision(input: {
    externalSessionId: string;
    liveSessionId?: string;
    workspaceKey: string;
    directory?: string;
    decision: CapabilityDecision;
  }): Promise<void>;

  managementDirectory(scope?: string | number): string;
  addMcpConnection(
    directory: string,
    name: string,
    config: unknown,
    userId?: number,
  ): Promise<unknown>;
  setMcpConnectionConnected(
    directory: string,
    name: string,
    connected: boolean,
    userId?: number,
  ): Promise<unknown>;
  startMcpAuthentication(
    directory: string,
    name: string,
    userId?: number,
  ): Promise<unknown>;
}
