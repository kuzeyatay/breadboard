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
  return /\b(how(?:\s+\w+){0,4}\s+(?:do|perform|execute)|how to|show me|teach me|demonstrate|proper form|correct way|technique|form for|perform|execute|animation|demo)\b/i.test(task);
}

export function isWorkoutProgramRequest(task: string): boolean {
  return /\b(program|routine|workout|plan|split|mesocycle|schedule)\b/i.test(
    task,
  );
}
