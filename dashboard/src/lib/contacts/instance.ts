// Real wiring for the address book: the SQLite-backed store on the shared app
// database, kept as a process-wide singleton so Next.js dev hot reloads reuse it
// the same way the db handle does. Routes import from here; tests import
// ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { ContactStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardContactStore?: ContactStore;
};

export function getContactStore(): ContactStore {
  if (!globals.breadboardContactStore) {
    globals.breadboardContactStore = new ContactStore(db);
  }
  return globals.breadboardContactStore;
}
