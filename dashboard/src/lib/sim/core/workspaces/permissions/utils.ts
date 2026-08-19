// Breadboard stand-in for sim's lib/workspaces/permissions/utils.ts (simstudioai/sim,
// Apache-2.0). Sim resolves workspace membership rows from Postgres. Breadboard runs the
// engine for the signed-in user in their own workspace, and the route that owns the
// request has already authorized it, so this reports access rather than re-deciding it.

export type WorkspacePermission = "read" | "write" | "admin";

export interface WorkspaceAccess {
  hasAccess: boolean;
  permission: WorkspacePermission | null;
}

export async function checkWorkspaceAccess(
  _workspaceId: string,
  _userId: string,
): Promise<WorkspaceAccess> {
  return { hasAccess: true, permission: "admin" };
}
