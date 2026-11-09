import { withCouncil as composeCouncil, type CouncilFields } from "../council.ts";
import { systemPromptText } from "./service.ts";

export type { CouncilFields, CouncilMode, CouncilTaskType } from "../council.ts";

/** Resolve the account's live identity or its current feature-run snapshot. */
export function withCouncil<T extends object>(params: T, council: CouncilFields, userId?: number | null): T {
  return composeCouncil(params, council, systemPromptText("council-identity", userId));
}
