import type { OpenGymExercise } from "./catalog.ts";

export interface OpenGymAnimationReference {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
}

const MARKER = "OPEN_GYM_ANIMATIONS:";

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
  const expression = new RegExp(`<!--${MARKER}([^>]*)-->`, "g");
  const animations: OpenGymAnimationReference[] = [];
  const clean = content.replace(expression, (_marker, encoded: string) => {
    try {
      const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const row = item as Record<string, unknown>;
          if (
            typeof row.id === "string" && /^[a-z0-9_-]{1,80}$/i.test(row.id) &&
            typeof row.name === "string"
          ) {
            animations.push({
              id: row.id,
              name: row.name.slice(0, 160),
              bodyPart: typeof row.bodyPart === "string" ? row.bodyPart.slice(0, 80) : "",
              equipment: typeof row.equipment === "string" ? row.equipment.slice(0, 80) : "",
            });
          }
        }
      }
    } catch {
      // A damaged marker should not hide the answer around it.
    }
    return "";
  });
  return { content: clean.trim(), animations: animations.slice(0, 12) };
}
