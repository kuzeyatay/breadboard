import { systemPromptText } from "@/lib/system-prompts/service";
import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { withCouncil } from "@/lib/system-prompts/council.ts";
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
    const userId = await requireUserId();
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
            { role: "system", content: systemPromptText("tone-calibration", userId) },
            { role: "user", content: userPrompt },
          ],
        },
        // metadata_generation is a structured task: it routes to a cheap direct
        // council pass and is never itself run through unslop.
        { taskType: "metadata_generation" }, userId,
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
