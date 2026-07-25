import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/openharness/route-helpers.ts";
import {
  createSessionForSurface,
  authorizeQuartzRuntimeSession,
  markStatus,
} from "@/lib/openharness/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import {
  appendRuntimeMessage,
  persistCapabilityDecision,
  recordAuditEvent,
} from "@/lib/openharness/runtime-store.ts";
import {
  authorizeQuartzAccess,
  assembleQuartzContext,
  corsHeaders,
  enforceRateLimit,
  clientIp,
  newClientToken,
  quartzSystemContext,
  type QuartzGraphInput,
} from "@/lib/openharness/quartz-support.ts";
import { resolveCommandMessage } from "@/lib/openharness/commands.ts";
import { resolveOpenHarnessEngine } from "@/lib/openharness/model-selection.ts";
import { prepareTurn, mergeSelectedTools } from "@/lib/openharness/dispatch-core.ts";
import { listFilesystemGrants } from "@/lib/openharness/filesystem-grant-store.ts";
import { composeOpenHarnessSystemPrompt } from "@/lib/openharness/system-prompts.ts";
import {
  createConversation,
  getConversationById,
  getConversationForUser,
} from "@/lib/conversations/store.ts";
import { startConversationTurn } from "@/lib/conversations/turn-service.ts";
import { getRuntimeSessionById } from "@/lib/openharness/runtime-store.ts";
import { resolveConversationRuntime } from "@/lib/openharness/session-service.ts";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

