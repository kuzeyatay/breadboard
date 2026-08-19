// Request-body → contact patch mapping, shared by the create and update routes.
//
// This layer only decides which fields the client *meant* to set (absent keys
// stay absent so a PATCH does not blank a field it never mentioned). All value
// validation — lengths, address shapes, who already owns an address — belongs
// to the store, so a create and an update cannot drift apart.

import type { ContactEmail, ContactPatch } from "./types.ts";

type Body = Record<string, unknown>;

/**
 * Shape-only. Bare strings are the common case (a pasted address); the object
 * form carries a label and the primary flag. Validity is the store's call.
 */
function readEmails(value: unknown): (string | Partial<ContactEmail>)[] | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return null;

  const emails: (string | Partial<ContactEmail>)[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      emails.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Body;
    emails.push({
      email: typeof raw.email === "string" ? raw.email : "",
      label: typeof raw.label === "string" ? raw.label : null,
      primary: raw.primary === true,
    });
  }
  return emails;
}

export function readContactPatch(body: Body): ContactPatch {
  const patch: ContactPatch = {};

  if (typeof body.name === "string") patch.name = body.name;
  if ("emails" in body) patch.emails = readEmails(body.emails);
  if (typeof body.organization === "string" || body.organization === null) {
    patch.organization = body.organization as string | null;
  }
  if (typeof body.phone === "string" || body.phone === null) {
    patch.phone = body.phone as string | null;
  }
  if (typeof body.notes === "string" || body.notes === null) {
    patch.notes = body.notes as string | null;
  }
  if (typeof body.favorite === "boolean") patch.favorite = body.favorite;

  // `source` is deliberately not readable from the wire. A row is automatic
  // only because the app learned it; anything arriving through the API is a
  // person typing, which the store records as manual.

  return patch;
}
