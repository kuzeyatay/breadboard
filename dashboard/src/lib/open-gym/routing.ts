import {
  isExerciseTechniqueRequest,
  isFitnessProgramRequest,
  isOpenGymSuperAgentRoutingCandidate,
} from "./identity.ts";
import { searchOpenGymCatalog } from "./catalog.ts";

export interface OpenGymRoutingDecision {
  route: boolean;
  reason: "registered_exercise" | "fitness_program" | null;
  exercise?: { id: string; name: string; score: number };
}

const NO_ROUTE: OpenGymRoutingDecision = { route: false, reason: null };

/**
 * Deterministic Super Agent boundary. The model never gets a registered
 * exercise-form request, so it cannot replace the animation card with prose.
 */
export async function resolveOpenGymSuperAgentRoute(
  task: string,
): Promise<OpenGymRoutingDecision> {
  const normalizedTask = task.trim();
  if (!normalizedTask || !isOpenGymSuperAgentRoutingCandidate(normalizedTask)) {
    return NO_ROUTE;
  }
  if (isFitnessProgramRequest(normalizedTask)) {
    return { route: true, reason: "fitness_program" };
  }
  if (!isExerciseTechniqueRequest(normalizedTask)) return NO_ROUTE;

  const [match] = await searchOpenGymCatalog(normalizedTask, { limit: 1 });
  if (!match || match.score < 70) return NO_ROUTE;
  return {
    route: true,
    reason: "registered_exercise",
    exercise: { id: match.id, name: match.n, score: match.score },
  };
}
