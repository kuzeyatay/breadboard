// When a turn that states a durable objective should select the Goal skill on
// its own.
//
// Goal used to be a switch in the composer's mode menu, which meant it only
// ever governed a conversation when someone remembered to reach for it before
// typing — and the sentence that most needs a goal ("keep going until the
// tests pass") is exactly the one people type without opening a menu first.
// The wording carries it instead: a commitment to keep working past this turn,
// or an objective named as an objective.
//
// The rule is text-only. No attachment means "goal", and no earlier turn does
// either: a goal is a thing the person decides to start, and starting it out of
// conversational drift would bind them to an objective they never stated.

import type { HermesSurface } from "./config.ts";
import { GOAL_MODE_SKILL } from "../goal-mode.ts";

export { GOAL_MODE_SKILL };

/** A link is not prose; it is stripped before any test so a URL cannot match one. */
const ANY_URL = /\bhttps?:\/\/\S+/gi;

/**
 * "Do not stop until X." The whole point of a goal is that the turn ending is
 * not the work ending, and these are the ways people say that.
 */
const PERSIST_UNTIL =
  /\b(?:keep\s+(?:going|working|trying|at\s+it|iterating|looping)|don'?t\s+stop|do\s+not\s+stop|never\s+stop|stay\s+on\s+(?:it|this)|carry\s+on|continue)\b[^.!?]{0,60}\b(?:until|till|til)\b/i;

/**
 * The same commitment with the clause the other way round, or with the verb
 * carrying it: "iterate until the build is green", "retry until it works".
 */
const VERB_UNTIL =
  /\b(?:iterate|loop|retry|repeat|refine|fix|debug|rerun|re-?run|work|try)\b[^.!?]{0,40}\b(?:until|till|til)\b[^.!?]{0,60}\b(?:pass(?:es|ing)?|green|works?|working|clean|done|finished|complete[d]?|succeeds?|resolved?|gone|zero|empty)\b/i;

/** An objective named as an objective. */
const NAMED_OBJECTIVE =
  /\b(?:your|the|our|my)\s+(?:goal|objective|mission)\s+(?:is|for\s+this\s+(?:chat|conversation|session)\s+is)\b|^\s*(?:goal|objective)\s*[:—-]\s*\S/i;

/**
 * An open-ended commitment with no "until" clause at all: the bound is time or
 * effort rather than a condition.
 */
const OPEN_ENDED =
  /\b(?:however\s+long\s+it\s+takes|no\s+matter\s+how\s+(?:long|many)|as\s+many\s+(?:turns|attempts|tries)\s+as|for\s+as\s+long\s+as\s+it\s+takes|whatever\s+it\s+takes)\b/i;

/**
 * Asking about goals rather than setting one. "What does goal mode do?" and
 * "should I set a goal for this?" are conversation, not commitment.
 */
const DISCUSSION_ONLY =
  /\b(?:what\s+(?:is|are|does|was)\b|what'?s\s+(?:a|the)\s+(?:goal|objective)|how\s+(?:do(?:es)?|can)\s+(?:i|you|goals?)\b|should\s+i\s+(?:set|make|create)\s+(?:a|the)\s+goal|tell\s+me\s+about\b|explain\b)/i;

/**
 * Someone else's goal, being discussed rather than adopted: "summarize the
 * team's goals for Q3", "what were the objectives in that doc". A goal binds
 * this conversation's work, so a request to read or write *about* goals must
 * never quietly become one.
 */
const GOAL_AS_SUBJECT =
  /\b(?:goals?|objectives?|okrs?)\b[^.!?]{0,40}\b(?:document|doc|list|sheet|spreadsheet|deck|report|section|page)\b|\b(?:summari[sz]e|list|draft|write|review|translate|rewrite)\b[^.!?]{0,30}\b(?:goals?|objectives?|okrs?)\b/i;

export interface GoalIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  /** A delegated worker's report is evidence, never a new user commitment. */
  internalContinuation?: boolean;
  /**
   * This conversation already holds a goal. Selecting the skill again would
   * only earn a `create_goal` refusal — the existing goal is already carried
   * into every turn by its own system section, with no skill involved.
   */
  hasActiveGoal?: boolean;
}

export function shouldAutoSelectGoal(input: GoalIntentInput): boolean {
  const text = input.text.trim();
  // Both conversational surfaces, and neither of the unauthenticated ones: the
  // goal is stored against a conversation that has to belong to someone. An
  // explicit command already says what the turn is, so never argue with one.
  const available =
    input.authenticated &&
    !input.internalContinuation &&
    !input.hasActiveGoal &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  if (!available || !text || text.startsWith("/")) return false;
  const prose = text.replace(ANY_URL, " ");
  if (DISCUSSION_ONLY.test(prose) || GOAL_AS_SUBJECT.test(prose)) return false;
  return (
    PERSIST_UNTIL.test(prose) ||
    VERB_UNTIL.test(prose) ||
    NAMED_OBJECTIVE.test(prose) ||
    OPEN_ENDED.test(prose)
  );
}

/**
 * Whether the skill is actually installed is not decided here. The caller
 * resolves the selection and falls back to the plain text when it turns out to
 * be unavailable — the same answer this module would give, and one fewer place
 * that has to know what the skill needs to run.
 */
export function goalCommandText(
  input: GoalIntentInput,
): { text: string; automatic: boolean } {
  const automatic = shouldAutoSelectGoal(input);
  return {
    text: automatic ? `/${GOAL_MODE_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
