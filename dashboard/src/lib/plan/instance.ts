// Real wiring for the Plan board: the SQLite-backed store on the shared app
// database, kept as a process-wide singleton so Next.js dev hot reloads reuse it
// the same way the db handle does. Routes import from here; tests import
// ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { PlanStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardPlanStore?: PlanStore;
};

export function getPlanStore(): PlanStore {
  if (!globals.breadboardPlanStore) {
    globals.breadboardPlanStore = new PlanStore(db);
  }
  return globals.breadboardPlanStore;
}
