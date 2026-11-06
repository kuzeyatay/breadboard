import { SKILL_PRODUCT_DESCRIPTIONS } from "./skill-product-descriptions.ts";

type SkillDescriptionInput = {
  kind?: string;
  source?: string | null;
  sourceType?: string | null;
  upstreamId?: string;
  id?: string;
  slug?: string;
  description?: string | null;
};

/** Display copy only. Keep publisher descriptions and execution instructions intact. */
export function skillProductDescription(skill: SkillDescriptionInput): string {
  const original = skill.description ?? "";
  if ((skill.kind && skill.kind !== "skill") || skill.sourceType === "document") return original;

  const source = skill.source?.toLowerCase() ?? "";
  const publisher = source === "earthtojake/text-to-cad" ? "breadboard" : source;
  if (!Object.hasOwn(SKILL_PRODUCT_DESCRIPTIONS, publisher)) return original;
  const descriptions = SKILL_PRODUCT_DESCRIPTIONS[publisher];

  const id = (skill.upstreamId ?? skill.id ?? "").toLowerCase();
  const prefix = source === "breadboard" ? "breadboard:first-party/" : `${source}/`;
  // Canonical IDs survive command aliases and duplicate command names.
  // An explicitly different ID belongs to a custom skill, even if its source label matches.
  if (id && !id.startsWith(prefix)) return original;
  const slug = id ? id.slice(prefix.length) : skill.slug?.toLowerCase() ?? "";
  return Object.hasOwn(descriptions, slug) ? descriptions[slug] : original;
}
