import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import {
  promoteSkill,
  rejectQuarantine,
  inspectQuarantine,
  canonicalSkillHash,
  type SkillAvailableEvent,
  type SkillPermission,
} from "@/lib/openharness/skills.ts";
import { getSkillsCatalogStore } from "@/lib/openharness/skills-catalog-store.ts";
import {
  getLatestCapabilityGap,
  recordAuditEvent,
  recordSkillDecision,
} from "@/lib/openharness/runtime-store.ts";
import { authorizeRuntimeReference } from "@/lib/openharness/session-service.ts";

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
      const report = inspectQuarantine(name);
      rejectQuarantine(name);
      if (report.upstreamId) {
        const store = getSkillsCatalogStore();
        const existing = store.get(report.upstreamId);
        if (existing && existing.installationStatus !== "installed") store.markRemoved(report.upstreamId);
      }
      recordSkillDecision({ skillName: name, decision: "rejected", decidedBy: userId });
      recordAuditEvent({ eventType: "skill.rejected", userId, payload: { name } });
      return NextResponse.json({ name, status: "rejected" });
    }

    // Re-inspect before promoting so the decision reflects the current state.
    const report = inspectQuarantine(name);
    if (!report.hasSkillMd) {
      throw new ApiError(422, "invalid_skill", "Refusing to promote a skill without a valid SKILL.md.");
    }
    const approvedPermissions = Array.isArray(body.approvedPermissions)
      ? body.approvedPermissions.filter((value): value is SkillPermission =>
          typeof value === "string" && report.requestedPermissions.includes(value as SkillPermission),
        )
      : [];
    let runtimeSessionId: number | null = null;
    let capabilityGap: Record<string, unknown> | null = null;
    if (body.runtimeSessionId !== null && body.runtimeSessionId !== undefined) {
      const runtime = authorizeRuntimeReference(userId, body.runtimeSessionId);
      runtimeSessionId = runtime.row.id;
      if (runtime.row.surface !== "dashboard_terminal") {
        throw new ApiError(403, "invalid_parent_session", "Skills can resume only an authenticated Assistant task.");
      }
      capabilityGap = getLatestCapabilityGap(runtime.row.id);
    }
    // Third-party promoted skills are attached only to the permissioned terminal
    // profile. Garden, Quartz, document, and scout profiles explicitly deny
    // dynamic skill execution.
    if (body.classificationOverride === "eligible_coding_conditional") {
      throw new ApiError(
        409,
        "skill_incompatible_coding",
        "Coding and repository-engineering skills cannot be promoted into Breadboard's user-facing skills product.",
      );
    }
    if (report.classification.classification === "eligible_coding_conditional") {
      throw new ApiError(
        409,
        "skill_incompatible_coding",
        "This skill is coding-oriented and cannot be promoted into Breadboard's user-facing skills product.",
      );
    }
    const classificationOverride = body.classificationOverride === "eligible_general"
      ? "eligible_general" as const
      : undefined;
    const approvedAgents = [
      "breadboard-assistant",
      "breadboard-garden",
      "breadboard-document",
    ];
    const store = getSkillsCatalogStore();
    const catalogSkill = report.upstreamId ? store.get(report.upstreamId) : null;
    const isApprovedUpdate = Boolean(
      catalogSkill?.approvedHash &&
      report.exactVersion &&
      catalogSkill.approvedHash !== report.exactVersion,
    );
    const result = promoteSkill(name, {
      overwrite: Boolean(body.overwrite) || isApprovedUpdate,
      approvedAgents,
      approvedPermissions,
      classificationOverride,
      reviewer: userId,
    });
    if (report.upstreamId && report.exactVersion) {
      store.markInstalled({
        upstreamId: report.upstreamId,
        approvedHash: report.exactVersion,
        localHash: canonicalSkillHash(result.report.fileHashes),
        installedPath: result.promotedPath,
      });
    }
    recordSkillDecision({
      skillName: report.name,
      decision: "promoted",
      decidedBy: userId,
      manifest: result.report,
      notes: "Exact reviewed hashes verified and promoted to the approved registry.",
    });
    let continuation: SkillAvailableEvent | null = null;
    if (capabilityGap && typeof capabilityGap.taskId === "string" && typeof capabilityGap.requestedCapability === "string") {
        continuation = {
          parentTaskId: capabilityGap.taskId,
          skillId: result.report.package,
          capability: capabilityGap.requestedCapability,
          approvedPermissions,
        };
    }
    recordAuditEvent({
      eventType: "skill.promoted",
      userId,
      payload: {
        package: result.report.package,
        exactVersion: result.report.exactVersion,
        upstreamId: result.report.upstreamId,
        approvedPermissions,
        classification: result.report.classification,
      },
    });
    if (continuation) {
      recordAuditEvent({
        eventType: "skill.available",
        runtimeSessionId,
        userId,
        payload: continuation,
      });
    }
    return NextResponse.json({ name: report.name, status: "promoted", continuation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
