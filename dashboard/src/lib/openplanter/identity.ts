export const OPENPLANTER_COMMAND = "/agents:openplanter";
export const OPENPLANTER_AGENT_ID = "openplanter";
export const OPENPLANTER_AGENT_NAME = "OpenPlanter";

export function taskFromOpenPlanterCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:openplanter(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function openPlanterUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${OPENPLANTER_COMMAND} ${trimmed}` : OPENPLANTER_COMMAND;
}
