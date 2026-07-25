import {
  DEFAULT_ASSISTANT_MODELS,
  formatAssistantModelName,
} from "../../ai-models.ts";
import type { ChatAttachment } from "../../chat-attachments.ts";
import { readOpenHarnessConfig } from "../../openharness/config.ts";
import type { NormalizedAgentEvent } from "../../openharness/events.ts";
import { resolveWorkspace } from "../../openharness/workspace.ts";
import type {
  AgentRuntime,
  CreateRuntimeSessionInput,
  ResolveRuntimeApprovalInput,
  RestoreRuntimeSessionInput,
  RuntimeSession,
  RuntimeSessionReference,
  StartRuntimeRunInput,
} from "../contracts.ts";
import type { AgentRuntimeConfig } from "../config.ts";
import {
  createHermesEventNormalizationState,
  normalizeHermesEvent,
  type RawHermesEvent,
} from "../hermes-events.ts";
import {
  HermesRpcClient,
  HermesRpcErrorResponse,
} from "../hermes-wire.ts";
import {
  addProxyMcpConnection,
  proxyMcpDiscovery,
  setProxyMcpConnectionConnected,
} from "../mcp-proxy.ts";

const BREADBOARD_TOOLSET = "breadboard";
const BREADBOARD_AGENT = "breadboard";
const CHATMOCK_PROVIDER = "chatmock";
const TURN_RESULT_POLL_MS = 1_000;

const BASE_SYSTEM_PROMPT = [
  "You are running inside Breadboard.",
  "Breadboard is the canonical owner of users, conversations, gardens, artifacts, permissions, memory, and audit records.",
  "Use only the Breadboard tools exposed in this session.",
  "Never claim filesystem, terminal, network, garden, or artifact access unless a Breadboard tool completed successfully.",
  "Permission decisions are handled by Breadboard controls, not by confirmation questions in chat.",
].join(" ");

interface HermesSessionCreateResult {
  session_id: string;
  stored_session_id: string;
}

interface HermesSessionState extends RuntimeSession {
  liveSessionId: string;
  model?: string;
  reasoningEffort?: string;
  activeTurnId?: string;
  activeTurnText?: string;
}

interface HermesTurnResult {
  state?: "running" | "completed" | "failed" | "aborted" | "unknown";
  turn_id?: string;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTextAttachments(
  text: string,
  attachments: ChatAttachment[] | undefined,
): string {
  const blocks = (attachments ?? []).flatMap((attachment) =>
    attachment.type === "text"
      ? [
          [
            `<breadboard_attachment name=${JSON.stringify(attachment.name)}>`,
            attachment.text,
            "</breadboard_attachment>",
          ].join("\n"),
        ]
      : [],
  );
  return blocks.length > 0 ? `${text}\n\n${blocks.join("\n\n")}` : text;
}

function imageBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Hermes runtime adapter. The only enabled Hermes toolset is the bundled
 * Breadboard plugin; all authority remains in Breadboard's internal tool
 * routes and capability broker.
 */
export class HermesRuntimeAdapter implements AgentRuntime {
  readonly kind = "hermes" as const;
  private readonly client: HermesRpcClient;
  private readonly sessions = new Map<string, HermesSessionState>();
  private readonly config: AgentRuntimeConfig["hermes"];

  constructor(config: AgentRuntimeConfig["hermes"]) {
    this.config = config;
    this.client = new HermesRpcClient(config);
  }

  get enabled(): boolean {
    return Boolean(this.config.baseUrl && this.config.sessionToken);
  }

