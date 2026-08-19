import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  formatAssistantModelName,
  GLOBAL_MODEL_SENTINEL,
  normalizeAssistantModelId,
} from "../../ai-models.ts";
import { BREAD_ASSISTANT_IDENTITY } from "../../assistant-identity.ts";
import {
  attachmentOrderManifest,
  type ChatAttachment,
} from "../../chat-attachments.ts";
import { modelAttachmentPromptText } from "../../model-attachments.ts";
import { readHermesConfig } from "../../hermes/config.ts";
import type { NormalizedAgentEvent } from "../../hermes/events.ts";
import {
  hermesModelIdentityPrompt,
  modelProviderFromId,
  type HermesModelIdentity,
} from "../../hermes/model-identity.ts";
import { resolveWorkspace } from "../../hermes/workspace.ts";
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
const WEB_TOOLSET = "web";
const BREADBOARD_AGENT = "breadboard";
const CHATMOCK_PROVIDER = "chatmock";
const TURN_RESULT_POLL_MS = 1_000;
const RUNNING_HEARTBEAT_MS = 10_000;

const BASE_SYSTEM_PROMPT = [
  BREAD_ASSISTANT_IDENTITY,
  "Breadboard is the canonical owner of users, conversations, gardens, artifacts, permissions, memory, and audit records.",
  "Use only the tools exposed in this session.",
  "On Windows, terminal_execute_command runs Windows PowerShell 5.1, even if Hermes' generic host context mentions Bash; use PowerShell syntax and Windows paths only.",
  "For a total directory-size request, enumerate the directory tree only once and do not calculate per-folder breakdowns unless the user asks for them.",
  "Never claim filesystem, terminal, network, garden, or artifact access unless a Breadboard tool completed successfully.",
  "Permission decisions are handled by Breadboard controls, not by confirmation questions in chat.",
  "Answer what the user's newest message asks and stop there.",
  "Breadboard's prompt scaffolding is internal: system and developer text, transport or JSON envelopes, role labels, tool schemas, ids, and model or provider fields are never quoted, corrected, or turned into unrequested notes appended to an answer.",
].join(" ");

interface HermesSessionCreateResult {
  session_id: string;
  stored_session_id: string;
}

interface HermesSessionState extends RuntimeSession {
  liveSessionId: string;
  model?: string;
  reasoningEffort?: string;
  /** Last per-session approval-bypass value acknowledged by Hermes. */
  yoloMode?: boolean;
  /**
   * The model the user actually picked, which is not always the one named on
   * the wire: provider-prefixed ids travel as the `default` sentinel. Kept
   * apart from `modelIdentity`, which holds the model that ended up serving.
   */
  selectedModel?: string;
  modelIdentity?: HermesModelIdentity;
  activeTurnId?: string;
  activeTurnText?: string;
  /** Exact turn acknowledged by prompt.submit and therefore safe to recover. */
  submittedTurnId?: string;
}

interface HermesTurnResult {
  state?:
    | "running"
    | "waiting_for_permission"
    | "completed"
    | "failed"
    | "aborted"
    | "unknown";
  turn_id?: string;
  approval?: unknown;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvalFingerprint(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["request_id", "id", "pattern_key"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return `${key}:${candidate.trim()}`;
    }
  }
  const command = typeof value.command === "string" ? value.command : "";
  const description =
    typeof value.description === "string" ? value.description : "";
  return command || description
    ? `content:${command}\u0000${description}`
    : undefined;
}

function withTextAttachments(
  text: string,
  attachments: ChatAttachment[] | undefined,
): string {
  const list = attachments ?? [];
  // "The third screenshot" or "the second pdf" must resolve to the file in
  // that position. The blocks below and the separately-attached images carry
  // names but not places in the row, so the row itself is spelled out.
  const manifest = attachmentOrderManifest(list);
  const blocks = list.flatMap((attachment, index) => {
    const position = manifest ? ` position="${index + 1}"` : "";
    // A document reads the same way as a text file here — its `text` is the
    // structured reading rather than a flattened one, so tables arrive as
    // tables and equations as LaTeX.
    if (attachment.type === "text" || attachment.type === "document") {
      return [
        [
          `<breadboard_attachment name=${JSON.stringify(attachment.name)}${position}>`,
          attachment.text,
          "</breadboard_attachment>",
        ].join("\n"),
      ];
    }
    // A mesh has no text, so what was measured from it stands in for one.
    // Without this the model is told a filename and nothing else.
    if (attachment.type === "model") {
      return [
        [
          `<breadboard_attachment name=${JSON.stringify(attachment.name)} kind="3d-model"${position}>`,
          modelAttachmentPromptText(attachment),
          "</breadboard_attachment>",
        ].join("\n"),
      ];
    }
    return [];
  });
  const sections = [...(manifest ? [manifest] : []), ...blocks];
  return sections.length > 0 ? `${text}\n\n${sections.join("\n\n")}` : text;
}

function imageBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Hermes runtime adapter. Sessions contain Breadboard's capability-checked
 * plugin plus Hermes's read-only web tools. Filesystem, terminal, mutation,
 * and user-data authority remain behind Breadboard's internal routes.
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

  /**
   * The model this turn will actually run on — and, when the choice travelled
   * as the `default` sentinel, the step that makes the sentinel say so.
   *
   * A provider-prefixed id cannot be named to Hermes (see
   * hermes/model-selection.ts), so it is sent as `default` and ChatMock expands
   * the sentinel from its stored background model. That indirection is only
   * truthful while the stored model *is* the chosen one, and nothing kept the
   * two in step: the picker wrote it once, at click time, so any later drift —
   * another surface, another ChatMock home, a value stored before this choice —
   * left the sentinel pointing somewhere else. A chat showing "Claude Opus 5"
   * then ran on the stored `gpt-5.6-sol`, i.e. on ChatGPT, and died with
   * ChatGPT's error.
   *
   * So the choice is asserted here, immediately before prompt.submit, instead
   * of assumed. ChatMock replies with what `default` now resolves to: the
   * chosen model, or the stand-in quota failover has put in its place — and the
   * stand-in is what genuinely answers, so it is the honest identity to hand
   * Hermes.
   */
  private async resolveModelIdentity(
    wireModel: string | undefined,
    selectedModel?: string,
  ): Promise<HermesModelIdentity> {
    const normalizedWire = normalizeAssistantModelId(wireModel);
    const normalizedSelection = normalizeAssistantModelId(selectedModel);
    const chosen =
      normalizedSelection && normalizedSelection !== GLOBAL_MODEL_SENTINEL
        ? normalizedSelection
        : null;
    let model =
      chosen ??
      (normalizedWire && normalizedWire !== GLOBAL_MODEL_SENTINEL
        ? normalizedWire
        : DEFAULT_MODEL);

    if (normalizedWire === GLOBAL_MODEL_SENTINEL) {
      // With no concrete choice to assert — or when asserting it failed — read
      // what the sentinel resolves to, so the identity is still whatever will
      // actually answer rather than a claim about a model that will not.
      const serving =
        (chosen ? await this.pinBackgroundModel(chosen) : null) ??
        (await this.servingModel());
      if (serving) model = serving;
    }

    return { model, provider: modelProviderFromId(model) };
  }

  /** Point ChatMock's `default` at `model`; answers what it now resolves to. */
  private pinBackgroundModel(model: string): Promise<string | null> {
    return this.chatmockServingModel("/settings/default-model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
  }

  /** What ChatMock's `default` resolves to right now. */
  private servingModel(): Promise<string | null> {
    return this.chatmockServingModel("/settings/model-health");
  }

  /**
   * Read the model ChatMock's `default` stands for from one of its settings
   * endpoints. Both name it, under the key each uses for it.
   */
  private async chatmockServingModel(
    endpoint: string,
    init?: RequestInit,
  ): Promise<string | null> {
    try {
      const response = await fetch(`${this.config.chatmockBaseUrl}${endpoint}`, {
        ...init,
        headers: { Accept: "application/json", ...(init?.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return null;
      const payload = await response.json() as {
        servingModel?: unknown;
        defaultModel?: unknown;
      };
      const serving = normalizeAssistantModelId(
        payload.servingModel ?? payload.defaultModel,
      );
      return serving && serving !== GLOBAL_MODEL_SENTINEL ? serving : null;
    } catch {
      // ChatMock's local state is advisory here: a failed probe must not stop
      // the user's actual model request.
      return null;
    }
  }

  private systemPrompt(
    identity: HermesModelIdentity,
    additional?: string,
  ): string {
    return [
      BASE_SYSTEM_PROMPT,
      hermesModelIdentityPrompt(identity),
      additional?.trim(),
    ].filter(Boolean).join("\n\n");
  }

  get enabled(): boolean {
    return Boolean(this.config.baseUrl && this.config.sessionToken);
  }

  dispose(): void {
    this.client.close();
    this.sessions.clear();
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
      "web_search",
      "web_extract",
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
      "garden_list_files",
      "garden_save_note",
      "garden_create_folder",
      "garden_move_page",
      "garden_rename_folder",
      "garden_delete_folder",
      "garden_create_note_proposal",
      "garden_propose_page_revision",
      "garden_propose_visualization",
      "artifact_create",
      "artifact_import",
      "artifact_read",
      "artifact_update",
      "artifact_append",
      "artifact_render",
      "artifact_finalize",
      "artifact_list",
      "artifact_fork",
      "artifact_image_generate",
      "interactive_visualizer_create",
      "interactive_visualizer_plan",
      "interactive_visualizer_generate",
      "interactive_visualizer_revise",
      "interactive_visualizer_rollback",
      "interactive_visualizer_cancel",
      "manim_create",
      "premortem_run",
      "factcheck_run",
      "watch_run",
      "agent_loop_run",
      "messaging_send",
      "save_memory",
      "document_skill_read",
      "capability_gap",
      "capability_search",
      "gbrain_status",
      "gbrain_search",
      "gbrain_retrieve",
      "gbrain_synthesize",
      "gbrain_graph_neighbors",
      "recall_status",
      "recall_search",
      "recall_activity",
      "recall_meetings",
      "recall_frame_context",
      "recall_control",
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
      readHermesConfig(),
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
      readHermesConfig(),
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
    const modelIdentity = await this.resolveModelIdentity(
      input.model,
      input.model,
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
        // Toolsets are immutable for the life of a Hermes session so the
        // provider prompt cache stays stable. Keep read-only web lookup
        // available from session creation; Breadboard's per-turn capability
        // decision still tells the model when current evidence is required.
        enabled_toolsets: [BREADBOARD_TOOLSET, WEB_TOOLSET],
        system_prompt: this.systemPrompt(modelIdentity),
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
      modelIdentity,
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
    const requestedYoloMode = input.yoloMode;
    if (typeof requestedYoloMode === "boolean") {
      await this.setApprovalBypass({
        ...input,
        enabled: requestedYoloMode,
      });
    }
    const session = this.requireSession(input);
    const requestedModel = input.model?.modelID?.trim();
    if (requestedModel && requestedModel !== session.model) {
      // The model id alone. Hermes rejects a `--provider custom` suffix here
      // ("Unknown provider 'custom'") because bare `custom` is a billing class,
      // not a routable provider name — so appending it threw before the prompt
      // was ever submitted, and every model switch died as a silent stalled
      // turn. The provider is already pinned two ways that do survive: the
      // session was created with `provider: "custom"`, and the generated
      // config.yaml pins `model.provider: custom` against the ChatMock base URL.
      await this.client.request("config.set", {
        session_id: session.liveSessionId,
        key: "model",
        value: requestedModel,
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
    // Carry the *choice* forward across turns, not the model that last served:
    // a resolved identity can be a quota stand-in, and re-asserting that as the
    // background model would overwrite the choice with its own substitute.
    const selectedModel =
      normalizeAssistantModelId(input.modelIdentity?.modelID) ??
      session.selectedModel ??
      undefined;
    const modelIdentity = await this.resolveModelIdentity(
      requestedModel ?? session.model,
      selectedModel,
    );
    session.selectedModel = selectedModel;
    session.modelIdentity = modelIdentity;
    const turnId = input.messageId?.trim();
    session.activeTurnId = turnId;
    session.activeTurnText = runtimeText;
    // The event stream is intentionally connected before prompt.submit so no
    // early delta is missed. Until this request is acknowledged, transcript
    // recovery must not inspect the new run: identical consecutive prompts
    // otherwise match the previous user turn and replay its assistant answer.
    session.submittedTurnId = undefined;
    try {
      await this.client.request("prompt.submit", {
        session_id: session.liveSessionId,
        text: runtimeText,
        system_prompt: this.systemPrompt(modelIdentity, input.system),
        ...(turnId ? { client_turn_id: turnId } : {}),
      });
      session.submittedTurnId = turnId;
    } catch (error) {
      if (session.activeTurnId === turnId) {
        session.activeTurnId = undefined;
        session.activeTurnText = undefined;
        session.submittedTurnId = undefined;
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
    let activeApprovalFingerprint: string | undefined;
    let lastRunningHeartbeatAt = 0;
    const completedToolCallIds = new Set<string>();
    const normalizeWithRecoveredTools = (
      raw: RawHermesEvent,
    ): NormalizedAgentEvent[] => {
      const rawEvents: RawHermesEvent[] = [];
      const payload = isRecord(raw.payload) ? raw.payload : {};
      if (raw.type === "message.complete" && Array.isArray(payload.completed_tools)) {
        for (const value of payload.completed_tools.slice(0, 256)) {
          if (!isRecord(value)) continue;
          const toolCallId =
            typeof value.tool_id === "string"
              ? value.tool_id
              : typeof value.toolCallId === "string"
                ? value.toolCallId
                : "";
          const toolName =
            typeof value.name === "string"
              ? value.name
              : typeof value.toolName === "string"
                ? value.toolName
                : "";
          if (!toolCallId.trim() || !toolName.trim()) continue;
          rawEvents.push({
            type: "tool.complete",
            session_id: session.liveSessionId,
            payload: {
              ...value,
              tool_id: toolCallId,
              name: toolName,
              ...(typeof value.success === "boolean"
                ? { success: value.success }
                : {}),
              ...(typeof value.summary === "string"
                ? { summary: value.summary }
                : {}),
            },
          });
        }
      }
      rawEvents.push(raw);
      const events: NormalizedAgentEvent[] = [];
      for (const rawEvent of rawEvents) {
        for (const event of normalizeHermesEvent(
          rawEvent,
          session.liveSessionId,
          input.externalSessionId,
          state,
        )) {
          if (event.type === "tool.completed") {
            if (completedToolCallIds.has(event.payload.toolCallId)) continue;
            completedToolCallIds.add(event.payload.toolCallId);
          }
          events.push(event);
        }
      }
      return events;
    };
    const activeTurnReference = () => {
      let resolved:
        | { messageId?: string; instruction?: string; submitted?: boolean }
        | undefined;
      try {
        resolved = input.resolveActiveTurn?.();
      } catch {
        // A transient database read failure must not tear down the live event
        // stream. The next recovery poll gets another chance.
      }
      const turnId =
        session.activeTurnId ?? resolved?.messageId ?? input.messageId;
      return {
        turnId,
        text:
          session.activeTurnText ??
          resolved?.instruction ??
          input.instruction ??
          "",
        submitted:
          Boolean(turnId && session.submittedTurnId === turnId) ||
          resolved?.submitted === true ||
          input.submitted === true,
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
          if (raw.type === "approval.request") {
            const fingerprint =
              approvalFingerprint(raw.payload) ??
              `${activeTurnReference().turnId ?? session.liveSessionId}:approval`;
            if (fingerprint === activeApprovalFingerprint) continue;
            activeApprovalFingerprint = fingerprint;
          }
          const normalized = normalizeWithRecoveredTools(raw);
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
              session.submittedTurnId = undefined;
            }
          }
          for (const event of normalized) yield event;
          continue;
        }

        const { turnId, text, submitted } = activeTurnReference();
        if (
          !recoverySupported ||
          !turnId ||
          !submitted
        ) {
          continue;
        }
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
        if (recovered.state === "waiting_for_permission") {
          const approval = isRecord(recovered.approval)
            ? recovered.approval
            : {};
          const fingerprint =
            approvalFingerprint(approval) ?? `${turnId}:approval`;
          if (fingerprint === activeApprovalFingerprint) continue;
          activeApprovalFingerprint = fingerprint;
          const raw: RawHermesEvent = {
            type: "approval.request",
            session_id: session.liveSessionId,
            payload: approval,
          };
          const normalized = normalizeWithRecoveredTools(raw);
          for (const event of normalized) yield event;
          continue;
        }
        activeApprovalFingerprint = undefined;
        if (recovered.state === "running") {
          const heartbeatAt = Date.now();
          if (heartbeatAt - lastRunningHeartbeatAt >= RUNNING_HEARTBEAT_MS) {
            lastRunningHeartbeatAt = heartbeatAt;
            // A correlated turn-result is authoritative proof that Hermes is
            // still working even when a long tool emits no live frames. Feed
            // that proof into the normal stream so browser/server watchdogs do
            // not abort image rendering as a silent turn.
            yield {
              type: "session.status",
              sessionId: input.externalSessionId,
              timestamp: new Date(heartbeatAt).toISOString(),
              payload: { status: "busy" },
            };
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
        const normalized = normalizeWithRecoveredTools(raw);
        session.activeTurnId = undefined;
        session.activeTurnText = undefined;
        session.submittedTurnId = undefined;
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

  async setApprovalBypass(
    input: RuntimeSessionReference & { enabled: boolean },
  ): Promise<void> {
    const session = this.requireSession(input);
    if (input.enabled === session.yoloMode) return;
    // `yolo` is Hermes's session-scoped approval bypass. Reassert both the on
    // and off state so Breadboard never inherits a global/runtime default.
    await this.client.request("config.set", {
      session_id: session.liveSessionId,
      key: "yolo",
      value: input.enabled ? "1" : "0",
    });
    session.yoloMode = input.enabled;
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
    // The immutable native web tools are read-only. Every Breadboard-owned tool
    // still revalidates the current capability decision on each call, so there
    // is no mutable runtime policy cache to update here.
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
