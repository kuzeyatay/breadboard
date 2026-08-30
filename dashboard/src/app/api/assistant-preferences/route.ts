import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { DEFAULT_MODEL, normalizeAssistantModelId } from "@/lib/ai-models";
import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import {
  getHermesUserSettings,
  setHermesUserSettings,
} from "@/lib/hermes/runtime-store";
import { pickComposerSwitches } from "@/lib/hermes/composer-switches";
import { corsHeaders } from "@/lib/hermes/quartz-support";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
} from "@/lib/hermes/route-helpers";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function defaults() {
  return {
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_ASSISTANT_REASONING_EFFORT,
    reasoningEffortByModel: {} as Record<string, string>,
    userPreference: false,
    humanizerAuto: false,
    switches: {} as Record<string, boolean>,
  };
}

function payload(userId: number | null) {
  if (userId === null) return defaults();
  const settings = getHermesUserSettings(userId);
  return {
    model: settings.defaultModel,
    reasoningEffort: settings.reasoningEffort,
    // The picker needs the whole map, not just the active pair, so selecting a
    // model can restore its own effort without a round trip.
    reasoningEffortByModel: settings.reasoningEffortByModel,
    userPreference: settings.intelligencePreferenceSet,
    // "Rewrite naturally" as a standing preference. The browser switch is the
    // control, but the server needs it too: an artifact and a garden note are
    // written server-side, where no localStorage exists.
    humanizerAuto: settings.humanizerAuto,
    // The Intelligence-menu switches (YOLO, Agent mode, Super agent, Direct
    // mode, Personalize). The browser stores hydrate from this on load, since
    // their localStorage copy belongs to an origin the desktop changes on
    // every launch.
    switches: settings.composerSwitches,
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    return NextResponse.json(payload(await optionalUserId()), { headers: cors });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}

export async function PATCH(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const userId = await optionalUserId();
    if (userId === null) throw new ApiError(401, "authentication_required", "Sign in to save this preference.");
    const body = await readJsonBody(request);
    const model = body.model === undefined ? undefined : normalizeAssistantModelId(body.model);
    if (model === null) {
      throw new ApiError(400, "invalid_model", "Choose a supported assistant model.");
    }
    const reasoningEffort = body.reasoningEffort === undefined
      ? undefined
      : body.reasoningEffort as AssistantReasoningEffort;
    if (
      reasoningEffort !== undefined &&
      !ASSISTANT_REASONING_EFFORTS.includes(reasoningEffort)
    ) {
      throw new ApiError(400, "invalid_reasoning_effort", "Choose a supported intelligence level.");
    }
    const humanizerAuto =
      body.humanizerAuto === undefined ? undefined : body.humanizerAuto === true;
    const switches =
      body.switches === undefined ? undefined : pickComposerSwitches(body.switches);
    if (switches === null) {
      throw new ApiError(
        400,
        "invalid_switches",
        "switches must map known composer switches to booleans.",
      );
    }
    if (
      model === undefined &&
      reasoningEffort === undefined &&
      humanizerAuto === undefined &&
      switches === undefined
    ) {
      throw new ApiError(400, "preference_required", "A model or intelligence level is required.");
    }
    setHermesUserSettings(userId, {
      ...(model !== undefined ? { defaultModel: model } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      // Sent on its own by the "Rewrite naturally" switch, which is not an
      // intelligence preference and must not mark one as set.
      ...(humanizerAuto !== undefined ? { humanizerAuto } : {}),
      // Sent alone by a switch store's write-through; not an intelligence
      // preference either.
      ...(switches !== undefined ? { composerSwitches: switches } : {}),
    });
    return NextResponse.json(payload(userId), { headers: cors });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
