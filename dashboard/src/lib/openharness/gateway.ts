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
  fetchMcpStatus,
  fetchToolIds,
  addMcpServer,
  setMcpServerConnected,
  startMcpAuthentication,
  openEventStream,
  promptAsync,
  replyPermission,
  updateSessionPermissions,
  type OpenHarnessAgent,
  type OpenHarnessHealth,
  type OpenHarnessModel,
  type OpenHarnessMcpConfig,
  type PromptBody,
} from "./client.ts";
import {
  readOpenHarnessConfig,
  type OpenHarnessConfig,
  type OpenHarnessSurface,
} from "./config.ts";
import type { FilesystemAccessMode } from "./runtime-store.ts";
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

const PERMISSION_HANDOFF_SYSTEM = [
  "Permission decisions are handled outside the conversation by Breadboard controls.",
  "Never ask for tool permission in prose or request a confirmation as another chat turn.",
  "This rule overrides any agent guidance to ask the user before a permissioned operation.",
  "When an intended tool requires permission, invoke it directly exactly once; the runtime will either approve it automatically or pause for the dedicated permission UI.",
  "If the operation is denied or unavailable, report that outcome without asking the user to confirm the same operation in chat.",
].join(" ");

export interface AgentSession {
  openHarnessSessionId: string;
  directory: string;
  runtimeDirectory: string;
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
  filesystemMode: FilesystemAccessMode;
  previousDirectory?: string | null;
}

export interface SendAgentMessageInput {
  openHarnessSessionId: string;
  workspaceKey: string;
  directory?: string;
  agentName: string;
  text: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  tools?: Record<string, boolean>;
  messageId?: string;
}

export interface PermissionResponseInput {
  openHarnessSessionId: string;
  workspaceKey: string;
  directory?: string;
  requestId: string;
  decision: "once" | "always" | "reject";
}

export interface OpenHarnessCapabilityDiscovery {
  tools: string[];
  mcp: Awaited<ReturnType<typeof fetchMcpStatus>>;
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

  async capabilityDiscovery(
    directory = this.managementDirectory(),
  ): Promise<OpenHarnessCapabilityDiscovery> {
    const [tools, mcp] = await Promise.all([
      fetchToolIds(this.config, directory),
      fetchMcpStatus(this.config, directory),
    ]);
    return { tools, mcp };
  }

  managementDirectory(scope: string | number = "shared"): string {
    return resolveWorkspace(
      this.config,
      {
        surface: "dashboard_terminal",
        sessionKey: `capability-discovery-${scope}`,
      },
      { create: true },
    ).directory;
  }

  async addMcpConnection(
    directory: string,
    name: string,
    config: OpenHarnessMcpConfig,
  ) {
    return addMcpServer(this.config, directory, name, config);
  }

  async setMcpConnectionConnected(
    directory: string,
    name: string,
    connected: boolean,
  ) {
    return setMcpServerConnected(this.config, directory, name, connected);
  }

  async startMcpAuthentication(directory: string, name: string) {
    return startMcpAuthentication(this.config, directory, name);
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
    const { directory, runtimeDirectory, workspaceKey } = resolveWorkspace(
      this.config,
      {
        ...request,
        filesystemMode: input.filesystemMode,
        previousDirectory: input.previousDirectory,
      },
      { create: true },
    );
    const agentName = this.agentForSurface(input.surface);
    const session = await createSession(this.config, directory, {
      title: input.title,
      agent: agentName,
      metadata: { surface: input.surface, ...input.metadata },
    });
    await updateSessionPermissions(this.config, directory, session.id, [
      {
        permission: "external_directory",
        pattern: "*",
        action: input.filesystemMode === "full" ? "allow" : "deny",
      },
    ]);
    return {
      openHarnessSessionId: session.id,
      directory,
      runtimeDirectory,
      workspaceKey,
      agentName,
    };
  }

  // Session resume is implemented in session-service.authorizeRuntimeSession /
  // authorizeQuartzRuntimeSession: they load the persisted runtime-session row,
  // re-authorize ownership + garden access, and recompute the workspace
  // directory from the stored workspace_key. That DB-backed path is the single
  // resume mechanism — the gateway addresses an existing session purely by
  // (openHarnessSessionId, workspaceKey), recomputing the directory per call.

  async sendMessage(input: SendAgentMessageInput): Promise<void> {
    const directory =
      input.directory ??
      directoryForWorkspaceKey(this.config, input.workspaceKey);
    const system = [input.system?.trim(), PERMISSION_HANDOFF_SYSTEM]
      .filter(Boolean)
      .join("\n\n");
    const body: PromptBody = {
      agent: input.agentName,
      parts: [{ type: "text", text: input.text }],
      ...(input.model ? { model: input.model } : {}),
      ...(input.variant ? { variant: input.variant } : {}),
      system,
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.messageId ? { messageID: input.messageId } : {}),
    };
    await promptAsync(this.config, directory, input.openHarnessSessionId, body);
  }

  async abortSession(input: {
    openHarnessSessionId: string;
    workspaceKey: string;
    directory?: string;
  }): Promise<void> {
    const directory =
      input.directory ??
      directoryForWorkspaceKey(this.config, input.workspaceKey);
    await abortSession(this.config, directory, input.openHarnessSessionId);
  }

  async respondToPermission(input: PermissionResponseInput): Promise<void> {
    const directory =
      input.directory ??
      directoryForWorkspaceKey(this.config, input.workspaceKey);
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
    input: {
      openHarnessSessionId: string;
      workspaceKey: string;
      directory?: string;
    },
    signal?: AbortSignal,
    onConnected?: () => void,
  ): AsyncIterable<NormalizedAgentEvent> {
    const directory =
      input.directory ??
      directoryForWorkspaceKey(this.config, input.workspaceKey);
    const response = await openEventStream(this.config, directory, signal);
    const body = response.body;
    if (!body) return;
    onConnected?.();
    for await (const raw of parseSseStream(readableToIterable(body))) {
      if (typeof raw.type !== "string") continue;
      const event = raw as unknown as RawOpenHarnessEvent;
      const normalized = normalizeOpenHarnessEvent(
        event,
        input.openHarnessSessionId,
      );
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
