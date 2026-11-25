import { systemPromptText } from "@/lib/system-prompts/service";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import { parseSkillDraftResponse, skillDraftMessages, validateSkillDraft } from "@/lib/hermes/skill-authoring.ts";
import { pendingAuthoredSkills, stageAuthoredSkill } from "@/lib/hermes/stage-authored-skill.ts";
import { createChatmockClient } from "@/lib/knowledge";
import { DEFAULT_MODEL } from "@/lib/ai-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json({ drafts: pendingAuthoredSkills(userId) });
  } catch (error) { return apiErrorResponse(error); }
}

// The skill creator produces locally authored skills. Creation only stages an
// immutable revision in inactive quarantine; the same human review and
// promotion boundary as downloaded skills decides whether it ever runs.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    if (body.action === "draft") return await draftWithModel(body, userId);

    return NextResponse.json(stageAuthoredSkill(userId, body));
  } catch (error) {
    return apiErrorResponse(error);
  }
}


async function draftWithModel(body: Record<string, unknown>, userId: number): Promise<NextResponse> {
  const intent = requireString(body.intent, "intent", 4000);
  const client = createChatmockClient();
  let raw = "";
  try {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: skillDraftMessages(intent, systemPromptText("skill-authoring", userId)),
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
