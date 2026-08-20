import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  listOrganizations,
  type Organization,
} from "../organizations/store.ts";
import { organizationPublicId } from "./brain-graph-ids.ts";
import type { BrainScope, BrainScopeOption } from "./brain-graph-types.ts";

export interface AuthorizedOrganization extends Organization {
  publicId: string;
}

export interface AuthorizedGarden {
  id: number;
  ownerUserId: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: "private" | "organization" | "public";
  organizationId: number | null;
  createdAt: string;
  lastViewedAt: string | null;
  viewCount: number;
}

export interface BrainGraphAccessContext {
  database: Database.Database;
  userId: number;
  username: string;
  organizations: AuthorizedOrganization[];
  readableGardens: AuthorizedGarden[];
  writableGardens: AuthorizedGarden[];
}

export class BrainGraphAccessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BrainGraphAccessError";
    this.status = status;
    this.code = code;
  }
}

interface GardenRow {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: "private" | "organization" | "public";
  organization_id: number | null;
  created_at: string;
  last_viewed_at: string | null;
  view_count: number;
}

function toGarden(row: GardenRow): AuthorizedGarden {
  return {
    id: row.id,
    ownerUserId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    organizationId: row.organization_id,
    createdAt: row.created_at,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count,
  };
}

export function buildBrainGraphAccessContext(
  userId: number,
  database: Database.Database = db,
): BrainGraphAccessContext {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new BrainGraphAccessError(401, "unauthorized", "Sign in to view your Knowledge Map.");
  }

  const user = database
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId) as { username: string } | undefined;
  if (!user) {
    throw new BrainGraphAccessError(401, "unauthorized", "Sign in to view your Knowledge Map.");
  }

  const organizations = listOrganizations(userId, database).map((organization) => ({
    ...organization,
    publicId: organizationPublicId(organization.id),
  }));
  const organizationIds = organizations.map((organization) => organization.id);
  const organizationClause =
    organizationIds.length === 0
      ? "0"
      : `c.organization_id IN (${organizationIds.map(() => "?").join(",")})`;
  const rows = database
    .prepare(
      `SELECT c.id, c.user_id, c.name, c.slug, c.description, c.visibility,
              c.organization_id, c.created_at, c.last_viewed_at, c.view_count
       FROM clusters c
       WHERE c.user_id = ?
          OR (c.visibility = 'organization' AND ${organizationClause})
       ORDER BY lower(c.name), c.id`,
    )
    .all(userId, ...organizationIds) as GardenRow[];
  const readableGardens = rows.map(toGarden);

  return {
    database,
    userId,
    username: user.username,
    organizations,
    readableGardens,
    writableGardens: readableGardens.filter((garden) => garden.ownerUserId === userId),
  };
}

export function parseBrainScope(
  searchParams: URLSearchParams,
  context: BrainGraphAccessContext,
): BrainScope {
  const requested = searchParams.get("scope") ?? "personal";
  if (requested === "personal") return { kind: "personal" };
  if (requested === "all") return { kind: "all" };
  if (requested !== "organization") {
    throw new BrainGraphAccessError(400, "invalid_scope", "That Knowledge Map scope is not available.");
  }

  const publicId = searchParams.get("organization")?.trim() ?? "";
  const organization = context.organizations.find(
    (candidate) => candidate.publicId === publicId,
  );
  if (!organization) {
    // Missing, forged, foreign, and revoked identifiers are intentionally identical.
    throw new BrainGraphAccessError(404, "scope_not_found", "That Knowledge Map scope is not available.");
  }
  return { kind: "organization", organizationId: organization.publicId };
}

export function organizationForScope(
  context: BrainGraphAccessContext,
  scope: BrainScope,
): AuthorizedOrganization | null {
  if (scope.kind !== "organization") return null;
  return (
    context.organizations.find(
      (organization) => organization.publicId === scope.organizationId,
    ) ?? null
  );
}

export function gardensForScope(
  context: BrainGraphAccessContext,
  scope: BrainScope,
): AuthorizedGarden[] {
  if (scope.kind === "personal") {
    return context.readableGardens.filter((garden) => garden.ownerUserId === context.userId);
  }
  if (scope.kind === "all") return context.readableGardens;
  const organization = organizationForScope(context, scope);
  if (!organization) return [];
  return context.readableGardens.filter(
    (garden) =>
      garden.visibility === "organization" && garden.organizationId === organization.id,
  );
}

export function brainScopeOptions(
  context: BrainGraphAccessContext,
): BrainScopeOption[] {
  return [
    { id: "personal", kind: "personal", label: "Personal" },
    { id: "all", kind: "all", label: "All accessible" },
    ...context.organizations.map((organization) => ({
      id: organization.publicId,
      kind: "organization" as const,
      label: organization.name,
      organizationId: organization.publicId,
    })),
  ];
}
