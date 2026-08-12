// Real wiring for the Socials Manager: the SQLite-backed store on the shared app database,
// kept as a process-wide singleton so Next.js dev hot reloads reuse it the same
// way the db handle does. Routes import from here; tests import ./store.ts
// directly with an in-memory database.

import db from "../db.ts";
import { SocialsManagerStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardSocialsManagerStore?: SocialsManagerStore;
};

export function getSocialsManagerStore(): SocialsManagerStore {
  if (!globals.breadboardSocialsManagerStore) {
    globals.breadboardSocialsManagerStore = new SocialsManagerStore(db);
  }
  return globals.breadboardSocialsManagerStore;
}
