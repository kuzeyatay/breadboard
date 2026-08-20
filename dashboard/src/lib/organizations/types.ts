// Shapes the organization API answers with. Kept apart from the store so the
// profile panel can name them without reaching the database module.

export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationMember {
  userId: number;
  username: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
}

export interface OrganizationPendingInvite {
  id: number;
  username: string;
  email: string;
  role: OrganizationRole;
  createdAt: string;
}

export interface Organization {
  id: number;
  /** Opaque identifier used by private Knowledge Map deep links. */
  brainScopeId?: string;
  name: string;
  createdAt: string;
  role: OrganizationRole;
  members: OrganizationMember[];
  invites: OrganizationPendingInvite[];
}

export interface ReceivedInvite {
  id: number;
  organizationId: number;
  organizationName: string;
  role: OrganizationRole;
  invitedBy: string | null;
  createdAt: string;
}
