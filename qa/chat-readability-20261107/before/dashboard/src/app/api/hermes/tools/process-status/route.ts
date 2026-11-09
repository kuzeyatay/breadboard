import { NextResponse } from "next/server";

import db from "@/lib/db.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { PROCESS_STATUS_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  PROCESS_KINDS,
  collectProcessStatus,
  resolveGardens,
  summarizeProcessStatus,
  type GardenMatch,
  type ProcessKind,
} from "@/lib/hermes/process-status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "breadboard_process_status";
const MAX_GARDEN_QUERY_CHARS = 120;
const MAX_LIMIT = 120;
const MAX_LOOKBACK_HOURS = 24 * 14;

function kindsArgument(value: unknown): ProcessKind[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const kinds = list.filter(
    (entry): entry is ProcessKind =>
      typeof entry === "string" && (PROCESS_KINDS as readonly string[]).includes(entry),
  );
  if (kinds.length !== list.length) {
    throw new ApiError(
      400,
      "process_status_invalid_kind",
      `Process kinds must be among: ${PROCESS_KINDS.join(", ")}.`,
    );
  }
  return kinds.length > 0 ? [...new Set(kinds)] : undefined;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  code: string,
  label: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new ApiError(400, code, `${label} must be an integer from 1 to ${maximum}.`);
  }
  return Number(value);
}

/**
 * Internal, capability-scoped endpoint behind `breadboard_process_status`:
 * what Breadboard is doing for the signed-in person right now — uploads,
 * Learn runs, transcriptions, agent runs, schedules — read from the same
 * stores the product's own panels read, never from the model's memory.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(
        403,
        "process_status_capability_denied",
        "Process status is not authorized.",
      );
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId
    ) {
      throw new ApiError(
        403,
        "process_status_session_scope_mismatch",
        "Process status session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(
        403,
        "process_status_tool_not_granted",
        "Process status is not available on this turn.",
      );
    }

    const body = await readJsonBody(request, 16 * 1024);
    const toolName = typeof body.tool === "string" ? body.tool : "";
    if (!(PROCESS_STATUS_TOOLS as readonly string[]).includes(toolName)) {
      throw new ApiError(400, "process_status_unknown_tool", "Unknown process-status tool.");
    }
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};

    const gardenQuery = typeof args.garden === "string"
      ? args.garden.trim().slice(0, MAX_GARDEN_QUERY_CHARS)
      : "";
    const everyGarden = args.all_gardens === true || gardenQuery.toLowerCase() === "all";
    const kinds = kindsArgument(args.kinds);
    const limit = boundedInteger(args.limit, 40, MAX_LIMIT, "process_status_invalid_limit", "limit");
    const lookbackHours = boundedInteger(
      args.lookback_hours,
      24,
      MAX_LOOKBACK_HOURS,
      "process_status_invalid_lookback",
      "lookback_hours",
    );

    // Scope: a named Garden wins; otherwise a Garden Chat looks at its own
    // Garden, and the Terminal (or an explicit "all") looks at everything.
    let gardens: GardenMatch[] | null = null;
    let unresolvedGarden: string | null = null;
    if (gardenQuery && !everyGarden) {
      gardens = resolveGardens(db, session.user_id, gardenQuery);
      if (gardens.length === 0) unresolvedGarden = gardenQuery;
    } else if (!everyGarden && session.surface === "garden_chat" && session.garden_id) {
      gardens = resolveGardens(db, session.user_id, session.garden_id);
      if (gardens.length === 0) gardens = null;
    }

    const report = collectProcessStatus({
      database: db,
      userId: session.user_id,
      gardens,
      kinds,
      limit,
      lookbackHours,
    });

    recordAuditEvent({
      runtimeSessionId: session.id,
      eventType: "tool.process_status",
      payload: {
        gardens: report.gardens.map((garden) => garden.slug),
        kinds: kinds ?? "all",
        returned: report.processes.length,
        unavailable: report.unavailable,
      },
    });

    const summary = unresolvedGarden
      ? `No Garden of yours matches “${unresolvedGarden}”. Your Gardens: ${
          resolveGardens(db, session.user_id, null).map((garden) => garden.name).join(", ") || "none"
        }.`
      : summarizeProcessStatus(report);

    return NextResponse.json({
      ok: true,
      summary,
      scope: {
        gardens: report.gardens.map((garden) => ({ slug: garden.slug, name: garden.name })),
        allGardens: gardens === null,
        lookbackHours,
        unresolvedGarden,
      },
      counts: report.counts,
      unavailable: report.unavailable,
      processes: unresolvedGarden ? [] : report.processes,
      generatedAt: report.generatedAt,
    });
  } catch (error) {
    if (runtimeSessionId !== null && !(error instanceof ApiError)) {
      recordAuditEvent({
        runtimeSessionId,
        eventType: "tool.process_status.error",
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    }
    return apiErrorResponse(error);
  }
}
