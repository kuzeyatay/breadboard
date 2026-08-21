// When a turn asking for prose to read less like a machine wrote it should
// select the Humanize skill on its own.
//
// "Humanize this" names no skill, and without one the model does the thing it
// is worst at judging: it rewrites the passage from memory, cheerfully moving a
// version number or dropping a citation, and reports nothing about what it
// changed. The skill exists to route that through the local rewriter and its
// preservation gates instead. Nobody types `/humanize` for the same reason
// nobody types `/watch` at a video — the sentence already says what it wants.
//
// Text-only, like Diagram Design. An attachment never means "humanize": a
// pasted document is usually the subject of a question, not a rewrite request,
// and the skill's own guidance is what asks for the passage when the sentence
// referred to one without including it.
//
// Runs late in both chains, after every attachment-driven selection: "humanize
// the summary of this video" needs Watch to see the video first, and the
// rewrite is the second half of that turn rather than the whole of it.

import type { HermesSurface } from "./config.ts";

/** The first-party skill directory name, which is also its slash command. */
export const HUMANIZE_SKILL = "humanize";

/**
 * The verb, in the words people actually use. `humanize` and `de-AI` are
 * unambiguous on their own; everything else needs an object below, because
 * "make this natural" on its own is about tone of voice as often as it is
 * about this.
 */
const HUMANIZE_VERB =
  /\b(?:humani[sz]e|humani[sz]ing|de-?ai|un-?ai|deslop|de-?slop|unslop)\b/i;

/**
 * Asking for the same thing the long way round: a rewriting verb pointed at
 * machine-sounding prose. Both halves are required and they must be near each
 * other, so "rewrite the intro" (a plain rewrite request) is left alone.
 */
const REWRITE_VERB =
  "(?:rewrite|rework|redo|reword|rephrase|revise|edit|clean\\s+up|touch\\s+up|polish|fix|make|help\\s+me\\s+make|can\\s+you\\s+make)";

const MACHINE_TONE =
  "(?:(?:sound|read|feel|look)s?\\s+(?:more\\s+)?(?:human|natural|less\\s+(?:ai|robotic|artificial|generic|formulaic|stiff)|like\\s+(?:a|an)\\s+(?:human|person|real\\s+person)\\s+wrote|like\\s+(?:ai|chatgpt|a\\s+(?:robot|bot|machine)|a\\s+language\\s+model))|less\\s+(?:like\\s+)?(?:ai|a\\s+robot|chatgpt|a\\s+language\\s+model|machine[\\s-]written)|(?:'t|not)\\s+sound\\s+like\\s+(?:ai|chatgpt|a\\s+robot|a\\s+bot|a\\s+machine)|more\\s+human|human[\\s-]sounding|less\\s+ai[\\s-]sounding|less\\s+robotic|less\\s+slop|ai[\\s-]slop)";

const VERB_THEN_TONE = new RegExp(
  `\\b${REWRITE_VERB}\\b[^.!?]{0,80}\\b${MACHINE_TONE}`,
  "i",
);

/**
 * "make it sound human", with the object between the verb and the tone.
 *
 * The `\b` sits in front of the whole group, which is why the contraction
 * branch above is `'t` rather than `n't`: in "doesn't" there is no word
 * boundary before the `n`, only before the apostrophe.
 */
const TONE_LED = new RegExp(`\\b${MACHINE_TONE}`, "i");

/**
 * A sentence that names the tone without any verb at all — "this reads like
 * ChatGPT wrote it" — is a complaint, not an instruction, unless it is paired
 * with something asking for a change. `TONE_LED` alone is therefore never
 * enough on its own; see `shouldAutoSelectHumanize`.
 */
const CHANGE_REQUEST =
  /\b(?:rewrite|rework|reword|rephrase|revise|edit|change|improve|fix|clean|make|redo|can\s+you|could\s+you|please|help\s+me)\b/i;

/**
 * Talking *about* humanizers rather than asking for one, and the two requests
 * that would otherwise be stolen: the feature itself ("how do I turn on Rewrite
 * naturally") and the neighbouring skill ("strip the invisible characters"),
 * which is metadata hygiene and a different tool entirely.
 */
