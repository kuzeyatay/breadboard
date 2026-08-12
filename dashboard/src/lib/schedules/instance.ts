// Real wiring for scheduled chats: the SQLite-backed store on the shared app
// database, kept as a process-wide singleton so Next.js dev hot reloads reuse it
// the same way the db handle does. Routes and the scheduler import from here;
// tests import ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { ScheduledChatJobStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardScheduledChatStore?: ScheduledChatJobStore;
};

export function getScheduledChatJobStore(): ScheduledChatJobStore {
  if (!globals.breadboardScheduledChatStore) {
    globals.breadboardScheduledChatStore = new ScheduledChatJobStore(db);
  }
  return globals.breadboardScheduledChatStore;
}
