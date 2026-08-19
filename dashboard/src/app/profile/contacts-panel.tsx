"use client";

// The address book, on the profile page.
//
// Deliberately small: a search box, a list, and one row that opens into an
// editor. The interesting behaviour is not in this file — it is that most of
// the list writes itself, because everyone invited to an event you create is
// filed automatically (src/lib/contacts/calendar-capture.ts). The panel's job
// is to make that visible, correctable, and unsurprising: a learned row says so
// on its face, and editing one hands it to you for good.

import { useCallback, useEffect, useRef, useState } from "react";

import Badge from "./badge";
import type { Contact } from "@/lib/contacts/types.ts";

interface Draft {
  name: string;
  emails: string;
  organization: string;
  notes: string;
}

const EMPTY_DRAFT: Draft = { name: "", emails: "", organization: "", notes: "" };

function draftOf(contact: Contact): Draft {
  return {
    name: contact.name,
    emails: contact.emails.map((entry) => entry.email).join(", "),
    organization: contact.organization ?? "",
    notes: contact.notes ?? "",
  };
}

function payloadOf(draft: Draft) {
  return {
    name: draft.name.trim(),
    emails: draft.emails
      .split(/[,;\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    organization: draft.organization.trim() || null,
    notes: draft.notes.trim() || null,
  };
}

/** "last seen in March", or nothing at all when nobody has been seen yet. */
function whenSeen(stamp: string | null): string {
  if (!stamp) return "";
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return "";
  const now = new Date();
  const sameYear = when.getFullYear() === now.getFullYear();
  const month = when.toLocaleDateString(undefined, { month: "short" });
  return sameYear ? `${month} ${when.getDate()}` : `${month} ${when.getFullYear()}`;
}

const FIELD =
  "w-full rounded-lg border border-gray-800 bg-transparent px-2.5 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:border-gray-700 focus:outline-none";

export default function ContactsPanel({
  initial,
  initialTotal,
}: {
  initial: Contact[];
  initialTotal: number;
}) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    try {
      const response = await fetch(
        `/api/contacts?limit=200${search ? `&query=${encodeURIComponent(search)}` : ""}`,
      );
      if (!response.ok) return;
      const payload = await response.json();
      setContacts(payload.contacts ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      // An unreachable endpoint leaves the list exactly as it was rather than
      // blanking a panel that was showing something useful a moment ago.
    }
  }, []);

  // Typing searches, once the typing pauses. The list is small enough that the
  // round trip is cheap, and a debounce keeps it from firing per keystroke.
  // The first render is skipped: the page already handed us that list.
  const searched = useRef(false);
  useEffect(() => {
    if (!searched.current && !query) return;
    searched.current = true;
    const timer = setTimeout(() => void load(query.trim()), query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "That did not save.");
      }
      setOpenId(null);
      setDraft(EMPTY_DRAFT);
      await load(query.trim());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const learned = contacts.filter((contact) => contact.source === "auto").length;

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Address book</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Everyone you invite to something is filed here on its own. Correct a name and it is
          yours to keep.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a name, a company, an address"
          className={FIELD}
          aria-label="Search contacts"
        />
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            setOpenId(openId === "new" ? null : "new");
            setError(null);
          }}
          className="neu-button shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white"
        >
          {openId === "new" ? "Cancel" : "Add"}
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-[#a45f56]" role="alert">
          {error}
        </p>
      ) : null}

      {openId === "new" ? (
        <Editor
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onSave={() => void send("/api/contacts", "POST", payloadOf(draft))}
        />
      ) : null}

      <div className="mt-3 space-y-1">
        {contacts.length === 0 ? (
          <p className="neu-inset rounded-xl px-4 py-6 text-center text-xs text-gray-500">
            {query
              ? "Nobody here by that name."
              : "Empty for now. Invite someone to an event and they will appear."}
          </p>
        ) : (
          contacts.map((contact) => {
            const open = openId === contact.id;
            const primary = contact.emails[0]?.email ?? "";
            return (
              <div key={contact.id} className="neu-inset rounded-xl px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(open ? null : contact.id);
                    setDraft(draftOf(contact));
                    setError(null);
                  }}
                  className="flex w-full items-center justify-between gap-3 text-left"
                  aria-expanded={open}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-gray-200">
                      {contact.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                      {primary || "no address"}
                      {contact.organization ? ` · ${contact.organization}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {contact.emails.length > 1 ? (
                      <Badge title="Addresses filed under this person">
                        {contact.emails.length} addresses
                      </Badge>
                    ) : null}
                    {contact.source === "auto" ? (
                      <Badge tone="derived" title="Filed automatically from your calendar">
                        Learned
                      </Badge>
                    ) : null}
                    {contact.lastSeenAt ? (
                      <Badge tone="neutral" title="Most recent event with this person">
                        {whenSeen(contact.lastSeenAt)}
                      </Badge>
                    ) : null}
                  </span>
                </button>

                {open ? (
                  <Editor
                    draft={draft}
                    busy={busy}
                    onChange={setDraft}
                    onSave={() =>
                      void send(`/api/contacts/${contact.id}`, "PATCH", payloadOf(draft))
                    }
                    onDelete={() => void send(`/api/contacts/${contact.id}`, "DELETE")}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {contacts.length > 0 ? (
        <p className="mt-3 text-[11px] text-gray-600">
          {total} {total === 1 ? "person" : "people"}
          {learned > 0 ? `, ${learned} of them filed for you` : ""}.
        </p>
      ) : null}
    </section>
  );
}

function Editor({
  draft,
  busy,
  onChange,
  onSave,
  onDelete,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-gray-800 pt-2">
      <input
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
        placeholder="Name"
        className={FIELD}
        aria-label="Name"
      />
      <input
        value={draft.emails}
        onChange={(event) => onChange({ ...draft, emails: event.target.value })}
        placeholder="Email addresses, comma separated"
        className={FIELD}
        aria-label="Email addresses"
      />
      <input
        value={draft.organization}
        onChange={(event) => onChange({ ...draft, organization: event.target.value })}
        placeholder="Company (optional)"
        className={FIELD}
        aria-label="Company"
      />
      <input
        value={draft.notes}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        placeholder="Anything worth remembering (optional)"
        className={FIELD}
        aria-label="Notes"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !draft.name.trim()}
          onClick={onSave}
          className="neu-button-primary rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:opacity-50"
        >
          Save
        </button>
        {onDelete ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="neu-button rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:text-[#a45f56] disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