const DISCUSSION_ONLY =
  /\b(?:what\s+(?:is|are|does)\b|what'?s\s+(?:a|an|the)\b|how\s+do(?:es)?\s+(?:a\s+|an\s+|the\s+)?(?:humani[sz]er|ai\s+detector)|which\s+(?:tool|app|service|site)|are\s+there\s+any|recommend\s+(?:a|an|some)|tell\s+me\s+about\b|pros?\s+and\s+cons?|is\s+it\s+(?:ethical|legal|ok|okay))/i;

const FEATURE_QUESTION =
  /\b(?:turn\s+on|switch\s+on|enable|disable|set\s+up|install|where\s+is|how\s+do\s+i\s+use)\b[^.!?]{0,40}\b(?:rewrite\s+naturally|humani[sz]er|humani[sz]e\s+(?:switch|setting|feature|mode))/i;

const WATERMARK_REQUEST =
  /\b(?:invisible|zero[\s-]?width|hidden)\s+(?:character|unicode|text)|\bc2pa\b|\bcontent\s+credentials\b|\bexif\b|\bmetadata\b|\bwatermark/i;

/**
 * Detector framing. The skill still runs — a person may simply be worried about
 * a false positive on their own writing — but it is worth keeping out of the
 * *automatic* path, because a turn that opens by naming a detector deserves the
 * assistant's own words about what this can and cannot do rather than a silent
 * hand-off to a rewriting tool.
 */
const DETECTOR_FRAMING =
  /\b(?:turnitin|gptzero|originality\.?ai|copyleaks|zerogpt|ai\s+detector|detection\s+(?:tool|software|score)|plagiari[sz]|undetectable)\b/i;

/** A link is not prose; it is stripped before any test so a URL cannot match. */
const ANY_URL = /\bhttps?:\/\/\S+/gi;

/**
 * A short follow-up to a rewrite that just happened. Skill guidance is injected
 * per turn, so "again, but shorter" arrives with none of the preservation rules
 * that produced the first one unless the skill is selected again.
 */
const REVISION_REQUEST =
  /^(?:(?:can|could|would|will|please)\s+you\s+|please\s+|now\s+|and\s+)?(?:(?:try|do|run)\s+(?:it|that)\s+again|again|once\s+more|(?:make\s+it\s+)?(?:(?:more|less)\s+\w+|shorter|longer|warmer|plainer|simpler|looser|tighter|punchier))[?.!]*$/i;

const HUMANIZE_CONTEXT =
  /(?:\/humanize\b|humani[sz]ed?\b|rewrite\s+naturally|AI-style\s+pattern\s+score)/i;

function humanizedSomethingRecently(
  priorMessages: ReadonlyArray<{ role: string; content: string }> | undefined,
): boolean {
  return (priorMessages ?? [])
    .slice(-8)
    .some(
      (message) =>
        message.role === "assistant" && HUMANIZE_CONTEXT.test(message.content),
    );
}

export interface HumanizeIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

export function shouldAutoSelectHumanize(input: HumanizeIntentInput): boolean {
  const text = input.text.trim();
  // Both conversational surfaces, and neither of the unauthenticated ones: the
  // rewriter is a local service reached with a per-install credential, and the
  // score it reports is about the user's own prose. An explicit command already
  // says what the turn is, so never argue with one.
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  if (!available || !text || text.startsWith("/")) return false;

  const prose = text.replace(ANY_URL, " ");
  if (
    DISCUSSION_ONLY.test(prose) ||
    FEATURE_QUESTION.test(prose) ||
    DETECTOR_FRAMING.test(prose)
  ) {
    return false;
  }
  // "Strip the invisible characters and humanize it" is two requests; the
  // rewriting half still wins, because the marks tool is reachable from the
  // skill's own guidance but not the other way round.
  if (WATERMARK_REQUEST.test(prose) && !HUMANIZE_VERB.test(prose)) return false;

  const asks =
    HUMANIZE_VERB.test(prose) ||
    VERB_THEN_TONE.test(prose) ||
    (TONE_LED.test(prose) && CHANGE_REQUEST.test(prose));
  if (asks) return true;

  return (
    REVISION_REQUEST.test(prose) && humanizedSomethingRecently(input.priorMessages)
  );
}

/**
 * Whether the skill is actually installed, and whether the local rewriter is
 * running, is not decided here. The caller resolves the selection and falls
 * back to the plain text when it turns out to be unavailable — the same answer
 * this module would give, and one fewer place that has to know what the skill
 * needs to run.
 */
export function humanizeCommandText(
  input: HumanizeIntentInput,
): { text: string; automatic: boolean } {
  const automatic = shouldAutoSelectHumanize(input);
  return {
    text: automatic ? `/${HUMANIZE_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
