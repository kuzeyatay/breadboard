// Local skill authoring modeled on Anthropic's skill-creator methodology
// (github.com/anthropics/skills, skills/skill-creator/SKILL.md): a skill is a
// named folder whose SKILL.md carries YAML frontmatter (name + description
// that says what it does AND when to use it) above imperative markdown
// instructions, with deep detail pushed into references/ docs so the body
// stays lean (progressive disclosure, <500 lines).
//
// This module is intentionally free of Node imports: the same validation runs
// in the creator UI, the create route, and unit tests. Authored skills never
// bypass the quarantine -> human review -> promotion boundary; this module
// only drafts and validates content.

export interface SkillReferenceDraft {
  filename: string;
  contents: string;
}

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  references?: SkillReferenceDraft[];
}

export interface SkillDraftValidation {
  issues: string[];
  warnings: string[];
}

// Agent Skills naming: lowercase letters, digits, and hyphens, starting with a
// letter, at most 64 characters. The name doubles as the folder and the slash
// command token.
export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;
export const SKILL_BODY_IDEAL_MAX_LINES = 500;
const REFERENCE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}\.md$/i;
const MAX_REFERENCES = 12;
const MAX_REFERENCE_CHARS = 200_000;
const MAX_INSTRUCTION_CHARS = 400_000;

// The description is the only text always in context, so it has to carry the
// triggering decision. Flag descriptions that describe "what" but never "when".
const TRIGGER_PHRASES =
  /\b(use (?:this )?(?:skill )?when|use for|use it when|when (?:the user|a user|you|someone|asked)|trigger|for (?:questions|requests|tasks) (?:about|involving))\b/i;

export function validateSkillDraft(draft: SkillDraft): SkillDraftValidation {
  const issues: string[] = [];
  const warnings: string[] = [];

  const name = draft.name.trim();
  if (!name) issues.push("A skill name is required.");
  else if (!SKILL_NAME_PATTERN.test(name)) {
    issues.push(
      "Skill names use lowercase letters, digits, and hyphens, start with a letter, and stay within 64 characters (for example study-note-formatter).",
    );
  }

  const description = draft.description.trim();
  if (!description) {
    issues.push("A description is required; it is how the skill gets found and triggered.");
  } else {
    if (description.length > SKILL_DESCRIPTION_MAX_CHARS) {
      issues.push(`The description must stay within ${SKILL_DESCRIPTION_MAX_CHARS} characters.`);
    }
    if (!TRIGGER_PHRASES.test(description)) {
      warnings.push(
        'The description says what the skill does but not when to use it. Add explicit triggering context (for example "Use when …") so the assistant knows when to reach for it.',
      );
    }
  }

  const instructions = draft.instructions.trim();
  if (!instructions) {
    issues.push("Instructions are required; they become the SKILL.md body.");
  } else {
    if (instructions.startsWith("---")) {
      issues.push(
        "Instructions must not carry their own YAML frontmatter; the creator writes the frontmatter from the name and description fields.",
      );
    }
    if (instructions.length > MAX_INSTRUCTION_CHARS) {
      issues.push("The instructions exceed the size limit for an authored skill.");
    }
    const lines = instructions.split(/\r?\n/).length;
    if (lines > SKILL_BODY_IDEAL_MAX_LINES) {
      warnings.push(
        `The body is ${lines} lines; the skill-creator guidance keeps SKILL.md under ${SKILL_BODY_IDEAL_MAX_LINES} lines and moves deep detail into reference docs that are loaded only when needed.`,
      );
    }
  }

  const references = draft.references ?? [];
  if (references.length > MAX_REFERENCES) {
    issues.push(`At most ${MAX_REFERENCES} reference docs are supported.`);
  }
  const seen = new Set<string>();
  for (const reference of references) {
    const filename = reference.filename.trim();
    if (!REFERENCE_FILENAME_PATTERN.test(filename)) {
      issues.push(
        `Reference doc "${filename || "(unnamed)"}" needs a plain markdown filename such as advanced-usage.md.`,
      );
      continue;
    }
    const key = filename.toLowerCase();
    if (seen.has(key)) issues.push(`Reference doc "${filename}" is listed twice.`);
    seen.add(key);
    if (!reference.contents.trim()) {
      issues.push(`Reference doc "${filename}" is empty.`);
    } else if (reference.contents.length > MAX_REFERENCE_CHARS) {
      issues.push(`Reference doc "${filename}" exceeds the size limit.`);
    }
    if (instructions && !instructions.includes(filename)) {
      warnings.push(
        `The instructions never point to references/${filename}; a doc the body never mentions will not be read. Tell the assistant when to open it.`,
      );
    }
  }

  return { issues, warnings };
}

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

