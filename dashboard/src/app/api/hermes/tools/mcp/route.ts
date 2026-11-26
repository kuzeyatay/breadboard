import { NextResponse } from "next/server";
import { API_ANYTHING_CONNECTION, executeApiAnything } from "@/lib/api-anything/service.ts";
import { assertGuardedPrinterMcp } from "@/lib/bambu/mcp-guard.ts";
import {
  addProxyMcpConnection,
  callProxyMcpTool,
  LocalMcpBrokerError,
  proxyMcpTools,
} from "@/lib/agent-runtime/mcp-proxy.ts";
import {
  nangoActionFor,
  nangoActionSummariesForConnections,
} from "@/lib/nango/actions.ts";
import { COMPOSIO_RUNTIME_NAME, listComposioConnections } from "@/lib/composio/service.ts";
import { connectedAppUsageInstructions } from "@/lib/hermes/connected-app-context.ts";
import { executeComposioAction } from "@/lib/composio/executor.ts";
import { connectedAppTool, connectedAppToolSummaries, executeConnectedAppTool } from "@/lib/composio/app-tools.ts";
import {
  verifyCapabilityToken,
  tokenAllows,
} from "@/lib/hermes/capability-token.ts";
import {
  getMcpConnection,
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/hermes/mcp-connections.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  persistCapabilityDecision,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  getActiveRuntimeRun,
  parseRuntimeRunDispatch,
} from "@/lib/hermes/run-store.ts";
import {
  callGoalModeTool,
  GOAL_MODE_CONNECTION,
} from "@/lib/goal-mode.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { connectionToolAllowed } from "@/lib/hermes/capability-policy.ts";
import { codeIndexConnectionForSession } from "@/lib/code-index/chat-turn.ts";
import { isCodeIndexConnectionSlug } from "@/lib/code-index/repository-digest.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { missingRunArtifact } from "@/lib/hermes/artifact-completion.ts";
import { callMcpInstaller, MCP_INSTALLER_CONNECTION } from "@/lib/hermes/mcp-installer.ts";
import { usesAuthoredMcpHost } from "@/lib/hermes/authored-mcp.ts";
import { WORKSPACE_CONNECTION } from "@/lib/hermes/workspace-context.ts";
import { mcpFailureGuidance, retryTransient, type ConnectionCandidate } from "@/lib/hermes/connection-routing.ts";
import { DOORY_CONNECTION } from "@/lib/doory/context.ts";
import { VIDEO_STUDIO_CONNECTION } from "@/lib/timeline-studio/context.ts";
import { SPACES_PAGE_CONNECTION } from "@/lib/spaces/page-context.ts";

