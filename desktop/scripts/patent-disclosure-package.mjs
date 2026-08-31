export const PATENT_DISCLOSURE_UPSTREAM_COMMIT =
  "ecd62fdb45b9792bb5fb2ebe8dc61157e04faab0";

const ROOT_FILES = new Set([
  "INSTALL.md",
  "LICENSE",
  "README.md",
  "SKILL.md",
]);

export const PATENT_DISCLOSURE_REQUIRED_FILES = Object.freeze([
  "LICENSE",
  "SKILL.md",
  "prompts/disclosure/intake.md",
  "prompts/disclosure/project_scan.md",
  "prompts/disclosure/disclosure_self_check.md",
  "prompts/reader/patent_plain_reader.md",
  "prompts/oa/guardrails.md",
  "references/patent_type_search.yaml",
  "references/schemas/figure_plan.schema.yaml",
]);

export function isPatentDisclosurePackageFile(relativePath) {
  return ROOT_FILES.has(relativePath) ||
    /^(?:docs|examples|prompts|references)\/.+\.(?:json|md|txt|ya?ml)$/iu.test(
      relativePath,
    );
}
