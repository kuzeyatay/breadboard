import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse, readJsonBody, requireString } from "@/lib/hermes/route-helpers.ts";
import { getGuardrailSettings, updateGuardrailSettings } from "@/lib/guardrails/service.ts";
import { maskPii } from "@/lib/sim/guardrails/local-pii.ts";
import { sanitizeCustomPatterns, type CustomPiiPattern } from "@/lib/sim/guardrails/pii-entities.ts";
import { validateRegexPattern } from "@/lib/sim/guardrails/validate_regex.ts";
import { compileLinearRegex } from "@/lib/sim/guardrails/linear-regex.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CUSTOM_PATTERN_LENGTH = 500;

/**
 * Sanitize + reject invalid custom patterns before they reach the settings
 * row. `compileLinearRegex` is the same shim `local-pii.ts` matches with — see
 * its header for why this is defense in depth, not a ReDoS guarantee, on
 * Breadboard's built-in-engine build.
 */
function validateCustomPatternsInput(value: unknown): CustomPiiPattern[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_field", 'Field "customPatterns" must be an array.');
  }
  const sanitized = sanitizeCustomPatterns(value);
  for (const pattern of sanitized) {
    const label = pattern.name || pattern.regex;
    if (pattern.regex.length > MAX_CUSTOM_PATTERN_LENGTH) {
      throw new ApiError(
        400,
        "pattern_too_long",
        `Pattern "${label}" is too long (max ${MAX_CUSTOM_PATTERN_LENGTH} characters).`,
      );
    }
    const syntax = validateRegexPattern(pattern.regex);
    if (!syntax.valid) {
      throw new ApiError(400, "invalid_pattern", `Pattern "${label}": ${syntax.error}`);
    }
    if (!compileLinearRegex(pattern.regex)) {
      throw new ApiError(400, "unsafe_pattern", `Pattern "${label}" could not be compiled.`);
    }
  }
  return sanitized;
}

/** Guardrail settings: whether outbound messages get PII-masked, and the custom patterns to mask. */
export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ settings: getGuardrailSettings() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Update the scrub toggle and/or the custom pattern list. */
export async function PATCH(request: Request) {
  try {
    await requireUserId();
    const body = await readJsonBody(request);
    const patch: { scrubOutbound?: boolean; customPatterns?: CustomPiiPattern[] } = {};
    if (typeof body.scrubOutbound === "boolean") patch.scrubOutbound = body.scrubOutbound;
    if (body.customPatterns !== undefined) {
      patch.customPatterns = validateCustomPatternsInput(body.customPatterns);
    }
    return NextResponse.json({ settings: updateGuardrailSettings(patch) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * "Try it" preview for the settings UI: mask `text` with the built-in
 * detectors plus either the draft `customPatterns` from the request (so a
 * pattern can be tried before it is saved) or, if omitted, the saved ones.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = await readJsonBody(request);
    const text = requireString(body.text, "text", 8_000);
    const customPatterns =
      body.customPatterns !== undefined
        ? validateCustomPatternsInput(body.customPatterns)
        : getGuardrailSettings().customPatterns;
    const { masked, findings } = maskPii(text, { customPatterns });
    return NextResponse.json({ masked, findings });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
