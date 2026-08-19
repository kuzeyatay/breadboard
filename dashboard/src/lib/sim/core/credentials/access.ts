// Breadboard stand-in for sim's lib/credentials/access.ts (simstudioai/sim, Apache-2.0).
// Sim resolves stored OAuth/service-account credential rows and their workspace
// memberships from Postgres. Breadboard's engine passes plain API keys through block
// config instead, so no credential is ever resolvable — callers (the Vertex path is the
// only one) surface a clear "credential not found" instead of silently succeeding.

export type CredentialType = "oauth" | "service_account" | "api_key" | "managed_oauth";

export interface CredentialRecord {
  id: string;
  workspaceId: string | null;
  type: CredentialType;
  accountId?: string | null;
}

export interface ActiveCredentialMember {
  userId: string;
}

export interface CredentialActorContext {
  credential: CredentialRecord | null;
  member: ActiveCredentialMember | null;
  hasWorkspaceAccess: boolean;
  canWriteWorkspace: boolean;
  isAdmin: boolean;
}

export function canUseCredential(access: CredentialActorContext): boolean {
  return access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin);
}

export async function getCredentialActorContext(
  _credentialId: string,
  _userId: string,
): Promise<CredentialActorContext> {
  return {
    credential: null,
    member: null,
    hasWorkspaceAccess: false,
    canWriteWorkspace: false,
    isAdmin: false,
  };
}
