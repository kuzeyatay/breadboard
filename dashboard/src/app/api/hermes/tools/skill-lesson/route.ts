// `skill_lesson` — recording what a reviewed skill got wrong on this machine.
//
// The counterpart of `skill_open`: that route hands a turn a skill's guidance,
// this one takes back the correction discovered while following it. The lesson
// is stored against the slug in Breadboard's own database and injected beside
// the skill's manifest from then on — never written into the skill's reviewed
// directory, whose hash has to keep verifying. See lib/hermes/skill-lessons.ts.
//
// It grants nothing. A lesson is prose stored against a slug; nothing about the
// turn's tools, roots, commands, credentials or connections changes because one
// was recorded, and nothing about the next turn's either.

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
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { listApprovedSkills } from "@/lib/hermes/skills.ts";
import { listFirstPartySkills } from "@/lib/hermes/skills.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";
import {
  normalizeLesson,
  normalizeSkillSlug,
  recordSkillLesson,
} from "@/lib/hermes/skill-lessons.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "skill_lesson";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(
      capabilityForInternalToolRequest(request),
    );
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(
        403,
        "skill_lesson_capability_denied",
        "Recording a skill lesson is not authorized for this turn.",
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
        "skill_lesson_session_scope_mismatch",
        "Skill lesson session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "skill_lesson_run_required",
        "Recording a lesson requires a current chat run.",
      );
    }

    const body = await readJsonBody(request, 8 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const slug = normalizeSkillSlug(args.slug);
    if (!slug) {
      throw new ApiError(400, "skill_lesson_slug_required", "A skill slug is required.");
    }
    const lesson = normalizeLesson(args.lesson);
    if (!lesson) {
      throw new ApiError(
        400,
        "skill_lesson_text_required",
        "A lesson is required, written as one self-contained sentence.",
      );
    }

    // A lesson must belong to a skill the user actually has. Without this the
    // table becomes a free-text store the model can write anything into under
    // any key, which is a different and much larger thing than what this is.
    const connected = listMcpConnections(session.user_id, true).map(
      (connection) => connection.slug,
    );
    const known =
      listApprovedSkills(session.surface, connected).some(
        (candidate) => candidate.slug === slug,
      ) ||
      listFirstPartySkills(session.surface, connected).some(
        (candidate) => candidate.slug === slug,
      );
    if (!known) {
      throw new ApiError(
        404,
        "skill_lesson_unknown_skill",
        "That skill is not installed, so there is nothing to attach a lesson to.",
      );
    }

    const saved = recordSkillLesson({
      userId: session.user_id,
      skillSlug: slug,
      lesson,
      conversationId: session.conversation_id,
    });

    recordAuditEvent({
      eventType: "skill.lesson.recorded",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, slug, saved: Boolean(saved), tool: TOOL },
    });

    if (!saved) {
      return NextResponse.json({
        ok: true,
        data: { saved: false, reason: "The lesson was empty after normalization." },
      });
    }
    return NextResponse.json({
      ok: true,
      data: {
        saved: true,
        id: saved.id,
        slug: saved.skillSlug,
        lesson: saved.lesson,
        note: "This will be shown with the skill's guidance from now on. The user can read and delete it in Settings.",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
