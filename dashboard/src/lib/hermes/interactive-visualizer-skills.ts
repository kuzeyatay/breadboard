export const INTERACTIVE_VISUALIZER_SKILL = "interactive-visualizer";
export const INTERACTIVE_VISUALIZER_IN_CHAT_SKILL =
  "interactive-visualizer-in-chat";
export const DIAGRAM_IN_CHAT_SKILL = "diagram-in-chat";

export type InteractiveVisualizerSkill =
  | typeof INTERACTIVE_VISUALIZER_SKILL
  | typeof INTERACTIVE_VISUALIZER_IN_CHAT_SKILL
  | typeof DIAGRAM_IN_CHAT_SKILL;

const INTERACTIVE_VISUALIZER_SKILLS = new Set([
  INTERACTIVE_VISUALIZER_SKILL,
  INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
  DIAGRAM_IN_CHAT_SKILL,
]);

export function isInteractiveVisualizerSkill(
  value: string | null | undefined,
): value is InteractiveVisualizerSkill {
  return typeof value === "string" && INTERACTIVE_VISUALIZER_SKILLS.has(value);
}

export function isInlineInteractiveVisualizerSkill(
  value: string | null | undefined,
): boolean {
  return value === INTERACTIVE_VISUALIZER_IN_CHAT_SKILL || value === DIAGRAM_IN_CHAT_SKILL;
}

/** Prefer the explicitly inline variant when a run selected both variants. */
export function selectedInteractiveVisualizerSkill(
  selected: ReadonlySet<string>,
): InteractiveVisualizerSkill | null {
  if (selected.has(DIAGRAM_IN_CHAT_SKILL)) return DIAGRAM_IN_CHAT_SKILL;
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
  if (artifact.sourceSkill === DIAGRAM_IN_CHAT_SKILL) return `/${DIAGRAM_IN_CHAT_SKILL} `;
  return isInlineInteractiveVisualizerSkill(artifact.sourceSkill)
    ? `/${INTERACTIVE_VISUALIZER_IN_CHAT_SKILL} `
    : `/${INTERACTIVE_VISUALIZER_SKILL} `;
}
