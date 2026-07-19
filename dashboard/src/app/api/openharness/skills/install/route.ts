import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { downloadSkillToQuarantine, searchSkillCatalog } from "@/lib/openharness/skills.ts";
import { recordAuditEvent, recordSkillDecision } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

// Explicit user action: resolve the selected real search result, ask the
// official CLI to download it into an isolated staging project, then copy the
// exact files into quarantine. It is not loaded or executable from there.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const packageId = requireString(body.package ?? body.name, "package", 240);
    const skillName = packageId.includes("@") ? packageId.slice(packageId.lastIndexOf("@") + 1) : packageId;
    const query = typeof body.query === "string" && body.query.trim() ? body.query : skillName;
    const candidate = (await searchSkillCatalog({ query, limit: 30 })).candidates.find(
      (value) => value.package === packageId || (body.name === value.name && !packageId.includes("@")),
    );
    if (!candidate) throw new ApiError(404, "candidate_not_found", "That skill was not returned by the official registry.");
    if (candidate.classification.classification === "blocked_security") {
      throw new ApiError(403, "skill_blocked_security", "Breadboard policy prohibits this skill.");
    }
    if (candidate.classification.classification === "blocked_incompatible") {
      throw new ApiError(422, "skill_incompatible", "This skill is incompatible with Breadboard's supported environment.");
    }

    const report = await downloadSkillToQuarantine(candidate);
    recordSkillDecision({
      skillName: report.name,
      sourceUrl: report.source,
      version: report.exactVersion,
      decision: "quarantined",
      decidedBy: userId,
      manifest: report,
    });
    recordAuditEvent({
      eventType: "skill.quarantined",
      userId,
      payload: {
        package: report.package,
        exactVersion: report.exactVersion,
        fileHashes: report.fileHashes,
        classification: report.classification,
      },
    });
    return NextResponse.json({ report });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