export function composeSkillMarkdown(draft: SkillDraft): string {
  const body = draft.instructions.trim();
  return [
    "---",
    `name: ${draft.name.trim()}`,
    `description: ${yamlQuote(draft.description)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/** SKILL.md plus references/, ready for the quarantine boundary. */
export function buildSkillFiles(draft: SkillDraft): Record<string, string> {
  const files: Record<string, string> = { "SKILL.md": composeSkillMarkdown(draft) };
  for (const reference of draft.references ?? []) {
    files[`references/${reference.filename.trim()}`] = reference.contents;
  }
  return files;
}

// --- AI drafting -----------------------------------------------------------

const DRAFT_SYSTEM_PROMPT = `You draft Agent Skills following Anthropic's skill-creator methodology.

A skill is reusable procedural guidance an assistant loads when a matching task appears. Draft one skill from the user's intent, honoring these rules:

- name: lowercase letters, digits, and hyphens; starts with a letter; at most 64 characters; describes the capability (like "meeting-summarizer").
- description: one or two sentences covering BOTH what the skill does AND when to use it. Include explicit triggering context ("Use when ...") with the phrases a user would actually say, so the skill triggers reliably. Stay under 1024 characters.
- instructions: the SKILL.md body in imperative markdown. Give a concrete step-by-step workflow, specify the expected output format exactly (templates or labeled sections), and include a short input -> output example when it clarifies. Explain why a step matters instead of shouting ALL-CAPS rules. Keep it lean: cut anything that does not change behavior, and stay well under 500 lines.
- references: only when genuinely needed, move deep reference material into separate markdown docs and make the instructions say when to open each one. Most skills need none.

This skill is guidance only: it cannot grant tools, network access, or permissions, so never instruct the assistant to install software or contact external services.

Respond with a single JSON object, no prose and no code fences:
{"name": "...", "description": "...", "instructions": "...", "references": [{"filename": "advanced.md", "contents": "..."}]}
Omit "references" (or use []) when none are needed.`;

export function skillDraftMessages(
  intent: string,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: DRAFT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Draft a skill for this intent:\n\n${intent.trim()}`,
    },
  ];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Tolerant parse of the model's JSON draft. Returns null when unusable. */
export function parseSkillDraftResponse(raw: string): SkillDraft | null {
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const references = Array.isArray(record.references)
    ? record.references.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const reference = entry as Record<string, unknown>;
        const filename = asString(reference.filename).trim();
        const contents = asString(reference.contents);
        return filename && contents.trim() ? [{ filename, contents }] : [];
      })
    : [];
  const draft: SkillDraft = {
    name: normalizeSkillName(asString(record.name)),
    description: asString(record.description).trim().slice(0, SKILL_DESCRIPTION_MAX_CHARS),
    instructions: asString(record.instructions).trim().slice(0, MAX_INSTRUCTION_CHARS),
    references: references.slice(0, MAX_REFERENCES),
  };
  if (!draft.name && !draft.description && !draft.instructions) return null;
  return draft;
}

export function normalizeSkillName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-0-9]+|-+$/g, "")
    .slice(0, 64);
}
