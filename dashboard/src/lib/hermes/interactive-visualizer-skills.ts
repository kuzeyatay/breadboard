export const INTERACTIVE_VISUALIZER_SKILL = "interactive-visualizer";
export const INTERACTIVE_VISUALIZER_IN_CHAT_SKILL =
  "interactive-visualizer-in-chat";

const INTERACTIVE_VISUALIZER_SKILLS = new Set([
  INTERACTIVE_VISUALIZER_SKILL,
  INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
]);

export function isInteractiveVisualizerSkill(
  value: string | null | undefined,
): value is
  | typeof INTERACTIVE_VISUALIZER_SKILL
  | typeof INTERACTIVE_VISUALIZER_IN_CHAT_SKILL {
  return typeof value === "string" && INTERACTIVE_VISUALIZER_SKILLS.has(value);
}

export function isInlineInteractiveVisualizerSkill(
  value: string | null | undefined,
): boolean {
  return value === INTERACTIVE_VISUALIZER_IN_CHAT_SKILL;
}

/** Prefer the explicitly inline variant when a run selected both variants. */
export function selectedInteractiveVisualizerSkill(
  selected: ReadonlySet<string>,
): typeof INTERACTIVE_VISUALIZER_SKILL | typeof INTERACTIVE_VISUALIZER_IN_CHAT_SKILL | null {
  if (selected.has(INTERACTIVE_VISUALIZER_IN_CHAT_SKILL)) {
    return INTERACTIVE_VISUALIZER_IN_CHAT_SKILL;
  }
  if (selected.has(INTERACTIVE_VISUALIZER_SKILL)) {
    return INTERACTIVE_VISUALIZER_SKILL;
  }
  return null;
}

export function shouldRenderInteractiveVisualizerInline(artifact: {
  renderer: string;
  sourceSkill: string | null;
}): boolean {
  return (
    artifact.renderer === "interactive-visualizer" &&
    isInlineInteractiveVisualizerSkill(artifact.sourceSkill)
  );
}

export function interactiveVisualizerCommandForArtifact(artifact: {
  renderer?: string;
  sourceSkill?: string | null;
}): string {
  if (artifact.renderer !== "interactive-visualizer") return "";
  return isInlineInteractiveVisualizerSkill(artifact.sourceSkill)
    ? `/${INTERACTIVE_VISUALIZER_IN_CHAT_SKILL} `
    : `/${INTERACTIVE_VISUALIZER_SKILL} `;
}
