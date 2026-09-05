// Real wiring for scheduled chats: the SQLite-backed store on the shared app
// database, kept as a process-wide singleton so Next.js dev hot reloads reuse it
// the same way the db handle does. Routes and the scheduler import from here;
// tests import ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { ScheduledChatJobStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardScheduledChatStore?: ScheduledChatJobStore;
  breadboardScheduledChatStoreVersion?: number;
};

// Bump when the store constructor carries a new additive migration. Next dev
// keeps globals across hot reloads, so the version makes the migration apply
// immediately instead of waiting for a full app restart.
const SCHEDULE_STORE_VERSION = 2;

export function getScheduledChatJobStore(): ScheduledChatJobStore {
  if (
    !globals.breadboardScheduledChatStore ||
    globals.breadboardScheduledChatStoreVersion !== SCHEDULE_STORE_VERSION
  ) {
    globals.breadboardScheduledChatStore = new ScheduledChatJobStore(db);
    globals.breadboardScheduledChatStoreVersion = SCHEDULE_STORE_VERSION;
  }
  return globals.breadboardScheduledChatStore;
}
