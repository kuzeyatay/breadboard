// Praxist runs prepared research task projects rather than free-form chat
// prompts. The text after the command is therefore an absolute task-project
// directory (optionally written as --task-path <directory>).

export const PRAXIST_COMMAND = "/agents:praxist";
export const PRAXIST_AGENT_ID = "praxist";
export const PRAXIST_AGENT_NAME = "Praxist";

export function taskFromPraxistCommand(value: string): string | null {
  const match = /^\/agents:praxist(?:\s+([\s\S]*))?$/iu.exec(value.trim());
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function parsePraxistTaskPath(value: string): string {
  const trimmed = value.trim();
  const option = /^--task-path(?:=|\s+)([\s\S]+)$/iu.exec(trimmed);
  const candidate = (option?.[1] ?? trimmed).trim();
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    return candidate.slice(1, -1).trim();
  }
  return candidate;
}

export function praxistUserMessage(taskPath: string): string {
  const trimmed = taskPath.trim();
  return trimmed ? `${PRAXIST_COMMAND} --task-path "${trimmed.replaceAll('"', '\\"')}"` : PRAXIST_COMMAND;
}
