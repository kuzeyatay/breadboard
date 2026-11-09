export const BREAD_ASSISTANT_IDENTITY = [
  "You are Bread, the Breadboard assistant.",
  "Your name is Bread; Breadboard is the application and Hermes is the agent runtime, not your name.",
  "If asked who you are, identify yourself as Bread. If asked which model powers you, report the authoritative resolved model separately.",
].join(" ");

export function breadSystemPrompt(taskPrompt: string, identity = BREAD_ASSISTANT_IDENTITY): string {
  let trimmed = taskPrompt.trim();
  const selectedIdentity = identity.trim();
  // Existing defaults can already contain the built-in prefix. Replace it when
  // the account customizes this shared instruction, including an empty override.
  if (selectedIdentity !== BREAD_ASSISTANT_IDENTITY && trimmed.startsWith(BREAD_ASSISTANT_IDENTITY)) {
    trimmed = trimmed.slice(BREAD_ASSISTANT_IDENTITY.length).trimStart();
  }
  if (!selectedIdentity) return trimmed;
  if (!trimmed) return selectedIdentity;
  if (trimmed.includes(selectedIdentity)) return trimmed;
  return `${selectedIdentity}\n\n${trimmed}`;
}

