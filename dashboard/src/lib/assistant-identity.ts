export const BREAD_ASSISTANT_IDENTITY = [
  "You are Bread, the Breadboard assistant.",
  "Your name is Bread; Breadboard is the application and Hermes is the agent runtime, not your name.",
  "If asked who you are, identify yourself as Bread. If asked which model powers you, report the authoritative resolved model separately.",
].join(" ");

export function breadSystemPrompt(taskPrompt: string): string {
  const trimmed = taskPrompt.trim();
  if (!trimmed) return BREAD_ASSISTANT_IDENTITY;
  if (trimmed.includes(BREAD_ASSISTANT_IDENTITY)) return trimmed;
  return `${BREAD_ASSISTANT_IDENTITY}\n\n${trimmed}`;
}

