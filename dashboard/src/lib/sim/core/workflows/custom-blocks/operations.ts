// Breadboard stand-in for sim's lib/workflows/custom-blocks/operations.ts (simstudioai/sim,
// Apache-2.0). Custom blocks are published workflows a workspace exposes as a block; the
// authority lookup and input-field derivation both read Postgres. Breadboard has no
// custom-block registry, so nothing binds and the agent handler treats the tool as unknown.

import type { WorkflowInputField } from "@/lib/sim/core/workflows/input-format";

export interface CustomBlockToolBinding {
  workflowId: string;
  /** LATEST-deployment Start input fields — the exact inputs the child will accept. */
  inputFields: WorkflowInputField[];
  /** Field ids (form keys) the publisher marked required. */
  requiredInputIds: string[];
}

export async function resolveCustomBlockToolBinding(
  _type: string,
  _consumerWorkspaceId: string | undefined,
): Promise<CustomBlockToolBinding | null> {
  return null;
}

export class CustomBlockValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomBlockValidationError";
  }
}
