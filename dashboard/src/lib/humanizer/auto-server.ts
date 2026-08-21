// Automatic rewriting for text the server writes down.
//
// The chat transcript humanizes itself from the browser, because an answer is
// already on screen and the swap belongs to the surface showing it. An artifact
// and a garden note are different: they are written by the server, usually
// while the agent is working and nobody is looking at a composer, and by the
// time a person sees one it has been on disk for a while. So they are rewritten
// here, at the moment they are stored.
//
// One rule governs everything below: **this never fails a write.** A rewriter
// that is not installed, is busy with another chat, times out, or has its
// output refused by the preservation gates must leave the caller with exactly
// the text it had. Saving the model's own words is always a correct outcome;
// losing somebody's document because a rewrite went wrong is not. Every path
// here returns the original rather than throwing.

import { getHermesUserSettings } from "../hermes/runtime-store.ts";
import { HUMANIZER_MAX_TEXT_CHARS, humanizerMode } from "./config.ts";
import {
  chooseHumanizerCandidate,
  evaluateHumanizerCandidate,
  humanizerCandidateIsImprovement,
} from "./recovery.ts";
import { humanizerRewrite } from "./service.ts";

/** Below this there is nothing for a sentence-scale rewriter to do. */
const MIN_AUTO_CHARS = 240;

/**
 * Long documents are left alone on purpose. The service takes one job at a
 * time; a fifty-page note would hold the lock for minutes while every chat on
 * the machine waited behind it, to rewrite something nobody is reading yet.
 */
const MAX_AUTO_CHARS = 20_000;
const RECOVERY_CHUNK_TOKENS = 48;

export type AutoHumanizeReason = "artifact" | "garden_note" | "learn_page";

export interface AutoHumanizeResult {
  text: string;
  /** True only when the rewrite was adopted. */
  humanized: boolean;
  /** Populated only on a successful rewrite; counts, never content. */
  chunks?: { total: number; rewritten: number; reverted: number };
}

/** Whether this user has asked for everything to be rewritten. */
export function humanizerAutoEnabled(userId: number): boolean {
  if (humanizerMode() === "disabled") return false;
  try {
    return getHermesUserSettings(userId).humanizerAuto;
  } catch {
    return false;
  }
}

function requestId(): string {
  return `auto${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function unchangedResult(text: string): AutoHumanizeResult {
  return { text, humanized: false };
}

async function humanizeEligibleStoredText(
  text: string,
  reason: AutoHumanizeReason,
): Promise<AutoHumanizeResult> {
  const unchanged = unchangedResult(text);
  const maximumChars =
    reason === "learn_page" ? HUMANIZER_MAX_TEXT_CHARS : MAX_AUTO_CHARS;
  if (!text || text.length < MIN_AUTO_CHARS || text.length > maximumChars) {
    return unchanged;
  }

  try {
    const id = requestId();
    let result = await humanizerRewrite({ requestId: id, text });
    if (
      (!result.ok && result.reason === "preservation_failed") ||
      (result.ok &&
        !humanizerCandidateIsImprovement(
          evaluateHumanizerCandidate(result),
        ))
    ) {
      const recovery = await humanizerRewrite({
        requestId: id,
        text,
        maxChunkTokens: RECOVERY_CHUNK_TOKENS,
      });
      if (recovery.ok) {
        if (!result.ok) {
          result = recovery;
        } else {
          result = {
            ok: true,
            ...chooseHumanizerCandidate(
              evaluateHumanizerCandidate(result),
              evaluateHumanizerCandidate(recovery),
            ).result,
          };
        }
      }
    }

    if (!result.ok) return unchanged;
    if (!humanizerCandidateIsImprovement(evaluateHumanizerCandidate(result))) {
      return unchanged;
    }
    console.info(
      `[humanizer] auto reason=${reason} chars=${text.length} ` +
        `chunks=${result.chunks.total} rewritten=${result.chunks.rewritten} ` +
        `reverted=${result.chunks.reverted}`,
    );
    return {
      text: result.rewrittenText,
      humanized: true,
      chunks: result.chunks,
    };
  } catch {
    // A rewriter that threw is a rewriter that did not run. The write proceeds.
    return unchanged;
  }
}

/**
 * Capture the account preference once for a multi-document write. Learn uses
 * this at its post-build boundary so toggling the switch halfway through the
 * pass cannot leave a garden half rewritten.
 */
export function storedTextHumanizerForUser(
  userId: number,
): ((text: string, reason: AutoHumanizeReason) => Promise<AutoHumanizeResult>) | null {
  if (!humanizerAutoEnabled(userId)) return null;
  return humanizeEligibleStoredText;
}

/**
 * Rewrite text on its way to being stored, when the user has asked for that.
 *
 * `reason` is for the log line and nothing else. The text itself is never
 * logged, here or in the sidecar.
 */
export async function humanizeStoredText(
  userId: number,
  text: string,
  reason: AutoHumanizeReason,
): Promise<AutoHumanizeResult> {
  const humanize = storedTextHumanizerForUser(userId);
  return humanize
    ? humanize(text, reason)
    : unchangedResult(text);
}
