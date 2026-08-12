import { NextResponse } from "next/server";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { corsHeaders } from "@/lib/hermes/quartz-support.ts";
import { HERMES_MODEL_IDS } from "@/lib/hermes/model-selection.ts";
import { DEFAULT_MODEL } from "@/lib/ai-models.ts";
import { DEFAULT_ASSISTANT_REASONING_EFFORT } from "@/lib/assistant-reasoning.ts";

export const dynamic = "force-dynamic";

// Reasoning efforts offered by the Quartz intelligence picker; mirrors the
// dashboard composer's options ('none' is legacy-only and never offered).
const QUARTZ_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

// GET: the model + reasoning-effort choices for the Quartz page AI panel, so it
// offers the same intelligence picker as the dashboard terminal. Secret-free and
// static, but still gated on the runtime being enabled so the panel hides the
// picker when Hermes is off.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    requireEnabled();
    return NextResponse.json(
      {
        models: [...HERMES_MODEL_IDS],
        defaultModel: DEFAULT_MODEL,
        reasoningEfforts: [...QUARTZ_EFFORT_OPTIONS],
        defaultReasoningEffort: DEFAULT_ASSISTANT_REASONING_EFFORT,
      },
      { headers: cors },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
