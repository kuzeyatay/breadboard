// The SQLite-backed address book, run against an in-memory database.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  ContactError,
  ContactStore,
  MAX_EMAILS_PER_CONTACT,
  nameFromEmail,
} from "../src/lib/contacts/store.ts";
import { readContactPatch } from "../src/lib/contacts/payload.ts";

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return new ContactStore(db);
}

// ------------------------------------------------------------------ writing

test("a contact keeps its addresses, folded and with exactly one primary", () => {
  const store = createStore();
  const contact = store.createContact(1, {
    name: "Sarah Chen",
    emails: ["Sarah@Work.example", { email: "sarah@home.example", label: "home" }],
    organization: "Ithaca",
  });

  assert.equal(contact.name, "Sarah Chen");
  assert.deepEqual(
    contact.emails.map((entry) => entry.email),
    ["sarah@work.example", "sarah@home.example"],
  );
  assert.equal(contact.emails[0].primary, true);
  assert.equal(contact.emails[1].primary, false);
  assert.equal(contact.emails[1].label, "home");
  assert.equal(contact.source, "manual");
});

test("a flagged address becomes the primary one wherever it sits in the list", () => {
  const store = createStore();
  const contact = store.createContact(1, {
    name: "Sarah",
    emails: ["sarah@work.example", { email: "sarah@home.example", primary: true }],
  });

  assert.deepEqual(
    contact.emails.filter((entry) => entry.primary).map((entry) => entry.email),
    ["sarah@home.example"],
  );
});

test("an address already filed under someone else is refused by name", () => {
  const store = createStore();
  store.createContact(1, { name: "Sarah Chen", emails: ["shared@example.com"] });

  assert.throws(
    () => store.createContact(1, { name: "Someone Else", emails: ["shared@example.com"] }),
    (error) => error instanceof ContactError && error.status === 409 &&
      /already filed under Sarah Chen/.test(error.message),
  );
});

test("the same address on two accounts is two different people", () => {
  const store = createStore();
  store.createContact(1, { name: "Mine", emails: ["shared@example.com"] });
  const theirs = store.createContact(2, { name: "Theirs", emails: ["shared@example.com"] });

  assert.equal(theirs.emails[0].email, "shared@example.com");
  assert.equal(store.findByEmail(1, "shared@example.com").name, "Mine");
  assert.equal(store.findByEmail(2, "shared@example.com").name, "Theirs");
});

test("a malformed address is refused rather than stored", () => {
  const store = createStore();
  assert.throws(
    () => store.createContact(1, { name: "Nobody", emails: ["not-an-address"] }),
    (error) => error instanceof ContactError && error.status === 400,
  );
});

test("more addresses than a contact may hold is refused", () => {
  const store = createStore();
  const many = Array.from(
    { length: MAX_EMAILS_PER_CONTACT + 1 },
    (_, index) => `person${index}@example.com`,
  );
  assert.throws(
    () => store.createContact(1, { name: "Hydra", emails: many }),
    (error) => error instanceof ContactError && error.status === 400,
  );
});

test("editing a contact takes ownership of it", () => {
  const store = createStore();
  const { created } = store.rememberPeople(1, [{ email: "auto@example.com" }]);
  assert.equal(created, 1);

  const learned = store.findByEmail(1, "auto@example.com");
  assert.equal(learned.source, "auto");

  const edited = store.updateContact(1, learned.id, { name: "Real Name" });
  assert.equal(edited.source, "manual");
  assert.equal(edited.name, "Real Name");
});

test("a patch only touches the fields it names", () => {
  const store = createStore();
  const contact = store.createContact(1, {
    name: "Sarah",
    emails: ["sarah@example.com"],
    organization: "Ithaca",
    notes: "prefers mornings",
  });

  const patched = store.updateContact(1, contact.id, { favorite: true });
  assert.equal(patched.organization, "Ithaca");
  assert.equal(patched.notes, "prefers mornings");
  assert.equal(patched.emails.length, 1);
  assert.equal(patched.favorite, true);
});

test("deleting a contact takes its addresses with it", () => {
  const store = createStore();
  const contact = store.createContact(1, { name: "Sarah", emails: ["sarah@example.com"] });
  store.deleteContact(1, contact.id);

  assert.equal(store.findByEmail(1, "sarah@example.com"), null);
  // The address is free again, which it would not be if the row had survived.
  assert.ok(store.createContact(1, { name: "Someone", emails: ["sarah@example.com"] }));
});

test("another account's contact is not reachable", () => {
  const store = createStore();
  const contact = store.createContact(1, { name: "Sarah" });
  assert.throws(
    () => store.getContact(2, contact.id),
    (error) => error instanceof ContactError && error.status === 404,
  );
});

