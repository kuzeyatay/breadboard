// SQLite-backed address book.
//
// A plain class over an injected database handle (matching
// src/lib/calendar/store.ts) so it can be unit tested against an in-memory
// database. It owns every write to `contacts` / `contact_emails`.
//
// Two callers, two shapes. The profile panel edits people by hand and expects
// its input validated and its conflicts explained. The calendar hands over
// whoever appeared on an event and expects the address book to work out on its
// own who is new — that is `rememberPeople`, and it is deliberately the only
// method that writes without being asked to.

import type DatabaseType from "better-sqlite3";

import { ensureContactSchema } from "./schema.ts";
import {
  isContactSource,
  type Contact,
  type ContactEmail,
  type ContactInput,
  type ContactPatch,
  type ContactSource,
  type SeenPerson,
} from "./types.ts";

type Db = DatabaseType.Database;

export const MAX_CONTACTS_PER_USER = 5_000;
export const MAX_NAME_LENGTH = 120;
export const MAX_ORGANIZATION_LENGTH = 120;
export const MAX_PHONE_LENGTH = 40;
export const MAX_NOTES_LENGTH = 2_000;
export const MAX_EMAILS_PER_CONTACT = 8;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_LABEL_LENGTH = 24;

/** A page of the list. The panel shows far fewer; this is the ceiling. */
export const MAX_LIST_LIMIT = 500;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ContactError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ContactError";
    this.status = status;
  }
}