export const dynamic = "force-dynamic";

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_mcp_call", `${field} is required.`);
  }
  const result = value.trim();
  if (!result || result.length > max) {
    throw new ApiError(400, "invalid_mcp_call", `${field} is invalid.`);
  }
  return result;
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(
      400,
      "invalid_mcp_arguments",
      "Connected-app arguments must be an object.",
    );
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw new ApiError(
      413,
      "mcp_arguments_too_large",
      "Connected-app arguments are too large.",
    );
  }
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "mcp_call" })) {
      throw new ApiError(
        403,
        "mcp_capability_denied",
        "Connected-app access is not authorized.",
      );
    }
    const session = getRuntimeSessionById(
      Number(verified.token.breadboardSessionId),
    );
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      runtimeExternalSessionId(session) !==
        verified.token.hermesSessionId ||
      verified.token.userId !== session.user_id ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "mcp_session_scope_mismatch",
        "Connected-app session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "mcp_run_required",
        "Connected-app tools require a current run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision) {
      throw new ApiError(
        403,
        "mcp_decision_required",
        "The capability decision is unavailable.",
      );
    }
    // A failed call carries its next move (retry, the closest other connection,
    // a built-in tool), so the turn falls back instead of ending on it. Only
    // for failures: a 4xx is a policy or permission answer, never routed around.
    const ownerId = session.user_id;
    const withFallback = (error: ApiError, failedSlug: string): ApiError => {
      // A server that is down is an outage, not a refusal, so it gets the hint too.
      if (error.status < 500 && error.code !== "mcp_not_connected") return error;
      let alternatives: ConnectionCandidate[] = [];
      try {
        if (ownerId !== null) alternatives = listMcpConnections(ownerId, true)
          .filter((candidate) => decision.selectedConnections.includes(candidate.slug))
          .map((candidate) => ({
            slug: candidate.slug,
            name: candidate.displayName || candidate.slug,
            tools: proxyMcpTools(ownerId, candidate.slug).map((entry) => entry.name),
          }));
      } catch {
        // Guidance without alternatives still points at built-in tools.
      }
      const guidance = mcpFailureGuidance({ failedSlug, tool, code: error.code, args, alternatives });
      return guidance ? new ApiError(error.status, error.code, `${error.message} ${guidance}`) : error;
    };

    const body = await readJsonBody(request, 384 * 1024);
    const slug = text(body.connection, "connection", 48).toLowerCase();
    const tool = text(body.tool, "tool", 200);
    const args = objectArgs(body.args ?? {});
    // Added only by server-owned Hermes/Hermes wrappers after their
    // native approval UI resolves; it is absent from the model tool schema.
    const permissionGranted = body.permissionGranted === true;
    // Goal Mode is a built-in, conversation-scoped bridge. It deliberately
    // bypasses the saved-MCP registry: a generic local MCP process is shared by
    // user, while Goal state must be isolated to the exact conversation whose
    // signed capability token reached this route.
    if (slug === GOAL_MODE_CONNECTION) {
      const goalMode = parseRuntimeRunDispatch(run).goalMode;
      if (!goalMode?.enabled) {
        throw new ApiError(
          403,
          "goal_mode_disabled",
          "Goal Mode is not enabled for this turn.",
        );
      }
      if (!new Set(["get_goal", "create_goal", "update_goal"]).has(tool)) {
        throw new ApiError(403, "goal_tool_denied", "That Goal tool is not available.");
      }
      if (goalMode.readOnly && tool !== "get_goal") {
        throw new ApiError(409, "goal_inactive", "This turn started while the goal was stopped.");
      }
      const conversation = getConversationById(session.conversation_id);
      if (!conversation) {
        throw new ApiError(403, "goal_conversation_missing", "Goal Mode conversation scope is invalid.");
      }
      recordAuditEvent({
        eventType: "goal_mode.tool_started",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: { runId: run.id, tool },
      });
      try {
        const missing = tool === "update_goal" && args.status === "complete"
          ? missingRunArtifact(run, conversation.id) : null;
        const result = missing ? {
          isError: true,
          text: `Completion is not verified: the required ${missing.kind} artifact (${missing.rendererId}) is not ready. Continue the task, publish and verify the requested deliverable before marking the goal complete.`,
        } : callGoalModeTool({
          conversationPublicId: conversation.public_id,
          expectedGoalId: goalMode.goalId,
          tool,
          args,
        });
        recordAuditEvent({
          eventType: "goal_mode.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, tool, success: !result.isError },
        });
        return NextResponse.json({
          ok: true,
          data: {
            content: [{ type: "text", text: result.text }],
            ...(result.isError ? { isError: true } : {}),
          },
        });
      } catch {
        recordAuditEvent({
          eventType: "goal_mode.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, tool, success: false },
        });
        throw new ApiError(502, "goal_tool_failed", "Goal Mode could not update its state.");
      }
    }
    if (!decision.selectedConnections.includes(slug)) {
      throw new ApiError(
        403,
        "mcp_connection_denied",
        decision.selectedConnections.includes(MCP_INSTALLER_CONNECTION)
          ? 'That connection name is unavailable. Look up its exact slug with mcp-installer / list_installed.'
          : "That connection was not selected for this turn.",
      );
    }

    if (slug === MCP_INSTALLER_CONNECTION) {
      // YOLO (teamApproval, resolved server-side for this run) is the user's
      // standing approval: installs then run without a prompt.
      const result = await callMcpInstaller({
        userId: session.user_id, selectedConnections: decision.selectedConnections, tool, args, signal: request.signal,
        permissionGranted: permissionGranted || parseRuntimeRunDispatch(run).teamApproval === true,
      });
      if (result.installedSlug) {
        // Usable in this same turn; later turns pick it up from the saved row.
        persistCapabilityDecision(session.id, {
          ...decision,
          selectedConnections: [...new Set([...decision.selectedConnections, result.installedSlug])],
          createdAt: new Date().toISOString(),
        });
        recordAuditEvent({
          eventType: "mcp.installed_from_chat", runtimeSessionId: session.id,
          userId: session.user_id, gardenId: session.garden_id,
          payload: { runId: run.id, slug: result.installedSlug, repo: String(args.repo ?? "") },
        });
      }
      return NextResponse.json({ ok: true, data: result.data });
    }

    if (slug === WORKSPACE_CONNECTION) {
      const { callWorkspaceTool } = await import("@/lib/hermes/workspace-tools.ts");
      if (request.signal.aborted || getActiveRuntimeRun(session.id)?.id !== run.id)
        throw new ApiError(409,"workspace_request_cancelled","The chat stopped before the workspace operation started.");
      const data = callWorkspaceTool(ownerId, session.conversation_id, tool, args);
      recordAuditEvent({
        eventType: "mcp.tool_completed", runtimeSessionId: session.id, userId: ownerId,
        gardenId: session.garden_id, payload: { runId: run.id, provider: slug, tool, success: true },
      });
      return NextResponse.json({ ok: true, data });
    }

    if (slug === DOORY_CONNECTION) {
      const { callDooryMcp } = await import("@/lib/doory/server.ts");
      const data = await callDooryMcp(tool, args, request.signal);
      recordAuditEvent({
        eventType: "mcp.tool_completed", runtimeSessionId: session.id,
        userId: session.user_id, gardenId: session.garden_id,
        payload: { runId: run.id, provider: DOORY_CONNECTION, tool, success: (data as { isError?: boolean }).isError !== true },
      });
      return NextResponse.json({ ok: true, data });
    }

    if (slug === SPACES_PAGE_CONNECTION) {
      const { callSpacesPageTool } = await import("@/lib/spaces/page-bridge.ts");
      const data = await callSpacesPageTool({ userId: session.user_id, tool, args, signal: request.signal });
      recordAuditEvent({
        eventType: "mcp.tool_completed", runtimeSessionId: session.id,
        userId: session.user_id, gardenId: session.garden_id,
        payload: { runId: run.id, provider: SPACES_PAGE_CONNECTION, tool, success: (data as { isError?: boolean }).isError !== true },
      });
      return NextResponse.json({ ok: true, data });
    }

    if (slug === VIDEO_STUDIO_CONNECTION) {
      const { callVideoStudioTool } = await import("@/lib/timeline-studio/tools.ts");
      const data = await callVideoStudioTool({ userId: session.user_id, session, runId: run.id, tool, args, signal: request.signal });
      recordAuditEvent({
        eventType: "mcp.tool_completed", runtimeSessionId: session.id,
        userId: session.user_id, gardenId: session.garden_id,
        payload: { runId: run.id, provider: VIDEO_STUDIO_CONNECTION, tool, success: (data as { isError?: boolean }).isError !== true },
      });
      return NextResponse.json({ ok: true, data });
    }

    if (slug === API_ANYTHING_CONNECTION) {
      const data = await executeApiAnything({
        userId: session.user_id, scopeId: `${session.id}:${run.id}`, tool, args,
        permissionGranted, signal: request.signal,
      });
      if (data.approvalRequired) {
        // Reuse the native connected-action approval flow. The exact plan stays
        // in trusted host memory and is checked again by api-anything on retry.
        throw new ApiError(428, "connected_app_permission_required",
          `Approve this website action: ${JSON.stringify(data.preview)}. This may change data in the website account.`);
      }
      recordAuditEvent({
        eventType: "mcp.tool_completed", runtimeSessionId: session.id,
        userId: session.user_id, gardenId: session.garden_id,
        payload: { runId: run.id, provider: API_ANYTHING_CONNECTION, tool, success: data.ok === true,
          browserFallback: data.fallback?.recommended === true },
      });
      return NextResponse.json({ ok: true, data });
    }

    if (slug === COMPOSIO_RUNTIME_NAME) {
      if (tool === "__breadboard_list_tools") {
        // Discovery has exactly the same token, user, conversation, active-run
        // and selected-connection guards as execution. It never invokes an
        // action or grants write permission; execution below rechecks both.
        const connections = [...new Set(
          (await listComposioConnections(session.user_id, request.signal))
            .map(connection => connection.slug),
        )];
        const available = [
          ...nangoActionSummariesForConnections(connections),
          ...(await connectedAppToolSummaries(session.user_id, request.signal)),
        ];
        recordAuditEvent({
          eventType: "connected_app.tools_discovered",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, toolCount: available.length },
        });
        return NextResponse.json({
          ok: true,
          data: {
            connections,
            tools: available,
            instructions: connectedAppUsageInstructions(connections),
            writeApprovalRequired: true,
          },
        });
      }
      const appTool = nangoActionFor(tool)
        ? null
        : await connectedAppTool(session.user_id, tool, request.signal);
      const action = nangoActionFor(tool) ?? appTool;
      if (!action) {
        throw new ApiError(
          403,
          "connected_app_action_denied",
          "That connected-app action is not authorized.",
        );
      }
      if (!action.readOnly && !permissionGranted) {
        recordAuditEvent({
          eventType: "connected_app.action_permission_requested",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: {
            runId: run.id,
            action: action.name,
            connection: action.fixedConnectionSlug,
            risk: action.risk,
          },
        });
        throw new ApiError(
          428,
          "connected_app_permission_required",
          `${action.title} can change data in a connected account. Approve this exact action to continue.`,
        );
      }

      recordAuditEvent({
        eventType: "mcp.tool_started",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          connectionId: null,
          provider: "composio",
          slug,
          tool: action.name,
          risk: action.risk,
          approved: action.readOnly || permissionGranted,
        },
      });
      try {
        const data = appTool
          ? await executeConnectedAppTool({ userId: session.user_id, tool: appTool, args, signal: request.signal })
          : await executeComposioAction({
          userId: session.user_id,
          signal: request.signal,
          allowedGardenIds: verified.token.allowedGardenIds ?? (verified.token.activeGardenId ? [verified.token.activeGardenId] : []),
          action: action.name,
          args,
        });
        recordAuditEvent({
          eventType: "mcp.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: {
            runId: run.id,
            connectionId: null,
            provider: "composio",
            slug,
            tool: action.name,
            success: true,
          },
        });
        return NextResponse.json({ ok: true, data });
      } catch (error) {
        recordAuditEvent({
          eventType: "mcp.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: {
            runId: run.id,
            connectionId: null,
            provider: "composio",
            slug,
            tool: action.name,
            success: false,
          },
        });
        throw withFallback(error instanceof ApiError ? error : new ApiError(
          502,
          "connected_app_action_failed",
          "The connected-app action failed. Provider details were redacted.",
        ), slug);
      }
    }

    // The code index of the repository this session's Garden is connected to.
    // Breadboard-owned like Goal Mode and the connected apps: there is no saved
    // MCP row because nobody typed the command — it is derived from the
    // repository the user connected — and the slug is checked against that
    // repository, so a session cannot reach another repository's index by
    // naming its connection. Read-only by construction (graft answers
    // questions about code; it never edits it), so it needs no mode gate.
    if (isCodeIndexConnectionSlug(slug)) {
      const index = await codeIndexConnectionForSession({
        userId: session.user_id,
        gardenSlug: session.garden_id,
        slug,
      });
      if (!index) {
        throw new ApiError(
          409,
          "code_index_unavailable",
          "The repository's code index is not available for this session.",
        );
      }
      if (!index.tools.some((candidate) => candidate.name === tool)) {
        throw new ApiError(403, "mcp_tool_denied", "That MCP tool is not authorized.");
      }
      recordAuditEvent({
        eventType: "mcp.tool_started",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: { runId: run.id, connectionId: null, provider: "code-index", slug, tool },
      });
      try {
        const data = await callProxyMcpTool({
          userId: session.user_id,
          slug,
          tool,
          args,
          signal: request.signal,
        });
        recordAuditEvent({
          eventType: "mcp.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, connectionId: null, provider: "code-index", slug, tool, success: true },
        });
        return NextResponse.json({ ok: true, data });
      } catch {
        recordAuditEvent({
          eventType: "mcp.tool_completed",
          runtimeSessionId: session.id,
          userId: session.user_id,
          gardenId: session.garden_id,
          payload: { runId: run.id, connectionId: null, provider: "code-index", slug, tool, success: false },
        });
        // Said to the model, not just logged: a bare failure reads as
        // transient and gets retried until the turn's budget is gone.
        throw new ApiError(
          502,
          "code_index_failed",
          "The code index could not answer this call. Do not call the code index again this turn; answer from the connected_repository summary and say plainly what needed the code itself.",
        );
      }
    }

    const connection = listMcpConnections(session.user_id, true).find(
      (candidate) => candidate.slug === slug,
    );
    if (!connection || !getMcpConnection(session.user_id, connection.id)) {
      throw new ApiError(
        404,
        "mcp_not_available",
        "That connection is unavailable.",
      );
    }
    assertGuardedPrinterMcp(connection);
    const config = runtimeMcpConfig(connection);
    const statuses = await addProxyMcpConnection(
      session.user_id,
      slug,
      config,
    );
    if (statuses[slug]?.status !== "connected") {
      throw withFallback(new ApiError(
        409,
        "mcp_not_connected",
        "That connection is not connected.",
      ), slug);
    }
    const authoredHost = usesAuthoredMcpHost(connection);
    if (tool === "__breadboard_list_tools") {
      // Read-only discovery on the selected, same-user connection. Return
      // schemas only for actions the current capability mode can call; the
      // ordinary execution path below rechecks policy and declarations.
      const available = proxyMcpTools(session.user_id, slug).filter(candidate =>
        decision.mode === "scoped_implementation" ||
        (connectionToolAllowed(candidate.name) && (authoredHost || candidate.annotations?.destructiveHint !== true)),
      );
      return NextResponse.json({ ok: true, data: { tools: available } });
    }
    const declared = proxyMcpTools(session.user_id, slug).find(
      (candidate) => candidate.name === tool,
    );
    if (!declared) {
      throw new ApiError(
        403,
        "mcp_tool_denied",
        "That MCP tool is not authorized.",
      );
    }
    if (
      decision.mode !== "scoped_implementation" &&
      !connectionToolAllowed(tool)
    ) {
      throw new ApiError(
        403,
        "mcp_side_effect_denied",
        "This MCP operation requires scoped implementation mode.",
      );
    }
    if (authoredHost && (declared.annotations?.readOnlyHint !== true || declared.annotations?.openWorldHint) &&
        !permissionGranted && parseRuntimeRunDispatch(run).teamApproval !== true) {
      throw new ApiError(428, "connected_app_permission_required",
        declared.annotations?.openWorldHint ? `Allow ${connection.displayName} to call its configured API using ${tool}?` : `Allow ${tool} to change the private data saved by ${connection.displayName}?`);
    }
    if (
      declared.annotations?.destructiveHint === true &&
      !authoredHost &&
      decision.mode !== "scoped_implementation"
    ) {
      throw new ApiError(
        403,
        "mcp_side_effect_denied",
        "This MCP operation requires scoped implementation mode.",
      );
    }

    recordAuditEvent({
      eventType: "mcp.tool_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        connectionId: connection.id,
        provider: "mcp",
        slug,
        tool,
        destructive: declared.annotations?.destructiveHint === true,
      },
    });
    try {
      // A call that never reached the MCP server is retried with backoff when it
      // cannot write; anything else fails through to withFallback below.
      const callerId = session.user_id;
      const data = await retryTransient(() => callProxyMcpTool({
        userId: callerId,
        slug,
        tool,
        args,
        signal: request.signal,
      }), {
        idempotent: declared.annotations?.destructiveHint !== true && connectionToolAllowed(tool),
        isTransient: (error) =>
          error instanceof LocalMcpBrokerError && (error.code === "runtime_unavailable" || error.code === "unavailable"),
        signal: request.signal,
      });
      const toolFailed = data !== null && typeof data === "object" && (data as { isError?: unknown }).isError === true;
      recordAuditEvent({
        eventType: "mcp.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          connectionId: connection.id,
          provider: "mcp",
          slug,
          tool,
          success: !toolFailed,
        },
      });
      // A tool that answered with an error reached its server and failed there:
      // the result still goes back, carrying the same next move a thrown failure gets.
      if (toolFailed) {
        const fallback = withFallback(new ApiError(502, "mcp_tool_error", ""), slug).message.trim();
        if (fallback) return NextResponse.json({ ok: true, data: { ...(data as object), breadboardFallback: fallback } });
      }
      return NextResponse.json({ ok: true, data });
    } catch (error) {
      recordAuditEvent({
        eventType: "mcp.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          connectionId: connection.id,
          provider: "mcp",
          slug,
          tool,
          success: false,
        },
      });
      if (error instanceof LocalMcpBrokerError) {
        if (error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
          throw withFallback(new ApiError(503, error.code, error.message), slug);
        }
        if (error.code === "cancelled") {
          throw new ApiError(499, "mcp_tool_cancelled", "The MCP tool call was cancelled.");
        }
        if (error.code === "timeout") {
          throw withFallback(new ApiError(504, "mcp_tool_timeout", "The MCP tool did not finish in time."), slug);
        }
        if (error.code === "runtime_unavailable" || error.code === "unavailable") {
          throw withFallback(new ApiError(503, "mcp_runtime_unavailable", "The local MCP runtime is unavailable."), slug);
        }
      }
      throw withFallback(new ApiError(
        502,
        "mcp_tool_failed",
        "The MCP tool failed. Sensitive runtime details were redacted.",
      ), slug);
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
