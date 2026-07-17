import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { promoteSkill, rejectQuarantine, inspectQuarantine } from "@/lib/openharness/skills.ts";
import { recordSkillDecision } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

// POST: after the user reviews a quarantined skill, either promote it into the
// approved skills dir or reject (delete) it. Promotion is the ONLY path from
// quarantine to an agent-usable skill, and it is explicit and human-approved.
// Records an auditable decision. Never executes the skill.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const name = requireString(body.name, "name", 100);
    const decision = body.decision === "promote" ? "promote" : body.decision === "reject" ? "reject" : null;
    if (!decision) throw new ApiError(400, "invalid_decision", "decision must be promote or reject.");

    if (decision === "reject") {
      rejectQuarantine(name);
      recordSkillDecision({ skillName: name, decision: "rejected", decidedBy: userId });
      return NextResponse.json({ name, status: "rejected" });
    }

    // Re-inspect before promoting so the decision reflects the current state.
    const report = inspectQuarantine(name);
    if (!report.hasSkillMd) {
      throw new ApiError(422, "invalid_skill", "Refusing to promote a skill without a valid SKILL.md.");
    }
    const result = promoteSkill(name, { overwrite: Boolean(body.overwrite) });
    recordSkillDecision({
      skillName: report.name,
      decision: "promoted",
      decidedBy: userId,
      manifest: report,
      notes: `Promoted to ${result.promotedPath}`,
    });
    return NextResponse.json({ name: report.name, status: "promoted" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
