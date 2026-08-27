import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { HUMANIZER_MAX_TEXT_CHARS } from "@/lib/humanizer/config.ts";
import { humanizeRequestSchema, parseRequest } from "@/lib/humanizer/schemas.ts";
import { describeWarnings } from "@/lib/humanizer/review.ts";
import {
  chooseHumanizerCandidate,
  evaluateHumanizerCandidate,
  humanizerCandidateIsImprovement,
} from "@/lib/humanizer/recovery.ts";
import {
  humanizerCancel,
  humanizerRewrite,
  type HumanizerFailureReason,
} from "@/lib/humanizer/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Rewrite text with the local model, and score both versions.
 *
 * The browser talks only to this route; this route talks only to a loopback
 * sidecar with a server-owned bearer. There is no provider call anywhere in
 * this file and no configuration path by which one could be introduced: the
 * only client imported here is `lib/humanizer/service`, which speaks to
 * 127.0.0.1 and nothing else.
 *
 * Nothing is persisted here. This route reads text and returns text; adopting a
 * rewrite for a stored message is a separate call to
 * `/api/humanizer/versions`.
 */

const MAX_BODY_BYTES = 1024 * 1024;
const RECOVERY_CHUNK_TOKENS = 48;

/** Reasons the caller can act on, and the status that says so. */
const FAILURE_STATUS: Record<HumanizerFailureReason, number> = {
  disabled: 409,
  unavailable: 503,
  not_installed: 409,
  busy: 429,
  cancelled: 499,
  timeout: 504,
  invalid_input: 422,
  preservation_failed: 422,
  inference_failed: 502,
};

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function handlePost(request: Request) {
  try {
    await requireUserId();
  } catch (error) {
    if (error instanceof RouteError) {
      return noStore({ error: error.message }, error.status);
    }
    throw error;
  }

  const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return noStore(
      { error: "request_too_large", detail: `Send at most ${HUMANIZER_MAX_TEXT_CHARS} characters.` },
      413,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return noStore({ error: "invalid_json" }, 400);
  }

  const parsed = parseRequest(humanizeRequestSchema, payload);
  if (!parsed.ok) return noStore(parsed.failure, 422);

  const { text, requestId } = parsed.value;

  let result = await humanizerRewrite({
    requestId,
    text,
    // A browser that navigated away must not leave a beam search running. The
    // fetch is torn down and the sidecar is told to stop between chunks.
    signal: request.signal,
  });

  let recoveryAttempted = false;
  let recoveryUsed = false;
  if (
    (!result.ok && result.reason === "preservation_failed") ||
    (result.ok && !humanizerCandidateIsImprovement(evaluateHumanizerCandidate(result)))
  ) {
    recoveryAttempted = true;
    const recovery = await humanizerRewrite({
      requestId,
      text,
      maxChunkTokens: RECOVERY_CHUNK_TOKENS,
      signal: request.signal,
    });
    if (recovery.ok) {
      if (!result.ok) {
        result = recovery;
        recoveryUsed = true;
      } else {
        const primaryCandidate = evaluateHumanizerCandidate(result);
        const chosen = chooseHumanizerCandidate(
          primaryCandidate,
          evaluateHumanizerCandidate(recovery),
        );
        recoveryUsed = chosen.result === recovery;
        result = { ok: true, ...chosen.result };
      }
    } else if (recovery.reason === "cancelled" || recovery.reason === "timeout") {
      result = recovery;
    }
  }

  if (!result.ok) {
    if (result.reason === "cancelled" || result.reason === "timeout") {
      void humanizerCancel(requestId).catch(() => {});
    }
    return noStore({ error: result.reason, detail: result.detail }, FAILURE_STATUS[result.reason]);
  }

  // Both numbers come from Breadboard's existing scorer. They choose between
  // two already-preserved candidates; the browser still adopts only a strict
  // improvement, and reports the result so the reader can judge it.
  const evaluated = evaluateHumanizerCandidate(result);
  const { scores, integrity } = evaluated;

  return noStore({
    requestId: result.requestId,
    originalText: result.originalText,
    rewrittenText: result.rewrittenText,
    unchanged: result.originalText === result.rewrittenText,
    chunks: result.chunks,
    scores,
    integrity,
    warnings: describeWarnings(result.preservation.warnings, result.chunks.reverted),
    model: {
      id: result.modelId,
      revision: result.modelRevision,
      device: result.device,
      dtype: result.dtype,
    },
    timingMs: result.timingMs,
    recovery: {
      attempted: recoveryAttempted,
      used: recoveryUsed,
      chunkTokens: recoveryAttempted ? RECOVERY_CHUNK_TOKENS : null,
    },
  });
}

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
