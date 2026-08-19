// Breadboard stand-in for sim's lib/workflows/subblocks/options.ts (simstudioai/sim,
// Apache-2.0). These populate editor dropdowns from React Query against workspace API
// routes (managed sandboxes, workspace secrets). The engine never calls them — only the
// block configs that reference them are vendored — and Breadboard has neither feature,
// so each resolves to an empty option set.

export interface SubBlockOption {
  label: string;
  id: string;
}

export async function fetchWorkspaceSandboxOptions(_blockId: string): Promise<SubBlockOption[]> {
  return [];
}

export async function fetchWorkspaceSandboxOption(
  _blockId: string,
  _optionId: string,
): Promise<SubBlockOption | null> {
  return null;
}

export async function fetchWorkspaceSecretNameOptions(): Promise<SubBlockOption[]> {
  return [];
}
