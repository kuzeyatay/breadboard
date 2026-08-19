// Breadboard stand-in for sim's lib/workflows/custom-tools/operations.ts (simstudioai/sim,
// Apache-2.0). Custom tools are user-authored JSON-schema tools stored per workspace in
// Postgres. Breadboard does not vendor that feature, so lookups resolve to nothing and the
// agent handler logs "custom tool not found" for any `custom_`-prefixed tool id.

export interface CustomToolRecord {
  id: string;
  title: string;
  schema: Record<string, unknown>;
  code?: string;
}

export async function getCustomToolById(_params: {
  toolId: string;
  userId: string;
  workspaceId?: string;
}): Promise<CustomToolRecord | null> {
  return null;
}

export async function getCustomToolByIdOrTitle(_params: {
  identifier: string;
  userId: string;
  workspaceId?: string;
}): Promise<CustomToolRecord | null> {
  return null;
}
