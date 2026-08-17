// What one account may see about another.
//
// Looking at someone else is a glance, not a destination: who they are, when
// they turned up, and which of their gardens you are actually allowed to open.
// The popup that shows it is a client component, so the shape lives here and
// the reading is done on the server behind the API route.
//
// Only the types cross into the browser; the reading stays here.

import db from "../db.ts";
import { formatLongDate } from "../calendar/format.ts";
import { organizationClusterClause } from "../organizations/store.ts";

/** One garden of theirs this viewer is allowed to open. */
export interface PersonProfileGarden {
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  organizationName: string | null;
}

export interface PersonProfile {
  username: string;
  /** "1 August 2026" — already formatted, since only the label is shown. */
  joined: string;
  /** True when someone opened their own handle; the caller sends them home. */
  isViewer: boolean;
  /** Organizations the viewer and this person are both in. */
  sharedOrganizations: string[];
  gardens: PersonProfileGarden[];
}

interface PersonRow {
  id: number;
  username: string;
  created_at: string;
}

/**
 * Read a person as one viewer is allowed to see them, or null when no such
 * account exists. Nothing here is filtered in the component: a garden that
 * this viewer cannot open never leaves the database.
 */
export function readPersonProfile(
  viewerId: number,
  username: string,
): PersonProfile | null {
  const person = db
    .prepare("SELECT id, username, created_at FROM users WHERE lower(username) = lower(?)")
    .get(username) as PersonRow | undefined;
  if (!person) return null;

  // Public gardens, plus anything shared with an organization they are both in.
  const gardens = db
    .prepare(
      `SELECT c.slug, c.name, c.description, c.visibility, o.name AS organizationName
       FROM clusters c
       LEFT JOIN organizations o ON o.id = c.organization_id
       WHERE c.user_id = ?
         AND (c.visibility = 'public' OR ${organizationClusterClause(viewerId, "c")})
       ORDER BY c.created_at DESC`,
    )
    .all(person.id) as PersonProfileGarden[];

  const shared = db
    .prepare(
      `SELECT o.name
       FROM organization_members a
       JOIN organization_members b
         ON b.organization_id = a.organization_id AND b.user_id = ?
       JOIN organizations o ON o.id = a.organization_id
       WHERE a.user_id = ?
       ORDER BY lower(o.name)`,
    )
    .all(viewerId, person.id) as { name: string }[];

  return {
    username: person.username,
    joined: formatLongDate(person.created_at.slice(0, 10)),
    isViewer: person.id === viewerId,
    sharedOrganizations: shared.map((row) => row.name),
    gardens,
  };
}
