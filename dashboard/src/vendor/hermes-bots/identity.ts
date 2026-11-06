// Adapted from Hermes Bot Mode (Nous Research), MIT; see LICENSE and README.md.
interface ComposeSoulOptions {
  customSoul?: string | null;
  description?: string | null;
  name: string;
  title?: string | null;
}

export function composeSoul({ name, title, description, customSoul }: ComposeSoulOptions): string {
  if (customSoul && customSoul.trim()) return customSoul.trim();
  const displayName = title || name;
  const lines = [
    `# ${displayName}`,
    "",
    title ? `**Role:** ${title}` : null,
    description ? `**Mission:** ${description}` : null,
    "",
    `You are ${displayName}, a persistent named bot in Breadboard.`,
    "Your dedicated conversation keeps its history across visits.",
  ];
  return lines.filter(line => line !== null).join("\n");
}

export function duplicateBotName(base: string, names: readonly string[]): string {
  for (let n = 2; n < 102; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, 60 - suffix.length) + suffix;
    if (!names.some(name => name.toLowerCase() === candidate.toLowerCase())) return candidate;
  }
  throw new Error("No free name for the duplicate.");
}