// POST: send a message from the Quartz page AI panel. The browser talks only to
// this dashboard endpoint (never OpenHarness). On the first turn it creates a
// page-scoped quartz_ai runtime session (anonymous readers get a client token
// that binds the session to their browser) and enriches it with authorized page
// context. Read-only by default; any write is a proposal via garden tools.
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    requireEnabled();
    const userId = await optionalUserId();
    const body = await readJsonBody(request);

    const context = (
      body.context && typeof body.context === "object" ? body.context : {}
    ) as {
      gardenId?: string;
      pageSlug?: string;
      pageTitle?: string;
      selectedText?: string;
      graph?: QuartzGraphInput;
    };
    const gardenId = requireString(context.gardenId, "context.gardenId", 200);
    const pageSlug = requireString(context.pageSlug, "context.pageSlug", 400);
    const text = requireString(body.text, "text", 20_000);
    const prepareOnly = body.prepareOnly === true;
    // Same server-owned engine resolution as the terminal: the provider is
    // fixed and unknown model/effort values are rejected with a 400.
    const engine = resolveOpenHarnessEngine(body.model, body.reasoningEffort);

    // Access control + rate limiting (public readers).
    const { cluster } = authorizeQuartzAccess(gardenId, userId);
    if (userId === null) enforceRateLimit(`${clientIp(request)}:${gardenId}`);
    const pageContext = await assembleQuartzContext(
      cluster,
      pageSlug,
      context.graph,
    );
    const systemContext = quartzSystemContext(
      pageContext,
      context.selectedText,
    );

    // Signed-in Quartz uses the same canonical conversation and runtime as the
    // Terminal and Garden Chat. Anonymous readers continue below on their
    // browser-token-bound, public-only runtime and never touch private memory.
    if (userId !== null) {
      const suppliedConversationId = typeof body.sessionId === "string" ? body.sessionId : null;
      let conversation = suppliedConversationId?.startsWith("conv_")
        ? getConversationForUser(suppliedConversationId, userId)
        : null;
      if (!conversation && Number.isInteger(Number(body.sessionId)) && Number(body.sessionId) > 0) {
        const legacy = getRuntimeSessionById(Number(body.sessionId));
        if (legacy?.user_id === userId && legacy.conversation_id !== null) {
          conversation = getConversationById(legacy.conversation_id);
        }
      }
      conversation ??= createConversation({
        userId,
        title: context.pageTitle ?? pageSlug,
        surface: "quartz_ai",
        scopeKind: "page",
        defaultGardenId: cluster.id,
      });

      if (prepareOnly) {
        await resolveConversationRuntime({
          conversation,
          surface: "quartz_ai",
          activeGardenSlug: gardenId,
          activePageSlug: pageSlug,
        });
        return NextResponse.json(
          { sessionId: conversation.public_id, clientToken: null, prepared: true },
          { headers: cors },
        );
      }
      const clientMessageId = requireString(body.clientMessageId, "clientMessageId", 128);
      const result = await startConversationTurn({
        conversation,
        clientMessageId,
        text,
        surface: "quartz_ai",
        surfaceContext: {
          activeGardenSlug: gardenId,
          activePageSlug: pageSlug,
          pageTitle: context.pageTitle,
          selectedText: context.selectedText,
          graphContext: context.graph,
          authorizedContext: systemContext,
        },
        model: body.model,
        reasoningEffort: body.reasoningEffort,
        retry: body.retry === true,
      });
      return NextResponse.json(
        {
          sessionId: conversation.public_id,
          accepted: result.accepted,
          ...(!result.accepted && "blocked" in result
            ? { blocked: true, pendingPermissions: result.pendingPermissions }
            : {}),
        },
        { headers: cors },
      );
    }

    const existingSessionId = Number(body.sessionId);
    const clientToken =
      typeof body.clientToken === "string" ? body.clientToken : null;

    if (Number.isInteger(existingSessionId) && existingSessionId > 0) {
      // Continue an existing page session.
      const session = authorizeQuartzRuntimeSession(existingSessionId, {
        userId,
        clientToken,
      });
      if (
        session.row.garden_id !== gardenId ||
        session.row.page_slug !== pageSlug
      ) {
        return NextResponse.json(
          { error: "Session context does not match this page." },
          { status: 404, headers: cors },
        );
      }
      if (prepareOnly) {
        return NextResponse.json(
          { sessionId: session.row.id, clientToken, prepared: true },
          { headers: cors },
        );
      }
      const prepared = prepareTurn({
        request: text,
        surface: "quartz_ai",
        userId,
        // Anonymous readers have no grants and are isolated; an authenticated
        // reader gets the same capability here as on any other surface.
        grants: userId === null ? [] : listFilesystemGrants(userId),
        workspaceRoot: session.activeDirectory,
        isolated: userId === null,
      });
      const decision = prepared.decision;
      const resolved = await resolveCommandMessage(
        userId,
        text,
        session.activeDirectory,
        {
          mode: decision.mode,
          surface: "quartz_ai",
          runtimeKind: session.runtimeKind,
        },
      );
      appendRuntimeMessage({
        runtimeSessionId: session.row.id,
        role: "user",
        content: text,
      });
      const runtime = getAgentRuntimeByKind(session.runtimeKind);
      await runtime.applyCapabilityDecision({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        decision,
      });
      const storedDecision = persistCapabilityDecision(session.row.id, decision);
      recordAuditEvent({
        eventType: "capability.decision",
        runtimeSessionId: session.row.id,
        userId,
        gardenId,
        payload: {
          decisionId: storedDecision.id,
          mode: "knowledge",
          implementationRequired: false,
          decisionReason: decision.decisionReason,
          decisionSource: decision.decisionSource,
        },
      });
      markStatus(session, "busy");
      recordAuditEvent({
        eventType: "message.submitted",
        runtimeSessionId: session.row.id,
        userId,
        gardenId,
        payload: {
          surface: "quartz_ai",
          pageSlug,
          hasSelection: Boolean(context.selectedText),
          hasGraph: Boolean(context.graph),
          commands: resolved.invocations,
          modelId: engine.model.modelID,
          reasoningEffort: engine.variant,
          capabilityDecisionId: storedDecision.id,
          capabilityMode: decision.mode,
        },
      });
      await runtime.startRun({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        agentName: session.agentName,
        text: resolved.text,
        // The brokered map is authoritative; a selector may only narrow it.
        tools: mergeSelectedTools(prepared.grant.allowedTools, resolved.tools),
        system: composeOpenHarnessSystemPrompt({
          surface: "quartz_ai",
          decision,
          additional: systemContext,
        }),
        model: engine.model,
        variant: engine.variant,
      });
      return NextResponse.json(
        { sessionId: session.row.id, accepted: true },
        { headers: cors },
      );
    }

    // First turn: create a page-scoped session enriched with authorized context.
    const issuedClientToken = userId === null ? newClientToken() : null;
    const created = await createSessionForSurface({
      userId,
      surface: "quartz_ai",
      title: context.pageTitle ?? pageSlug,
      gardenSlug: gardenId,
      pageSlug,
      clientToken: issuedClientToken,
    });

    if (prepareOnly) {
      return NextResponse.json(
        {
          sessionId: created.row.id,
          clientToken: issuedClientToken,
          prepared: true,
        },
        { headers: cors },
      );
    }

    const prepared = prepareTurn({
      request: text,
      surface: "quartz_ai",
      userId,
      // Anonymous readers have no grants and are isolated; an authenticated
      // reader gets the same capability here as on any other surface.
      grants: userId === null ? [] : listFilesystemGrants(userId),
      workspaceRoot: created.activeDirectory,
      isolated: userId === null,
    });
    const decision = prepared.decision;
    const resolved = await resolveCommandMessage(
      userId,
      text,
      created.activeDirectory,
      {
        mode: decision.mode,
        surface: "quartz_ai",
        runtimeKind: created.runtimeKind,
      },
    );
    appendRuntimeMessage({
      runtimeSessionId: created.row.id,
      role: "user",
      content: text,
    });
    const runtime = getAgentRuntimeByKind(created.runtimeKind);
    await runtime.applyCapabilityDecision({
      externalSessionId: created.externalSessionId,
      liveSessionId: created.liveSessionId,
      workspaceKey: created.workspaceKey,
      directory: created.activeDirectory,
      decision,
    });
    const storedDecision = persistCapabilityDecision(created.row.id, decision);
    recordAuditEvent({
      eventType: "capability.decision",
      runtimeSessionId: created.row.id,
      userId,
      gardenId,
      payload: {
        decisionId: storedDecision.id,
        mode: "knowledge",
        implementationRequired: false,
        decisionReason: decision.decisionReason,
        decisionSource: decision.decisionSource,
      },
    });
    markStatus(created, "busy");
    recordAuditEvent({
      eventType: "message.submitted",
      runtimeSessionId: created.row.id,
      userId,
      gardenId,
      payload: {
        surface: "quartz_ai",
        pageSlug,
        hasSelection: Boolean(context.selectedText),
        hasGraph: Boolean(context.graph),
        commands: resolved.invocations,
        modelId: engine.model.modelID,
        reasoningEffort: engine.variant,
        capabilityDecisionId: storedDecision.id,
        capabilityMode: decision.mode,
      },
    });
    await runtime.startRun({
      externalSessionId: created.externalSessionId,
      liveSessionId: created.liveSessionId,
      workspaceKey: created.workspaceKey,
      directory: created.activeDirectory,
      agentName: created.agentName,
      text: resolved.text,
      // The brokered map is authoritative; a selector may only narrow it.
        tools: mergeSelectedTools(prepared.grant.allowedTools, resolved.tools),
      system: composeOpenHarnessSystemPrompt({
        surface: "quartz_ai",
        decision,
        additional: systemContext,
      }),
      model: engine.model,
      variant: engine.variant,
    });

    return NextResponse.json(
      {
        sessionId: created.row.id,
        clientToken: issuedClientToken,
        accepted: true,
      },
      { headers: cors },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors))
      response.headers.set(key, value);
    return response;
  }
}