interface ContactRow {
  id: number;
  name: string;
  organization: string | null;
  phone: string | null;
  notes: string | null;
  favorite: number;
  source: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EmailRow {
  contact_id: number;
  email: string;
  label: string | null;
  is_primary: number;
}

function presentContact(row: ContactRow, emails: ContactEmail[]): Contact {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    phone: row.phone,
    notes: row.notes,
    favorite: row.favorite !== 0,
    source: isContactSource(row.source) ? row.source : "manual",
    emails,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ContactError(400, `${field} is required.`);
  if (text.length > max) {
    throw new ContactError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > max) {
    throw new ContactError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

/** Addresses are matched case-insensitively, so they are stored folded. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * A display name for someone we only have an address for. `sarah.chen@x.com`
 * reads better in a list as "Sarah Chen" than as the raw address, and the user
 * can always correct it — the row is labelled a guess either way.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const guess = local
    .split(/[._+-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
  return guess.length >= 2
    ? guess.slice(0, MAX_NAME_LENGTH)
    : email.slice(0, MAX_NAME_LENGTH);
}

function normalizeEmails(input: ContactInput["emails"]): ContactEmail[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) throw new ContactError(400, "Email addresses must be a list.");

  const seen = new Set<string>();
  const emails: ContactEmail[] = [];

  for (const entry of input) {
    const raw = typeof entry === "string" ? entry : entry?.email;
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw new ContactError(400, `"${email}" is not an email address.`);
    }
    if (seen.has(email)) continue;
    seen.add(email);

    emails.push({
      email,
      label:
        typeof entry === "string"
          ? null
          : optionalText(entry?.label, "Label", MAX_LABEL_LENGTH),
      primary: typeof entry === "string" ? false : entry?.primary === true,
    });

    if (emails.length > MAX_EMAILS_PER_CONTACT) {
      throw new ContactError(
        400,
        `A contact can hold up to ${MAX_EMAILS_PER_CONTACT} addresses.`,
      );
    }
  }

  // Exactly one primary, always: whichever was flagged first, else the first
  // address given. Downstream code can then read `emails[0]` without checking.
  const flagged = emails.findIndex((entry) => entry.primary);
  const primaryIndex = flagged === -1 ? 0 : flagged;
  return emails.map((entry, index) => ({ ...entry, primary: index === primaryIndex }));
}

export class ContactStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureContactSchema(db);
  }

  // ---------------------------------------------------------------- reading

  private emailsFor(contactIds: readonly number[]): Map<number, ContactEmail[]> {
    const byContact = new Map<number, ContactEmail[]>();
    if (!contactIds.length) return byContact;

    const placeholders = contactIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT contact_id, email, label, is_primary
           FROM contact_emails
          WHERE contact_id IN (${placeholders})
          ORDER BY is_primary DESC, id`,
      )
      .all(...contactIds) as EmailRow[];

    for (const row of rows) {
      const list = byContact.get(row.contact_id) ?? [];
      list.push({ email: row.email, label: row.label, primary: row.is_primary !== 0 });
      byContact.set(row.contact_id, list);
    }
    return byContact;
  }

  private hydrate(rows: ContactRow[]): Contact[] {
    const emails = this.emailsFor(rows.map((row) => row.id));
    return rows.map((row) => presentContact(row, emails.get(row.id) ?? []));
  }

  /**
   * The address book, favourites first. `query` matches a name, an
   * organization or any address, so typing half a domain finds everyone there.
   */
  listContacts(userId: number, options: { query?: string; limit?: number } = {}): Contact[] {
    const limit = Math.min(
      Math.max(1, Math.trunc(options.limit ?? MAX_LIST_LIMIT)),
      MAX_LIST_LIMIT,
    );
    const query = (options.query ?? "").trim();

    if (!query) {
      const rows = this.db
        .prepare(
          `SELECT * FROM contacts
            WHERE user_id = ?
            ORDER BY favorite DESC, name COLLATE NOCASE, id
            LIMIT ?`,
        )
        .all(userId, limit) as ContactRow[];
      return this.hydrate(rows);
    }

    const like = `%${query.replace(/[%_\\]/g, (char) => "\\" + char)}%`;
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.* FROM contacts c
           LEFT JOIN contact_emails e ON e.contact_id = c.id
          WHERE c.user_id = ?
            AND (c.name LIKE ? ESCAPE '\\'
              OR IFNULL(c.organization, '') LIKE ? ESCAPE '\\'
              OR IFNULL(e.email, '') LIKE ? ESCAPE '\\')
          ORDER BY c.favorite DESC, c.name COLLATE NOCASE, c.id
          LIMIT ?`,
      )
      .all(userId, like, like, like, limit) as ContactRow[];
    return this.hydrate(rows);
  }

  countContacts(userId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM contacts WHERE user_id = ?`)
      .get(userId) as { total: number };
    return row.total;
  }

  getContact(userId: number, contactId: number): Contact {
    const row = this.db
      .prepare(`SELECT * FROM contacts WHERE id = ? AND user_id = ?`)
      .get(contactId, userId) as ContactRow | undefined;
    if (!row) throw new ContactError(404, "That contact does not exist.");
    return this.hydrate([row])[0];
  }

  /** The person an address belongs to, or null when nobody claims it. */
  findByEmail(userId: number, email: string): Contact | null {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const row = this.db
      .prepare(
        `SELECT c.* FROM contacts c
           JOIN contact_emails e ON e.contact_id = c.id
          WHERE e.user_id = ? AND e.email = ?`,
      )
      .get(userId, normalized) as ContactRow | undefined;
    return row ? this.hydrate([row])[0] : null;
  }

  // ---------------------------------------------------------------- writing

  /**
   * Replace a contact's addresses.
   *
   * The unique index would reject an address already filed elsewhere with a
   * constraint error naming a column; checking first lets the panel say whose
   * card it is on instead, which is the only version of that message a person
   * can act on.
   */
  private writeEmails(
    userId: number,
    contactId: number,
    emails: readonly ContactEmail[],
  ): void {
    for (const entry of emails) {
      const owner = this.db
        .prepare(`SELECT contact_id FROM contact_emails WHERE user_id = ? AND email = ?`)
        .get(userId, entry.email) as { contact_id: number } | undefined;
      if (owner && owner.contact_id !== contactId) {
        const holder = this.db
          .prepare(`SELECT name FROM contacts WHERE id = ?`)
          .get(owner.contact_id) as { name: string } | undefined;
        throw new ContactError(
          409,
          `${entry.email} is already filed under ${holder?.name ?? "another contact"}.`,
        );
      }
    }

    this.db.prepare(`DELETE FROM contact_emails WHERE contact_id = ?`).run(contactId);
    const insert = this.db.prepare(
      `INSERT INTO contact_emails (contact_id, user_id, email, label, is_primary)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const entry of emails) {
      insert.run(contactId, userId, entry.email, entry.label, entry.primary ? 1 : 0);
    }
  }

  createContact(userId: number, input: ContactInput): Contact {
    if (this.countContacts(userId) >= MAX_CONTACTS_PER_USER) {
      throw new ContactError(
        409,
        `The address book holds up to ${MAX_CONTACTS_PER_USER} people.`,
      );
    }

    const name = requireText(input.name, "Name", MAX_NAME_LENGTH);
    const organization = optionalText(
      input.organization,
      "Organization",
      MAX_ORGANIZATION_LENGTH,
    );
    const phone = optionalText(input.phone, "Phone", MAX_PHONE_LENGTH);
    const notes = optionalText(input.notes, "Notes", MAX_NOTES_LENGTH);
    const emails = normalizeEmails(input.emails);
    const source: ContactSource = input.source === "auto" ? "auto" : "manual";

    const create = this.db.transaction((): number => {
      const result = this.db
        .prepare(
          `INSERT INTO contacts (user_id, name, organization, phone, notes, favorite, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, name, organization, phone, notes, input.favorite ? 1 : 0, source);
      const contactId = Number(result.lastInsertRowid);
      this.writeEmails(userId, contactId, emails);
      return contactId;
    });

    return this.getContact(userId, create());
  }

