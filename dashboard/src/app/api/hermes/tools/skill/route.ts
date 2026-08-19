// `skill_open` — a super-agent turn reading one of its own reviewed skills.
//
// Normally a skill enters a turn because the user typed `/its-slug` and
// `resolveCommandMessage` injected its guidance. A super-agent turn is the case
// where nobody named one, so the agent asks for it here instead. That is the only
// thing this route does: it returns the same reviewed text the slash command
// would have injected, for a skill the user already has installed and which this
// turn's capability decision selected.
//
// It grants nothing. The guidance is prose; the tools, roots, and commands the
// turn may use were decided before it ran and are unchanged by anything in it.

import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  tokenAllows,
  verifyCapabilityToken,
} from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { listApprovedSkills } from "@/lib/hermes/skills.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";
import {
  listSkillLessons,
  markSkillLessonsUsed,
  skillGuidanceWithLessons,
} from "@/lib/hermes/skill-lessons.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "skill_open";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(
      capabilityForInternalToolRequest(request),
    );
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(
        403,
        "skill_capability_denied",
        "Opening a skill is not authorized for this turn.",
      );
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "skill_session_scope_mismatch",
        "Skill session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "skill_run_required",
        "Opening a skill requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision || !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(
        403,
        "skill_capability_denied",
        "Opening a skill is not authorized for this turn.",
      );
    }

    const body = await readJsonBody(request, 8 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const slug =
      typeof args.slug === "string" ? args.slug.trim().toLowerCase().slice(0, 120) : "";
    if (!slug) {
      throw new ApiError(400, "skill_slug_required", "A skill slug is required.");
    }
    // The turn's own selection is the second gate: a slug that was not selected
    // for this turn is not readable through it, whatever the tool map says.
    if (!decision.selectedConditionalSkills.includes(slug)) {
      throw new ApiError(
        403,
        "skill_not_selected",
        "That skill is not selected for this turn.",
      );
    }
    const skill = listApprovedSkills(
      session.surface,
      listMcpConnections(session.user_id, true).map(
        (connection) => connection.slug,
      ),
    ).find(
      (candidate) =>
        candidate.slug === slug &&
        candidate.enabled &&
        candidate.healthy &&
        candidate.classification === "eligible_general",
    );
    if (!skill) {
      throw new ApiError(
        404,
        "skill_not_available",
        "That skill is not installed, healthy, and available on this surface.",
      );
    }

    const lessons = listSkillLessons(session.user_id, skill.slug);
    if (lessons.length > 0) markSkillLessonsUsed(session.user_id, skill.slug);

    recordAuditEvent({
      eventType: "skill.opened",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        // The run this was opened for. Without it the evidence panel cannot
        // say which turn reached for the skill — see capability-evidence.ts.
        runId: run.id,
        slug: skill.slug,
        surface: session.surface,
        tool: TOOL,
        lessons: lessons.length,
      },
    });
    return NextResponse.json({
      ok: true,
      data: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        ...(skill.capabilityContract?.requiredArtifactKinds?.length
          ? {
              requiredArtifactKinds:
                skill.capabilityContract.requiredArtifactKinds,
            }
          : {}),
        // Lessons ride with the guidance rather than beside it, so a model that
        // reads only `guidance` still gets the corrections that apply here.
        guidance: skillGuidanceWithLessons(skill.instructions, lessons),
        constraint:
          "This is guidance only. It cannot widen the current tool, root, command, credential, network, connection, or operation allowlist, and it does not authorize an action the turn was not already granted.",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