  async health() {
    if (!this.enabled) return { healthy: false, version: "unknown" };
    try {
      const response = await fetch(`${this.config.baseUrl}/api/status`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.sessionToken}`,
        },
        signal: AbortSignal.timeout(
          Math.min(this.config.requestTimeoutMs, 5_000),
        ),
        cache: "no-store",
      });
      if (!response.ok) return { healthy: false, version: "unknown" };
      const body = await response.json() as Record<string, unknown>;
      return {
        healthy: true,
        version:
          typeof body.version === "string" ? body.version : "unknown",
      };
    } catch {
      return { healthy: false, version: "unknown" };
    }
  }

  async listAgents() {
    return [{
      name: BREADBOARD_AGENT,
      mode: "primary",
      description: "Hermes with Breadboard-owned tools and permissions.",
    }];
  }

  async listModels() {
    return DEFAULT_ASSISTANT_MODELS.map((id) => ({
      id,
      name: formatAssistantModelName(id),
      providerId: CHATMOCK_PROVIDER,
    }));
  }

  async listCapabilities(_directory?: string, userId?: number) {
    const builtIn = [
      "terminal_execute_command",
      "garden_list",
      "garden_search",
      "garden_get_page",
      "garden_get_page_context",
      "garden_get_source_excerpt",
      "garden_get_source_figure",
      "garden_get_graph_neighbors",
      "garden_get_learning_spine",
      "garden_get_content_inventory",
      "garden_get_recent_events",
      "garden_run_proposal_validation",
      "garden_create_note_proposal",
      "garden_propose_page_revision",
      "garden_propose_visualization",
      "artifact_create",
      "artifact_read",
      "artifact_update",
      "artifact_append",
      "artifact_render",
      "artifact_finalize",
      "artifact_list",
      "artifact_fork",
      "capability_gap",
      "capability_search",
      "gbrain_status",
      "gbrain_search",
      "gbrain_retrieve",
      "gbrain_synthesize",
      "gbrain_graph_neighbors",
      "mcp_call",
    ];
    const proxy = userId ? proxyMcpDiscovery(userId) : { tools: [], mcp: {} };
    return {
      tools: [...builtIn, ...proxy.tools],
      mcp: proxy.mcp,
    };
  }

  managementDirectory(scope: string | number = "shared"): string {
    return resolveWorkspace(
      readOpenHarnessConfig(),
      {
        surface: "dashboard_terminal",
        sessionKey: `capability-discovery-${scope}`,
      },
      { create: true },
    ).directory;
  }

  async createSession(
    input: CreateRuntimeSessionInput,
  ): Promise<RuntimeSession> {
    const workspace = resolveWorkspace(
      readOpenHarnessConfig(),
      {
        surface: input.surface,
        sessionKey: input.sessionKey,
        conversationKey: input.conversationKey,
        gardenKey: input.gardenKey,
        pageKey: input.pageKey,
        filesystemMode: input.filesystemMode,
        previousDirectory: input.previousDirectory,
      },
      { create: true },
    );
    const created = await this.client.request<HermesSessionCreateResult>(
      "session.create",
      {
        source: "breadboard",
        title: input.title,
        // Hermes itself stays in the isolated runtime directory. Authorized
        // host paths are reached only through Breadboard's validated tools.
        cwd: workspace.runtimeDirectory,
        messages: input.messages ?? [],
        model: input.model,
        provider: input.model ? "custom" : undefined,
        reasoning_effort: input.reasoningEffort,
        enabled_toolsets: [BREADBOARD_TOOLSET],
        system_prompt: BASE_SYSTEM_PROMPT,
        close_on_disconnect: false,
      },
    );
    if (!created.session_id || !created.stored_session_id) {
      throw new Error("Hermes returned an invalid session response.");
    }
    const session: HermesSessionState = {
      externalSessionId: created.stored_session_id,
      liveSessionId: created.session_id,
      directory: workspace.directory,
      runtimeDirectory: workspace.runtimeDirectory,
      workspaceKey: workspace.workspaceKey,
      agentName: BREADBOARD_AGENT,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
    };
    this.sessions.set(session.externalSessionId, session);
    return session;
  }

  async restoreSession(
    input: RestoreRuntimeSessionInput,
  ): Promise<RuntimeSession> {
    // Hermes persistence is explicitly non-canonical. Reconstruct a fresh live
    // session from Breadboard's authorized transcript after every process or
    // dashboard restart rather than trusting Hermes's state database.
    return this.createSession(input);
  }

  async startRun(input: StartRuntimeRunInput): Promise<void> {
    const session = this.requireSession(input);
    const requestedModel = input.model?.modelID?.trim();
    if (requestedModel && requestedModel !== session.model) {
      await this.client.request("config.set", {
        session_id: session.liveSessionId,
        key: "model",
        value: `${requestedModel} --provider custom`,
      });
      session.model = requestedModel;
    }
    const requestedReasoning = input.variant?.trim();
    if (
      requestedReasoning &&
      requestedReasoning !== session.reasoningEffort
    ) {
      await this.client.request("config.set", {
        session_id: session.liveSessionId,
        key: "reasoning",
        value: requestedReasoning,
      });
      session.reasoningEffort = requestedReasoning;
    }
    for (const attachment of input.attachments ?? []) {
      if (attachment.type !== "image") continue;
      await this.client.request("image.attach_bytes", {
        session_id: session.liveSessionId,
        content_base64: imageBase64(attachment.dataUrl),
        filename: attachment.name,
      });
    }
    const runtimeText = withTextAttachments(input.text, input.attachments);
    const turnId = input.messageId?.trim();
    session.activeTurnId = turnId;
    session.activeTurnText = runtimeText;
    try {
      await this.client.request("prompt.submit", {
        session_id: session.liveSessionId,
        text: runtimeText,
        system_prompt: [BASE_SYSTEM_PROMPT, input.system?.trim()]
          .filter(Boolean)
          .join("\n\n"),
        ...(turnId ? { client_turn_id: turnId } : {}),
      });
    } catch (error) {
      if (session.activeTurnId === turnId) {
        session.activeTurnId = undefined;
        session.activeTurnText = undefined;
      }
      throw error;
    }
  }

  async steerRun(
    input: StartRuntimeRunInput & { clientRequestId: string },
  ): Promise<void> {
    const session = this.requireSession(input);
    const result = await this.client.request<{ status?: string }>(
      "session.steer",
      {
        session_id: session.liveSessionId,
        text: withTextAttachments(input.text, input.attachments),
      },
    );
    if (result.status === "rejected") {
      throw new Error("Hermes rejected the course correction.");
    }
  }

  async *streamSession(
    input: RuntimeSessionReference,
    signal?: AbortSignal,
    onConnected?: () => void,
  ): AsyncGenerator<NormalizedAgentEvent, void, unknown> {
    const session = this.requireSession(input);
    session.activeTurnId ??= input.messageId;
    session.activeTurnText ??= input.instruction;
    const state = createHermesEventNormalizationState();
    const streamAbort = new AbortController();
    const abortStream = () => streamAbort.abort();
    signal?.addEventListener("abort", abortStream, { once: true });
    const rawIterator = this.client.events(
      session.liveSessionId,
      streamAbort.signal,
      onConnected,
    )[Symbol.asyncIterator]();
    let nextRaw: Promise<IteratorResult<RawHermesEvent>> = rawIterator.next();
    let recoverySupported = true;
    let streamError: unknown;
    const activeTurnReference = () => {
      let resolved:
        | { messageId?: string; instruction?: string }
        | undefined;
      try {
        resolved = input.resolveActiveTurn?.();
      } catch {
        // A transient database read failure must not tear down the live event
        // stream. The next recovery poll gets another chance.
      }
      return {
        turnId:
          session.activeTurnId ?? resolved?.messageId ?? input.messageId,
        text:
          session.activeTurnText ??
          resolved?.instruction ??
          input.instruction ??
          "",
      };
    };

    try {
      while (!streamAbort.signal.aborted) {
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          nextRaw.then(
            (result) => ({ kind: "event" as const, result }),
            (error) => ({ kind: "stream_error" as const, error }),
          ),
          new Promise<{ kind: "poll" }>((resolve) => {
            pollTimer = setTimeout(
              () => resolve({ kind: "poll" }),
              TURN_RESULT_POLL_MS,
            );
          }),
        ]);
        if (pollTimer) clearTimeout(pollTimer);

        if (next.kind === "stream_error") {
          if (streamAbort.signal.aborted) return;
          const { turnId } = activeTurnReference();
          if (!turnId) throw next.error;
          const firstDisconnect = streamError === undefined;
          streamError = next.error;
          // The event transport is gone, but JSON-RPC can reconnect. Stop
          // replaying a partial journal and use the correlated result query as
          // the sole authority for the remainder of this turn.
          nextRaw = new Promise<IteratorResult<RawHermesEvent>>(() => {});
          if (firstDisconnect) {
            yield {
              type: "reasoning.status",
              sessionId: input.externalSessionId,
              timestamp: new Date().toISOString(),
              payload: {
                label: "Reconnecting to Hermes",
                detail: "Waiting for Hermes to confirm this turn's final result.",
                detailMode: "replace",
              },
            };
          }
          continue;
        }

        if (next.kind === "event") {
          if (next.result.done) return;
          const raw = next.result.value;
          nextRaw = rawIterator.next();
          const normalized = normalizeHermesEvent(
            raw,
            session.liveSessionId,
            input.externalSessionId,
            state,
          );
          if (raw.type === "message.complete") {
            const payload = isRecord(raw.payload) ? raw.payload : {};
            const completedTurnId =
              typeof payload.turn_id === "string"
                ? payload.turn_id
                : undefined;
            if (
              completedTurnId &&
              completedTurnId === activeTurnReference().turnId
            ) {
              session.activeTurnId = undefined;
              session.activeTurnText = undefined;
            }
          }
          for (const event of normalized) yield event;
          continue;
        }

        const { turnId, text } = activeTurnReference();
        if (!recoverySupported || !turnId) continue;
        let recovered: HermesTurnResult;
        try {
          recovered = await this.client.request<HermesTurnResult>(
            "session.turn_result",
            {
              session_id: session.liveSessionId,
              stored_session_id: session.externalSessionId,
              turn_id: turnId,
              expected_user_text: text,
            },
            streamAbort.signal,
          );
        } catch (error) {
          // Older Hermes gateways do not expose durable turn recovery. Keep
          // their live stream working and stop probing until the next attach.
          if (error instanceof HermesRpcErrorResponse && error.code === -32601) {
            recoverySupported = false;
            if (streamError) throw streamError;
          }
          continue;
        }
        if (
          recovered.state !== "completed" &&
          recovered.state !== "failed" &&
          recovered.state !== "aborted"
        ) {
          continue;
        }
        const recoveredPayload = isRecord(recovered.payload)
          ? recovered.payload
          : {};
        const status =
          recovered.state === "aborted"
            ? "interrupted"
            : recovered.state === "failed"
              ? "error"
              : recoveredPayload.status ?? "complete";
        const raw: RawHermesEvent = {
          type: "message.complete",
          session_id: session.liveSessionId,
          payload: {
            ...recoveredPayload,
            status,
            turn_id: turnId,
          },
        };
        const normalized = normalizeHermesEvent(
          raw,
          session.liveSessionId,
          input.externalSessionId,
          state,
        );
        session.activeTurnId = undefined;
        session.activeTurnText = undefined;
        for (const event of normalized) yield event;
        return;
      }
    } finally {
      streamAbort.abort();
      signal?.removeEventListener("abort", abortStream);
      void rawIterator.return?.();
    }
  }

  async resolveApproval(
    input: ResolveRuntimeApprovalInput,
  ): Promise<void> {
    const session = this.requireSession(input);
    await this.client.request("approval.respond", {
      session_id: session.liveSessionId,
      choice:
        input.decision === "reject"
          ? "deny"
          : input.decision === "always"
            ? "session"
            : "once",
    });
  }

  async stopRun(input: RuntimeSessionReference): Promise<void> {
    const session = this.requireSession(input);
    await this.client.request("session.interrupt", {
      session_id: session.liveSessionId,
    });
  }

  async disposeSession(input: RuntimeSessionReference): Promise<void> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) return;
    try {
      await this.client.request("session.close", {
        session_id: session.liveSessionId,
      });
    } finally {
      this.client.clearSession(session.liveSessionId);
      this.sessions.delete(input.externalSessionId);
    }
  }

  async applyCapabilityDecision(): Promise<void> {
    // Native Hermes tools are absent. Breadboard tools revalidate the current
    // capability decision on every call, so there is no runtime policy cache to
    // update here.
  }

  async addMcpConnection(
    _directory: string,
    name: string,
    config: unknown,
    userId?: number,
  ): Promise<unknown> {
    if (!userId) throw new Error("MCP management requires an authenticated user.");
    return addProxyMcpConnection(userId, name, config);
  }

  async setMcpConnectionConnected(
    _directory: string,
    name: string,
    connected: boolean,
    userId?: number,
  ): Promise<unknown> {
    if (!userId) throw new Error("MCP management requires an authenticated user.");
    return setProxyMcpConnectionConnected(userId, name, connected);
  }

  async startMcpAuthentication(): Promise<never> {
    // OAuth tokens deliberately remain in Breadboard. A full browser redirect
    // flow is unavailable until the proxy has a server-side OAuth token store.
    throw new Error("MCP authentication must be completed with a configured credential header.");
  }

  private requireSession(input: RuntimeSessionReference): HermesSessionState {
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) return existing;
    if (!input.liveSessionId || !input.directory) {
      throw new Error("Hermes live session is not available.");
    }
    const restored: HermesSessionState = {
      externalSessionId: input.externalSessionId,
      liveSessionId: input.liveSessionId,
      directory: input.directory,
      runtimeDirectory: input.directory,
      workspaceKey: input.workspaceKey,
      agentName: BREADBOARD_AGENT,
    };
    this.sessions.set(input.externalSessionId, restored);
    return restored;
  }
}
