// The Breadboard → OpenHarness gateway.
//
// This is the single cohesive, server-only boundary between Breadboard and the
// OpenHarness runtime. Routes call the gateway; the gateway calls OpenHarness.
// The browser never reaches OpenHarness directly, never learns its URL,
// credentials, or filesystem paths, and only ever receives normalized events
// filtered to a session it is authorized for.
//
// Responsibilities:
//   - health / agent / model discovery
//   - session create & resume (workspace-directory scoped)
//   - message submission (async; the answer streams over events)
//   - abort
//   - permission responses
//   - a per-session event subscription that filters the instance-wide stream
//     down to one session and normalizes each event

import {
  abortSession,
  createSession,
  fetchAgents,
  fetchHealth,
  fetchModels,
  openEventStream,
  promptAsync,
  replyPermission,
  type OpenHarnessAgent,
  type OpenHarnessHealth,
  type OpenHarnessModel,
  type PromptBody,
} from "./client.ts";
import { readOpenHarnessConfig, type OpenHarnessConfig, type OpenHarnessSurface } from "./config.ts";
import {
  normalizeOpenHarnessEvent,
  type NormalizedAgentEvent,
  type RawOpenHarnessEvent,
} from "./events.ts";
import { parseSseStream, readableToIterable } from "./sse.ts";
import {
  directoryForWorkspaceKey,
  resolveWorkspace,
  type WorkspaceRequest,
} from "./workspace.ts";

export interface AgentSession {
  openHarnessSessionId: string;
  directory: string;
  workspaceKey: string;
  agentName: string;
}

export interface CreateAgentSessionInput {
  surface: OpenHarnessSurface;
  sessionKey: string;
  gardenKey?: string;
  pageKey?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SendAgentMessageInput {
  openHarnessSessionId: string;
  workspaceKey: string;
  agentName: string;
  text: string;
  model?: { providerID: string; modelID: string };
  system?: string;
  messageId?: string;
}

export interface PermissionResponseInput {
  openHarnessSessionId: string;
  workspaceKey: string;
  requestId: string;
  decision: "once" | "always" | "reject";
}

export class OpenHarnessGateway {
  readonly config: OpenHarnessConfig;

  constructor(config: OpenHarnessConfig = readOpenHarnessConfig()) {
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async health(): Promise<OpenHarnessHealth> {
    return fetchHealth(this.config);
  }

  async listAgents(surface?: OpenHarnessSurface): Promise<OpenHarnessAgent[]> {
    // Agents are discovered against a representative workspace directory. The
    // terminal root is a safe, always-present directory for discovery.
    const { directory } = resolveWorkspace(
      this.config,
      { surface: surface ?? "dashboard_terminal", sessionKey: "discovery" },
      { create: true },
    );
    return fetchAgents(this.config, directory);
  }

  async listModels(): Promise<OpenHarnessModel[]> {
    const { directory } = resolveWorkspace(
      this.config,
      { surface: "dashboard_terminal", sessionKey: "discovery" },
      { create: true },
    );
    return fetchModels(this.config, directory);
  }

  agentForSurface(surface: OpenHarnessSurface): string {
    if (surface === "garden_chat") return this.config.agents.garden;
    if (surface === "quartz_ai") return this.config.agents.quartz;
    return this.config.agents.terminal;
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    const request: WorkspaceRequest = {
      surface: input.surface,
      sessionKey: input.sessionKey,
      gardenKey: input.gardenKey,
      pageKey: input.pageKey,
    };
    const { directory, workspaceKey } = resolveWorkspace(this.config, request, { create: true });
    const agentName = this.agentForSurface(input.surface);
    const session = await createSession(this.config, directory, {
      title: input.title,
      agent: agentName,
      metadata: { surface: input.surface, ...input.metadata },
    });
    return { openHarnessSessionId: session.id, directory, workspaceKey, agentName };
  }

  // Session resume is implemented in session-service.authorizeRuntimeSession /
  // authorizeQuartzRuntimeSession: they load the persisted runtime-session row,
  // re-authorize ownership + garden access, and recompute the workspace
  // directory from the stored workspace_key. That DB-backed path is the single
  // resume mechanism — the gateway addresses an existing session purely by
  // (openHarnessSessionId, workspaceKey), recomputing the directory per call.

  async sendMessage(input: SendAgentMessageInput): Promise<void> {
    const directory = directoryForWorkspaceKey(this.config, input.workspaceKey);
    const body: PromptBody = {
      agent: input.agentName,
      parts: [{ type: "text", text: input.text }],
      ...(input.model ? { model: input.model } : {}),
      ...(input.system ? { system: input.system } : {}),
      ...(input.messageId ? { messageID: input.messageId } : {}),
    };
    await promptAsync(this.config, directory, input.openHarnessSessionId, body);
  }

  async abortSession(input: { openHarnessSessionId: string; workspaceKey: string }): Promise<void> {
    const directory = directoryForWorkspaceKey(this.config, input.workspaceKey);
    await abortSession(this.config, directory, input.openHarnessSessionId);
  }

  async respondToPermission(input: PermissionResponseInput): Promise<void> {
    const directory = directoryForWorkspaceKey(this.config, input.workspaceKey);
    await replyPermission(
      this.config,
      directory,
      input.openHarnessSessionId,
      input.requestId,
      input.decision,
    );
  }

  /**
   * Subscribe to one session's normalized events. Opens the workspace-filtered
   * instance stream, drops events for other sessions, and yields normalized
   * events. Closing the provided signal (or the consumer breaking) tears down
   * the underlying HTTP connection.
   */
  async *subscribeToSession(
    input: { openHarnessSessionId: string; workspaceKey: string },
    signal?: AbortSignal,
  ): AsyncIterable<NormalizedAgentEvent> {
    const directory = directoryForWorkspaceKey(this.config, input.workspaceKey);
    const response = await openEventStream(this.config, directory, signal);
    const body = response.body;
    if (!body) return;
    for await (const raw of parseSseStream(readableToIterable(body))) {
      if (typeof raw.type !== "string") continue;
      const event = raw as unknown as RawOpenHarnessEvent;
      const normalized = normalizeOpenHarnessEvent(event, input.openHarnessSessionId);
      if (normalized) yield normalized;
      if (signal?.aborted) break;
    }
  }
}

let cachedGateway: OpenHarnessGateway | null = null;

/** Process-wide gateway singleton bound to the current environment config. */
export function getOpenHarnessGateway(): OpenHarnessGateway {
  if (!cachedGateway) {
    cachedGateway = new OpenHarnessGateway();
  }
  return cachedGateway;
}

/** Reset the cached gateway (used by tests that swap env config). */
export function resetOpenHarnessGateway(): void {
  cachedGateway = null;
}
