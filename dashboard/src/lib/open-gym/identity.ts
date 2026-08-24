export const OPEN_GYM_COMMAND = "/agents:open-gym";
export const OPEN_GYM_AGENT_ID = "open-gym";
export const OPEN_GYM_AGENT_NAME = "openGym";

/** Extract an openGym task while preserving capability tokens before it. */
export function taskFromOpenGymCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:open-gym") selected = true;
    else precedingTokens.push(`/${match[1]}`);
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function openGymUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${OPEN_GYM_COMMAND} ${trimmed}` : OPEN_GYM_COMMAND;
}

export function isExerciseTechniqueRequest(task: string): boolean {
  return [
    /\bhow\b.{0,80}\b(?:do|perform|execute|set\s*up|position|hold)\b/i,
    /\bhow\s+to\b/i,
    /\b(?:show|teach|walk)\s+me\b/i,
    /\b(?:demo|demonstrate|animation|animate)\b/i,
    /\b(?:proper|correct|right|safe)\s+(?:way|form|technique)\b/i,
    /\b(?:form|technique|setup|steps?|cues?)\s+(?:for|of|on)\b/i,
    /\b(?:perform|execute)\b/i,
  ].some((pattern) => pattern.test(task));
}

export function isWorkoutProgramRequest(task: string): boolean {
  return /\b(program|routine|workout|plan|split|mesocycle|schedule)\b/i.test(
    task,
  );
}

const FITNESS_PROGRAM_CONTEXT =
  /\b(cardio|conditioning|exercise|fitness|gym|hypertrophy|lifting|mobility|muscle|strength|training|workout)\b/i;

/**
 * Cheap browser-side gate before the authenticated catalogue resolver runs.
 * This may be permissive: only the server's registered-exercise match makes a
 * technique request route, while an unavailable resolver deliberately fails
 * open so a form request still receives the openGym presentation.
 */
export function isOpenGymSuperAgentRoutingCandidate(task: string): boolean {
  return (
    isExerciseTechniqueRequest(task) ||
    (isWorkoutProgramRequest(task) && FITNESS_PROGRAM_CONTEXT.test(task))
  );
}

export function isFitnessProgramRequest(task: string): boolean {
  return isWorkoutProgramRequest(task) && FITNESS_PROGRAM_CONTEXT.test(task);
}
