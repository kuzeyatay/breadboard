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
  getOpenHarnessUserSettings,
  setOpenHarnessUserSettings,
} from "@/lib/openharness/runtime-store";
import { corsHeaders } from "@/lib/openharness/quartz-support";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
} from "@/lib/openharness/route-helpers";

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
    userPreference: false,
  };
}

function payload(userId: number | null) {
  if (userId === null) return defaults();
  const settings = getOpenHarnessUserSettings(userId);
  return {
    model: settings.defaultModel,
    reasoningEffort: settings.reasoningEffort,
    userPreference: settings.intelligencePreferenceSet,
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
    if (model === undefined && reasoningEffort === undefined) {
      throw new ApiError(400, "preference_required", "A model or intelligence level is required.");
    }
    setOpenHarnessUserSettings(userId, {
      ...(model !== undefined ? { defaultModel: model } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    });
    return NextResponse.json(payload(userId), { headers: cors });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
