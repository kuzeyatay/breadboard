// Real wiring for the WhatsApp link: the SQLite store on the shared app database,
// kept as a process-wide singleton the way the db handle is, so Next.js dev hot
// reloads reuse it. Routes and the bridge import from here; tests import
// ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { WhatsAppStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardWhatsAppStore?: WhatsAppStore;
};

export function getWhatsAppStore(): WhatsAppStore {
  if (!globals.breadboardWhatsAppStore) {
    globals.breadboardWhatsAppStore = new WhatsAppStore(db);
  }
  return globals.breadboardWhatsAppStore;
}
