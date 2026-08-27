import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";

import { NextResponse } from "next/server";

import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { directoryForWorkspaceKey } from "@/lib/hermes/workspace.ts";
import { WORKSPACE_TOOLS, WORKSPACE_WRITE_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  WorkspaceFileError,
  listWorkspaceFiles,
  patchWorkspaceFile,
  readWorkspaceFile,
  searchWorkspaceFiles,
  writeWorkspaceFile,
} from "@/lib/hermes/workspace-files.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `workspace_*` tools — the
 * read/write/patch/list/search loop, confined to the session's own workspace.
 *
 * Three things bound it, in this order:
 *
 *   * The capability token pins the user, surface and conversation, exactly as
 *     it does for every other Breadboard tool.
 *   * The turn's capability decision is revalidated here, so a tool the turn was
 *     not granted is refused at the data boundary and not only at the runtime.
 *   * Every path is resolved against `directoryForWorkspaceKey` — the same root
 *     `agent_loop_run` works in, and the directory the runtime already uses as
 *     its cwd — and refused if it escapes or names a reserved directory.
 *
 * The third is the point of the whole family. Hermes has these verbs already;
 * its versions accept absolute paths and enforce no root, which is why they stay
 * out of `enabled_toolsets` and these stand in for them.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 512 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!WORKSPACE_TOOLS.includes(toolName as (typeof WORKSPACE_TOOLS)[number])) {
      throw new ApiError(400, "workspace_unknown_tool", "Unknown workspace tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "workspace_capability_denied", "Workspace file tools are not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "workspace_session_scope_mismatch", "Workspace session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "workspace_tool_not_granted",
        "Workspace file tools are not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const workspace = directoryForWorkspaceKey(readHermesConfig(), session.workspace_key);
    // Session creation makes this directory, but a session restored after the
    // runtime root moved would otherwise fail containment on its first write
    // rather than on something the model can act on.
    fs.mkdirSync(workspace, { recursive: true });

    let data: unknown;
    if (toolName === "workspace_read") data = readWorkspaceFile(workspace, args);
    else if (toolName === "workspace_write") data = writeWorkspaceFile(workspace, args);
    else if (toolName === "workspace_patch") data = patchWorkspaceFile(workspace, args);
    else if (toolName === "workspace_list") data = listWorkspaceFiles(workspace, args);
    else data = searchWorkspaceFiles(workspace, args);

    recordAuditEvent({
      eventType: "workspace.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      // The path is the part worth being able to find later; the contents are
      // never written to the audit trail.
      payload: {
        tool: toolName,
        write: WORKSPACE_WRITE_TOOLS.includes(toolName),
        path: typeof args.path === "string" ? args.path.slice(0, 200) : "",
      },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "workspace.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason:
            error instanceof WorkspaceFileError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "workspace_tool_failed",
        },
      });
    }
    if (error instanceof WorkspaceFileError) {
      // "`find` appears 3 times in main.py" already says what to fix, so it is
      // passed through rather than reduced to a status the model can only retry
      // against.
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
