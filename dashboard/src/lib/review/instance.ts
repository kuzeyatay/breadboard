// Real wiring for spaced repetition: the SQLite-backed store on the shared app
// database, kept as a process-wide singleton so Next.js dev hot reloads reuse it
// the same way the db handle does. Routes, the tick, and the inbound message
// handlers import from here; tests import ./store.ts directly with an in-memory
// database.

import db from "../db.ts";
import { ReviewStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardReviewStore?: ReviewStore;
};

export function getReviewStore(): ReviewStore {
  if (!globals.breadboardReviewStore) {
    globals.breadboardReviewStore = new ReviewStore(db);
  }
  return globals.breadboardReviewStore;
}
