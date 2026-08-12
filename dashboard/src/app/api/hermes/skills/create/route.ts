import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import {
  classifySkill,
  quarantineSkill,
  type SkillCandidate,
} from "@/lib/hermes/skills.ts";
import {
  buildSkillFiles,
  parseSkillDraftResponse,
  skillDraftMessages,
  validateSkillDraft,
  type SkillDraft,
  type SkillReferenceDraft,
} from "@/lib/hermes/skill-authoring.ts";
import { recordAuditEvent, recordSkillDecision } from "@/lib/hermes/runtime-store.ts";
import { createChatmockClient } from "@/lib/knowledge";
import { DEFAULT_MODEL } from "@/lib/ai-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The skill creator produces locally authored skills. Creation only stages an
// immutable revision in inactive quarantine; the same human review and
// promotion boundary as downloaded skills decides whether it ever runs.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    if (body.action === "draft") return await draftWithModel(body);

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
    return NextResponse.json({ report, warnings: validation.warnings });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function draftFromBody(body: Record<string, unknown>): SkillDraft {
  const references: SkillReferenceDraft[] = Array.isArray(body.references)
    ? body.references.flatMap((entry) => {
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
    references,
  };
}

async function draftWithModel(body: Record<string, unknown>): Promise<NextResponse> {
  const intent = requireString(body.intent, "intent", 4000);
  const client = createChatmockClient();
  let raw = "";
  try {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: skillDraftMessages(intent),
    });
    raw = response.choices[0]?.message?.content ?? "";
  } catch {
    throw new ApiError(
      502,
      "draft_unavailable",
      "The drafting model is unavailable right now. You can still write the skill by hand.",
    );
  }
  const draft = parseSkillDraftResponse(raw);
  if (!draft) {
    throw new ApiError(
      502,
      "draft_unparseable",
      "The drafting model returned an unusable draft. Try rephrasing the intent or write the skill by hand.",
    );
  }
  return NextResponse.json({ draft, validation: validateSkillDraft(draft) });
}
