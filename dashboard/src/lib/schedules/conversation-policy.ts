// Decide whether a scheduled run should immediately become a visible chat or
// should first prove that the thing the user is waiting for has happened.
//
// This stays deterministic on purpose. The scheduler needs to make the same
// routing decision when a job is created, edited, migrated, or fired after an
// app restart; it must not spend an agent turn merely choosing how to spend the
// real agent turn.

export const SCHEDULE_CONVERSATION_POLICIES = [
  "always_open",
  "open_when_objective_met",
] as const;

export type ScheduledChatConversationPolicy =
  (typeof SCHEDULE_CONVERSATION_POLICIES)[number];

export type ScheduledObjectiveDecision = "met" | "pending";

const NOTIFY_ON_CONDITION =
  /\b(?:notify|alert|tell|message|ping|email|inform|remind)\s+(?:me\s+)?(?:as soon as|when|once|if)\b/i;
const LET_ME_KNOW_ON_CONDITION =
  /\blet\s+me\s+know\s+(?:as soon as|when|once|if)\b/i;
const CONDITION_THEN_NOTIFY =
  /\b(?:as\s+soon\s+as|when|once|if)\b[\s\S]{0,180}\b(?:notify|alert|tell|message|ping|email|inform|remind)\s+(?:me\b)?/i;
const WATCH_UNTIL_CONDITION =
  /\b(?:watch|monitor|track|keep\s+an\s+eye\s+on|check)\b[\s\S]{0,180}\b(?:until|and\s+(?:(?:notify|alert|tell|message|ping)\s+me|let\s+me\s+know)\s+when)\b/i;
const UNTIL_CONDITION = /\buntil\b/i;

/**
 * Strong conditional-notification language means a run is a private check,
 * not a report. Ordinary recurring work such as "look at my mail" deliberately
 * falls through to always_open.
 */
export function inferScheduledChatConversationPolicy(
  prompt: string,
): ScheduledChatConversationPolicy {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (
    NOTIFY_ON_CONDITION.test(clean) ||
    LET_ME_KNOW_ON_CONDITION.test(clean) ||
    CONDITION_THEN_NOTIFY.test(clean) ||
    WATCH_UNTIL_CONDITION.test(clean) ||
    UNTIL_CONDITION.test(clean)
  ) {
    return "open_when_objective_met";
  }
  return "always_open";
}

export function scheduledChatOpensOnlyWhenMet(
  policy: ScheduledChatConversationPolicy,
): boolean {
  return policy === "open_when_objective_met";
}

export const SCHEDULE_OBJECTIVE_MET_MARKER =
  "<!-- breadboard-schedule-objective:met -->";
export const SCHEDULE_OBJECTIVE_PENDING_MARKER =
  "<!-- breadboard-schedule-objective:pending -->";

/** Add the private decision contract after the user's prompt. */
export function scheduledObjectiveEvaluationPrompt(prompt: string): string {
  return `${prompt.trim()}

[Background schedule decision]
Perform the requested check now. Then decide whether the real-world condition
the user is waiting for is actually satisfied now. Mark it met only when this
run found concrete evidence that it is; otherwise mark it pending. End your
response with exactly one of these markers:
${SCHEDULE_OBJECTIVE_MET_MARKER}
${SCHEDULE_OBJECTIVE_PENDING_MARKER}`;
}

const OBJECTIVE_MARKER =
  /<!--\s*breadboard-schedule-objective\s*:\s*(met|pending)\s*-->/gi;

/** Read and remove the private marker before any answer becomes visible. */
export function readScheduledObjectiveDecision(content: string): {
  decision: ScheduledObjectiveDecision | null;
  visibleContent: string;
} {
  let decision: ScheduledObjectiveDecision | null = null;
  const visibleContent = content
    .replace(OBJECTIVE_MARKER, (_marker, value: string) => {
      decision = value.toLowerCase() as ScheduledObjectiveDecision;
      return "";
    })
    .trim();
  return { decision, visibleContent };
}