  /**
   * Patch a contact. Editing one by hand promotes it to `manual` — the user has
   * looked at the guess and taken ownership of it, so nothing that writes on
   * its own may rewrite it afterwards.
   */
  updateContact(userId: number, contactId: number, patch: ContactPatch): Contact {
    const current = this.getContact(userId, contactId);

    const name =
      patch.name === undefined
        ? current.name
        : requireText(patch.name, "Name", MAX_NAME_LENGTH);
    const organization =
      patch.organization === undefined
        ? current.organization
        : optionalText(patch.organization, "Organization", MAX_ORGANIZATION_LENGTH);
    const phone =
      patch.phone === undefined
        ? current.phone
        : optionalText(patch.phone, "Phone", MAX_PHONE_LENGTH);
    const notes =
      patch.notes === undefined
        ? current.notes
        : optionalText(patch.notes, "Notes", MAX_NOTES_LENGTH);
    const favorite = patch.favorite === undefined ? current.favorite : patch.favorite === true;
    const emails = patch.emails === undefined ? null : normalizeEmails(patch.emails);

    const apply = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE contacts
              SET name = ?, organization = ?, phone = ?, notes = ?, favorite = ?,
                  source = 'manual', updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
        )
        .run(name, organization, phone, notes, favorite ? 1 : 0, contactId, userId);
      if (emails) this.writeEmails(userId, contactId, emails);
    });
    apply();

    return this.getContact(userId, contactId);
  }

  deleteContact(userId: number, contactId: number): void {
    this.getContact(userId, contactId);
    this.db.prepare(`DELETE FROM contacts WHERE id = ? AND user_id = ?`).run(contactId, userId);
  }

  /**
   * File away everyone who turned up on something dated.
   *
   * An unknown address becomes an `auto` contact; a known one has its last-seen
   * stamp advanced, and gains a real name if all we had was the one invented
   * from its address. A `manual` row's name is never touched — the user's
   * spelling of someone's name outranks an invite's.
   */
  rememberPeople(
    userId: number,
    people: readonly SeenPerson[],
    options: { seenAt?: string | null } = {},
  ): { created: number; updated: number } {
    let created = 0;
    let updated = 0;
    if (!people.length) return { created, updated };

    const remember = this.db.transaction(() => {
      for (const person of people) {
        const email = normalizeEmail(person.email);
        if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) continue;

        const seenAt = person.seenAt ?? options.seenAt ?? null;
        const offered = typeof person.name === "string" ? person.name.trim() : "";
        const existing = this.findByEmail(userId, email);

        if (existing) {
          // A stamp only ever moves forward: replaying an old import must not
          // make someone look more recently seen than they are.
          const nextSeen =
            seenAt && (!existing.lastSeenAt || seenAt > existing.lastSeenAt)
              ? seenAt
              : existing.lastSeenAt;
          const nextName =
            existing.source === "auto" && offered && existing.name !== offered
              ? offered.slice(0, MAX_NAME_LENGTH)
              : existing.name;
          if (nextSeen !== existing.lastSeenAt || nextName !== existing.name) {
            this.db
              .prepare(
                `UPDATE contacts SET name = ?, last_seen_at = ?, updated_at = datetime('now')
                  WHERE id = ? AND user_id = ?`,
              )
              .run(nextName, nextSeen, existing.id, userId);
            updated += 1;
          }
          continue;
        }

        if (this.countContacts(userId) >= MAX_CONTACTS_PER_USER) break;

        const contact = this.createContact(userId, {
          name: offered ? offered.slice(0, MAX_NAME_LENGTH) : nameFromEmail(email),
          emails: [email],
          source: "auto",
        });
        if (seenAt) {
          this.db
            .prepare(`UPDATE contacts SET last_seen_at = ? WHERE id = ? AND user_id = ?`)
            .run(seenAt, contact.id, userId);
        }
        created += 1;
      }
    });
    remember();

    return { created, updated };
  }
}
