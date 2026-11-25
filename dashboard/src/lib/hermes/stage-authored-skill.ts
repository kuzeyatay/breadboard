import { classifySkill, quarantineSkill, skillStorageKey, type SkillCandidate } from "./skills.ts";
import db from "../db.ts";
import { ApiError, requireString } from "./route-core.ts";
import { buildSkillFiles, validateSkillDraft, type SkillDraft, type SkillReferenceDraft } from "./skill-authoring.ts";
import { recordAuditEvent, recordSkillDecision } from "./runtime-store.ts";

export function stageAuthoredSkill(userId: number, body: Record<string, unknown>) {
  const draft = draftFromBody(body);
  const validation = validateSkillDraft(draft);
  if (validation.issues.length) {
    throw new ApiError(422, "invalid_skill_draft", validation.issues.join(" "));
  }
  const files = buildSkillFiles(draft);
  const manifest = files["SKILL.md"];
  const classification = classifySkill({
    name: draft.name,
    description: draft.description,
    manifest,
  });
  const candidate: SkillCandidate = {
    id: `local:${draft.name}`,
    upstreamId: `local:${draft.name}`,
    storageKey: skillStorageKey(`local:${userId}:${draft.name}`, draft.name),
    name: draft.name,
    package: `local/authored@${draft.name}`,
    publisher: "local",
    repository: "local/authored",
    source: "Created with the Breadboard skill creator",
    detailsUrl: "local://skill-creator",
    description: draft.description.trim(),
    installCommand: "Authored locally; never downloaded",
    requestedPermissions: [],
    slashCommand: draft.name,
    classification,
  };
  const report = quarantineSkill({ candidate, files });
  recordSkillDecision({
    skillName: report.name,
    sourceUrl: report.source,
    decision: "quarantined",
    decidedBy: userId,
    manifest: report,
    notes: "Authored locally with the Breadboard skill creator (skill-creator methodology).",
  });
  recordAuditEvent({
    eventType: "skill.authored_quarantined",
    userId,
    payload: {
      name: report.name,
      fileHashes: report.fileHashes,
      classification: report.classification,
    },
  });
  return { report, warnings: validation.warnings };
}

export function pendingAuthoredSkills(userId: number) {
  const rows = db.prepare(`SELECT a.manifest FROM hermes_skill_audit a
    WHERE a.decided_by=? AND a.decision='quarantined' AND json_extract(a.manifest,'$.repository')='local/authored'
    AND NOT EXISTS (SELECT 1 FROM hermes_skill_audit newer WHERE newer.skill_name=a.skill_name AND newer.id>a.id)
    ORDER BY a.id DESC`).all(userId) as Array<{manifest: string}>;
  return rows.map(row => JSON.parse(row.manifest) as ReturnType<typeof quarantineSkill>);
}

export function requireAuthoredSkillOwner(userId: number, name: string) {
  const draft = db.prepare(`SELECT decided_by FROM hermes_skill_audit
    WHERE skill_name=? AND decision='quarantined' ORDER BY id DESC LIMIT 1`).get(name) as { decided_by: number | null } | undefined;
  if (draft?.decided_by !== userId) throw new ApiError(404, "skill_draft_missing", "Skill draft not found.");
}

function draftFromBody(body: Record<string, unknown>): SkillDraft {
  const attachments = (items: unknown): SkillReferenceDraft[] => Array.isArray(items)
    ? items.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const reference = entry as Record<string, unknown>;
        return [
          {
            filename: typeof reference.filename === "string" ? reference.filename : "",
            contents: typeof reference.contents === "string" ? reference.contents : "",
          },
        ];
      })
    : [];
  return {
    name: requireString(body.name, "name", 100).trim(),
    description: requireString(body.description, "description", 4000).trim(),
    instructions: requireString(body.instructions, "instructions", 500_000),
    references: attachments(body.references),
    scripts: attachments(body.scripts),
  };
}
