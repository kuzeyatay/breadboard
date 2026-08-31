import { PATENT_DISCLOSURE_SKILL } from "./patent-disclosure-source.ts";

export const PATENT_DISCLOSURE_GUIDE_TOOL = "patent_disclosure_guide";

export function patentDisclosureGuidanceSelected(
  decision: {
    allowedTools: readonly string[];
    selectedConditionalSkills: readonly string[];
  } | null | undefined,
): boolean {
  return Boolean(
    decision?.allowedTools.includes(PATENT_DISCLOSURE_GUIDE_TOOL) &&
      decision.selectedConditionalSkills.includes(PATENT_DISCLOSURE_SKILL),
  );
}
