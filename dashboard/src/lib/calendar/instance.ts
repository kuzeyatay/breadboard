// Real wiring for the calendar: the SQLite-backed store on the shared app
// database, kept as a process-wide singleton so Next.js dev hot reloads reuse it
// the same way the db handle does. Routes import from here; tests import
// ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { CalendarStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardCalendarStore?: CalendarStore;
};

export function getCalendarStore(): CalendarStore {
  if (!globals.breadboardCalendarStore) {
    globals.breadboardCalendarStore = new CalendarStore(db);
  }
  return globals.breadboardCalendarStore;
}
