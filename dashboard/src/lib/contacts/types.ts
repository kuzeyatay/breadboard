// Shared address-book types. Imported by the SQLite store, the route handlers
// and the profile panel alike, so nothing here may reach for node or next APIs.

/**
 * Where a contact came from.
 *
 * `manual` is a row you typed. `auto` is one the app learned by watching who
 * you actually work with — an attendee on an event you created, a name on a
 * calendar invite. The distinction is the whole point of the field: an
 * automatic row is a guess, is labelled as one in the UI, and is the only kind
 * a background pass is allowed to overwrite.
 */
export type ContactSource = "manual" | "auto";

export const CONTACT_SOURCES: readonly ContactSource[] = ["manual", "auto"];

export function isContactSource(value: unknown): value is ContactSource {
  return typeof value === "string" && (CONTACT_SOURCES as readonly string[]).includes(value);
}

export interface ContactEmail {
  email: string;
  /** "work", "home" — free text, or null when the address is unlabelled. */
  label: string | null;
  /** The address to use when something needs exactly one. */
  primary: boolean;
}

export interface Contact {
  id: number;
  name: string;
  organization: string | null;
  phone: string | null;
  notes: string | null;
  /** Pinned to the top of the list. */
  favorite: boolean;
  source: ContactSource;
  emails: ContactEmail[];
  /**
   * When this person was last seen on something dated — an event they were
   * invited to. Null for a contact nothing has referenced yet.
   */
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  name: string;
  /** Plain strings are accepted; the first address becomes the primary one. */
  emails?: readonly (string | Partial<ContactEmail>)[] | null;
  organization?: string | null;
  phone?: string | null;
  notes?: string | null;
  favorite?: boolean;
  source?: ContactSource;
}

export type ContactPatch = Partial<ContactInput>;

/** One person spotted on something dated, for {@link ContactStore.rememberPeople}. */
export interface SeenPerson {
  email: string;
  name?: string | null;
  /** Wall-clock stamp of the thing they were seen on, if it has a date. */
  seenAt?: string | null;
}
