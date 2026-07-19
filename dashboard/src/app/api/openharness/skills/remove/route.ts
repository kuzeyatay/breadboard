import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/openharness/route-helpers.ts";
import { removeApprovedSkill } from "@/lib/openharness/skills.ts";
import { getSkillsCatalogStore } from "@/lib/openharness/skills-catalog-store.ts";
import { recordAuditEvent, recordSkillDecision } from "@/lib/openharness/runtime-store.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const upstreamId = requireString(body.upstreamId ?? body.id, "upstreamId", 500);
    const store = getSkillsCatalogStore();
    const skill = store.get(upstreamId);
    if (!skill || skill.installationStatus !== "installed" || !skill.installedPath) {
      throw new ApiError(404, "installed_skill_not_found", "That skill is not installed.");
    }
    const storageKey = skill.installedPath.split(/[\\/]/).pop();
    if (!storageKey) throw new ApiError(409, "installed_skill_path_invalid", "The installed skill path is invalid.");
    removeApprovedSkill(storageKey);
    store.markRemoved(upstreamId);
    recordSkillDecision({ skillName: storageKey, sourceUrl: skill.source, version: skill.approvedHash ?? undefined, decision: "rejected", decidedBy: userId, notes: "The previously approved installation was explicitly removed by the user." });
    recordAuditEvent({ eventType: "skill.removed", userId, payload: { upstreamId, approvedHash: skill.approvedHash } });
    return NextResponse.json({ upstreamId, status: "removed" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
