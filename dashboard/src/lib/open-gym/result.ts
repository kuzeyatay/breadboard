import type { OpenGymExercise } from "./catalog.ts";

export interface OpenGymAnimationReference {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
}

const MARKER = "OPEN_GYM_ANIMATIONS:";
const LEGACY_SAVE_NOTICE = "_This program is saved in openGym's persistent state; this launch had no artifact-capable conversation context._";

/** Clean up the application-authored diagnostic in already saved answers. */
export function openGymVisibleContent(content: string): string {
  return content.replace(LEGACY_SAVE_NOTICE,
    "Your program is saved in openGym, but couldn’t be added to this chat.");
}
const COMMENT_MARKER = new RegExp(
  `<!--\\s*${MARKER}\\s*([\\s\\S]*?)\\s*-->`,
  "g",
);
const BARE_MARKER = new RegExp(
  `^[\\t ]*${MARKER}([^\\r\\n]*)$`,
  "gm",
);

export function openGymAnimationReferences(
  exercises: Array<Pick<OpenGymExercise, "id" | "n" | "bp" | "eq">>,
): OpenGymAnimationReference[] {
  const seen = new Set<string>();
  return exercises.flatMap((exercise) => {
    if (seen.has(exercise.id)) return [];
    seen.add(exercise.id);
    return [{ id: exercise.id, name: exercise.n, bodyPart: exercise.bp, equipment: exercise.eq }];
  });
}

export function attachOpenGymAnimations(
  content: string,
  exercises: Array<Pick<OpenGymExercise, "id" | "n" | "bp" | "eq">>,
): string {
  const references = openGymAnimationReferences(exercises).slice(0, 12);
  if (!references.length) return content.trim();
  const marker = `<!--${MARKER}${encodeURIComponent(JSON.stringify(references))}-->`;
  return `${marker}\n${content.trim()}`;
}

export function parseOpenGymResult(content: string): {
  content: string;
  animations: OpenGymAnimationReference[];
} {
  const animations: OpenGymAnimationReference[] = [];
  const seen = new Set<string>();
  const collectAnimations = (payload: string) => {
    const raw = payload.replace(/-->\\s*$/, "").trim();
    const candidates = [raw];
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) candidates.push(decoded);
    } catch {
      // A damaged marker is still private metadata and must not reach Markdown.
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const row = item as Record<string, unknown>;
          if (
            typeof row.id === "string" && /^[a-z0-9_-]{1,80}$/i.test(row.id) &&
            typeof row.name === "string" &&
            !seen.has(row.id)
          ) {
            seen.add(row.id);
            animations.push({
              id: row.id,
              name: row.name.slice(0, 160),
              bodyPart: typeof row.bodyPart === "string" ? row.bodyPart.slice(0, 80) : "",
              equipment: typeof row.equipment === "string" ? row.equipment.slice(0, 80) : "",
            });
          }
        }
        break;
      } catch {
        // Try the decoded form next. The answer surrounding this marker stays.
      }
    }
  };
  let clean = content.replace(COMMENT_MARKER, (_marker, payload: string) => {
    collectAnimations(payload);
    return "";
  });
  // A model handoff may discard the HTML comment delimiters while preserving
  // the private marker line. Do not let that legacy form become visible prose.
  clean = clean.replace(BARE_MARKER, (_marker, payload: string) => {
    collectAnimations(payload);
    return "";
  });
  return {
    content: openGymVisibleContent(clean.trim()),
    animations: animations.slice(0, 12),
  };
}
