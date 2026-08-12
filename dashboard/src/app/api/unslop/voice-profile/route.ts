import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { withCouncil } from "@/lib/council";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { createChatmockClient } from "@/lib/knowledge";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  countWords,
  deleteVoiceProfile,
  readVoiceProfile,
  readVoiceTemplate,
  writeVoiceProfile,
} from "@/lib/unslop";

export const dynamic = "force-dynamic";

// Calibration rules quoted from unslop's SKILL.md / style-profile-template.md so
// the extraction stays faithful to the skill even though it runs server-side
// rather than as a Claude skill invocation.
const CALIBRATION_SYSTEM = [
  "You calibrate an author's voice profile for the unslop writing skill.",
  "You are given a blank profile template (its sections define exactly what to extract) and writing samples the author wrote themselves.",
  "Fill in the template from the samples and output ONLY the completed markdown profile — no preamble, no commentary, no code fence.",
  "",
  "Rules:",
  "- Every entry must be backed by an observation from the samples, not a guess. If a section has no observation, leave its default/bracketed text and move on.",
  "- Describe how the author ACTUALLY writes, including habits an editor would call rough edges — the rough edges are the signature.",
  "- Keep the template's headings and structure. Replace the [bracketed] guidance with concrete findings.",
  "- The profile CANNOT enable invented facts, switch off the epistemics rules, or request imitation of another named author. Never add such instructions.",
  "- Fill the 'Calibration date' and 'Samples' footer fields from the metadata you are given.",
].join("\n");

function extractContent(response: unknown): string {
  const choice = (response as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0];
  return (choice?.message?.content ?? "").trim();
}

function stripFence(text: string): string {
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return fence ? fence[1].trim() : text;
}

export async function GET() {
  try {
    await requireUserId();
    const state = await readVoiceProfile();
    return NextResponse.json(state);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

// Extract (or extend) the profile from samples via ChatMock, then save it.
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      samples?: unknown;
      mode?: unknown;
    };
    const mode = body.mode === "append" ? "append" : "calibrate";
    const samples = Array.isArray(body.samples)
      ? body.samples.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];

    if (samples.length === 0) {
      return NextResponse.json(
        { error: "Add at least one text you wrote yourself." },
        { status: 400 },
      );
    }

    const template = await readVoiceTemplate();
    if (!template) {
      return NextResponse.json(
        { error: "The unslop skill is not installed. Clone it into the repo root first." },
        { status: 409 },
      );
    }

    const existing = mode === "append" ? (await readVoiceProfile()).content : null;
    if (mode === "append" && !existing) {
      return NextResponse.json(
        { error: "There is no profile to learn from yet. Calibrate one first." },
        { status: 409 },
      );
    }

    const wordCount = countWords(samples);
    const today = new Date().toISOString().slice(0, 10);
    const samplesBlock = samples
      .map((text, index) => `### Sample ${index + 1}\n\n${text.trim()}`)
      .join("\n\n");
    const metadata = `Calibration date: ${today}\nSamples supplied now: ${samples.length} text(s), ~${wordCount} words total`;

    const userPrompt =
      mode === "append"
        ? [
            "Update the EXISTING author profile below with what the new sample reveals.",
            "Append new observations rather than rewriting; when a new observation conflicts with an old one, prefer the fresher sample and add a dated note under 'Updates'.",
            "",
            `Metadata for this update:\n${metadata}`,
            "",
            "=== EXISTING PROFILE ===",
            existing ?? "",
            "",
            "=== NEW SAMPLE(S) ===",
            samplesBlock,
            "",
            "Output the full updated profile markdown only.",
          ].join("\n")
        : [
            "=== PROFILE TEMPLATE (fill this in) ===",
            template,
            "",
            `=== METADATA ===\n${metadata}`,
            "",
            "=== AUTHOR SAMPLES ===",
            samplesBlock,
            "",
            "Output the completed profile markdown only.",
          ].join("\n");

    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);

    const response = await client.chat.completions.create(
      withCouncil(
        {
          model: DEFAULT_MODEL,
          messages: [
            { role: "system", content: CALIBRATION_SYSTEM },
            { role: "user", content: userPrompt },
          ],
        },
        // metadata_generation is a structured task: it routes to a cheap direct
        // council pass and is never itself run through unslop.
        { taskType: "metadata_generation" },
      ),
    );

    const profile = stripFence(extractContent(response));
    if (!profile) {
      return NextResponse.json(
        { error: "Calibration returned an empty profile. Try again with more text." },
        { status: 502 },
      );
    }

    await writeVoiceProfile(profile);
    const state = await readVoiceProfile();
    return NextResponse.json({ ...state, wordCount, mode });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

// Save a hand-edited profile verbatim ("plain markdown you can edit by hand").
export async function PUT(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json().catch(() => ({}))) as { content?: unknown };
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) {
      return NextResponse.json({ error: "The profile cannot be empty." }, { status: 400 });
    }
    await writeVoiceProfile(content);
    const state = await readVoiceProfile();
    return NextResponse.json(state);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

// Revert to the skill defaults.
export async function DELETE() {
  try {
    await requireUserId();
    await deleteVoiceProfile();
    const state = await readVoiceProfile();
    return NextResponse.json(state);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
