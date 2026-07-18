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
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { appendRuntimeMessage, recordAuditEvent } from "@/lib/openharness/runtime-store.ts";
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

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
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

    const context = (body.context && typeof body.context === "object" ? body.context : {}) as {
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

    // Access control + rate limiting (public readers).
    const { cluster } = authorizeQuartzAccess(gardenId, userId);
    if (userId === null) enforceRateLimit(`${clientIp(request)}:${gardenId}`);
    const pageContext = await assembleQuartzContext(cluster, pageSlug, context.graph);
    const systemContext = quartzSystemContext(pageContext, context.selectedText);

    const existingSessionId = Number(body.sessionId);
    const clientToken = typeof body.clientToken === "string" ? body.clientToken : null;

    if (Number.isInteger(existingSessionId) && existingSessionId > 0) {
      // Continue an existing page session.
      const session = authorizeQuartzRuntimeSession(existingSessionId, { userId, clientToken });
      if (session.row.garden_id !== gardenId || session.row.page_slug !== pageSlug) {
        return NextResponse.json({ error: "Session context does not match this page." }, { status: 404, headers: cors });
      }
      if (prepareOnly) {
        return NextResponse.json({ sessionId: session.row.id, clientToken, prepared: true }, { headers: cors });
      }
      appendRuntimeMessage({ runtimeSessionId: session.row.id, role: "user", content: text });
      markStatus(session, "busy");
      recordAuditEvent({
        eventType: "message.submitted",
        runtimeSessionId: session.row.id,
        userId,
        gardenId,
        payload: { surface: "quartz_ai", pageSlug, hasSelection: Boolean(context.selectedText), hasGraph: Boolean(context.graph) },
      });
      await getOpenHarnessGateway().sendMessage({
        openHarnessSessionId: session.openHarnessSessionId,
        workspaceKey: session.workspaceKey,
        agentName: session.agentName,
        text,
        system: systemContext,
      });
      return NextResponse.json({ sessionId: session.row.id, accepted: true }, { headers: cors });
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
        { sessionId: created.row.id, clientToken: issuedClientToken, prepared: true },
        { headers: cors },
      );
    }

    appendRuntimeMessage({ runtimeSessionId: created.row.id, role: "user", content: text });
    markStatus(created, "busy");
    recordAuditEvent({
      eventType: "message.submitted",
      runtimeSessionId: created.row.id,
      userId,
      gardenId,
      payload: { surface: "quartz_ai", pageSlug, hasSelection: Boolean(context.selectedText), hasGraph: Boolean(context.graph) },
    });
    await getOpenHarnessGateway().sendMessage({
      openHarnessSessionId: created.openHarnessSessionId,
      workspaceKey: created.workspaceKey,
      agentName: created.agentName,
      text,
      system: systemContext,
    });

    return NextResponse.json(
      { sessionId: created.row.id, clientToken: issuedClientToken, accepted: true },
      { headers: cors },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