// ------------------------------------------------------------------ reading

test("search matches a name, an organization or an address", () => {
  const store = createStore();
  store.createContact(1, { name: "Sarah Chen", emails: ["sarah@ithaca.example"] });
  store.createContact(1, { name: "Tom Reed", organization: "Ithaca Labs" });
  store.createContact(1, { name: "Nobody Here", emails: ["nobody@elsewhere.example"] });

  const byName = store.listContacts(1, { query: "sarah" });
  assert.deepEqual(byName.map((c) => c.name), ["Sarah Chen"]);

  const byOrg = store.listContacts(1, { query: "ithaca" });
  assert.deepEqual(byOrg.map((c) => c.name).sort(), ["Sarah Chen", "Tom Reed"]);

  const byDomain = store.listContacts(1, { query: "@elsewhere" });
  assert.deepEqual(byDomain.map((c) => c.name), ["Nobody Here"]);
});

test("a wildcard typed into search is matched literally", () => {
  const store = createStore();
  store.createContact(1, { name: "Sarah Chen" });
  assert.equal(store.listContacts(1, { query: "%" }).length, 0);
});

test("favourites sort to the top", () => {
  const store = createStore();
  store.createContact(1, { name: "Aaron" });
  store.createContact(1, { name: "Zoe", favorite: true });

  assert.deepEqual(store.listContacts(1).map((c) => c.name), ["Zoe", "Aaron"]);
});

// ------------------------------------------------------- learning from dates

test("an unknown address becomes an automatic contact named from itself", () => {
  const store = createStore();
  const result = store.rememberPeople(1, [
    { email: "sarah.chen@example.com", seenAt: "2026-09-01T10:00" },
  ]);

  assert.deepEqual(result, { created: 1, updated: 0 });
  const learned = store.findByEmail(1, "sarah.chen@example.com");
  assert.equal(learned.name, "Sarah Chen");
  assert.equal(learned.source, "auto");
  assert.equal(learned.lastSeenAt, "2026-09-01T10:00");
});

test("a later sighting moves the stamp forward, an earlier one does not", () => {
  const store = createStore();
  store.rememberPeople(1, [{ email: "sarah@example.com", seenAt: "2026-09-01T10:00" }]);

  store.rememberPeople(1, [{ email: "sarah@example.com", seenAt: "2026-10-01T10:00" }]);
  assert.equal(store.findByEmail(1, "sarah@example.com").lastSeenAt, "2026-10-01T10:00");

  store.rememberPeople(1, [{ email: "sarah@example.com", seenAt: "2026-01-01T10:00" }]);
  assert.equal(store.findByEmail(1, "sarah@example.com").lastSeenAt, "2026-10-01T10:00");
});

test("an invite improves a guessed name but never overwrites a typed one", () => {
  const store = createStore();

  store.rememberPeople(1, [{ email: "s.chen@example.com" }]);
  assert.equal(store.findByEmail(1, "s.chen@example.com").name, "S Chen");

  store.rememberPeople(1, [{ email: "s.chen@example.com", name: "Sarah Chen" }]);
  assert.equal(store.findByEmail(1, "s.chen@example.com").name, "Sarah Chen");

  const typed = store.createContact(1, { name: "Tom Reed", emails: ["tom@example.com"] });
  store.rememberPeople(1, [{ email: "tom@example.com", name: "T. Reed (external)" }]);
  assert.equal(store.getContact(1, typed.id).name, "Tom Reed");
});

test("learning is idempotent and skips addresses it cannot use", () => {
  const store = createStore();
  const first = store.rememberPeople(1, [
    { email: "sarah@example.com" },
    { email: "not-an-address" },
    { email: "" },
  ]);
  assert.deepEqual(first, { created: 1, updated: 0 });

  const second = store.rememberPeople(1, [{ email: "SARAH@example.com" }]);
  assert.deepEqual(second, { created: 0, updated: 0 });
  assert.equal(store.countContacts(1), 1);
});

test("a name invented from an unhelpful address falls back to the address", () => {
  assert.equal(nameFromEmail("x@example.com"), "x@example.com");
  assert.equal(nameFromEmail("sarah_chen@example.com"), "Sarah Chen");
});

// ------------------------------------------------------------------ payload

test("the payload reader keeps absent fields absent and refuses a source", () => {
  assert.deepEqual(readContactPatch({ name: "Sarah" }), { name: "Sarah" });

  const patch = readContactPatch({
    name: "Sarah",
    emails: "sarah@example.com",
    notes: null,
    favorite: true,
    source: "auto",
  });
  assert.deepEqual(patch, {
    name: "Sarah",
    emails: ["sarah@example.com"],
    notes: null,
    favorite: true,
  });
});
