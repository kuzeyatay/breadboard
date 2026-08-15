import type { LearningUnitContract } from "./learning-unit-contract.ts";

export const AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH =
  ".breadboard/planning/Learning Unit Contract.md" as const;

/** Exact human-readable projection written only after executability + routing. */
export function renderAuthoritativeLearningUnitContractMarkdown(input: {
  units: readonly LearningUnitContract[];
  authoritativeSourceSha256: string;
}): string {
  const lines = [
    "# Learning Unit Contract",
    "",
    "<!--",
    "artifactRole: authoritative_final_learning_unit_contract_summary",
    "authoritativeSource: .breadboard/learning-unit-contract.json",
    "executabilityReviewLedger: .breadboard/visual-contract-executability-reviews.json",
    `authoritativeSourceSha256: ${input.authoritativeSourceSha256}`,
    "-->",
    "",
    "> **Artifact role:** Human-readable projection of the authoritative final Learning Unit Contract JSON after executability review and mechanical routing.",
    "",
    "## Units",
    "",
  ];
  for (const unit of input.units) {
    lines.push(`- ${unit.id}: ${unit.title} (${unit.role})`);
    lines.push(`  - Question: ${unit.learningQuestion || unit.title}`);
    if (unit.interactiveVisualPlan) {
      lines.push(
        `  - Interactive requirement: ${unit.interactiveVisualPlan.requirement} (${unit.interactiveVisualPlan.decision.reason})`,
      );
    }
    if (unit.interactiveVisualPlan?.decision.interaction) {
      const interaction = unit.interactiveVisualPlan.decision.interaction;
      lines.push(`  - Interaction goal: ${interaction.interactionGoal}`);
      lines.push(`  - Learner action: ${interaction.learnerAction}`);
      lines.push(
        `  - Controls: ${interaction.controls.map((control) =>
          `${control.id} [${control.kind}/${control.type}${control.protocolRole ? `/${control.protocolRole}` : ""}] ${control.label}`,
        ).join(" | ")}`,
      );
      lines.push(
        `  - Observable: ${interaction.observable.label} (${interaction.observable.representation})`,
      );
    }
    if (unit.interactiveVisual) {
      lines.push(
        `  - Routed visual: ${unit.interactiveVisual.visualType} (${unit.interactiveVisual.uniqueConcept})`,
      );
    }
    if (unit.teachingMediumPlan) {
      lines.push(`  - Preferred medium: ${unit.teachingMediumPlan.preferredMedium}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
