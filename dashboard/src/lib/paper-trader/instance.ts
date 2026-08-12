// Real wiring for the desk's durable state: the SQLite store on the shared app
// database, kept as a process-wide singleton the way the db handle is, so
// Next.js dev hot reloads reuse it. Routes, the supervisor and the boot hook
// import from here; tests import ./store.ts directly with an in-memory database.
//
// **Why the singleton is rebuilt when this module is.** A cached instance
// outlives the code that made it. In development the module is re-evaluated on
// every edit while `globalThis` survives, so a store built an hour ago keeps
// answering — with the methods and the schema it had an hour ago. Adding a
// method and a column to this store did exactly that: the decision endpoint
// called `store.recordCycle()`, the cached object had never heard of it, and
// every request from the arena became a 500 for half a day while the desk sat
// there doing nothing. The migration behind it never ran either, for the same
// reason: the schema is applied by the constructor, and the constructor had
// already been and gone.
//
// A symbol created when this module is evaluated is the cheapest possible way to
// notice. In production the module loads once and this costs one comparison; in
// development it means a reloaded module always gets a store whose class and
// schema match the code that is running.

import db from "../db.ts";
import { PaperTraderStore } from "./store.ts";

/** Fresh on every evaluation of this module, which is the whole mechanism. */
const moduleGeneration = Symbol("paper-trader-store");

const globals = globalThis as typeof globalThis & {
  breadboardPaperTraderStore?: PaperTraderStore;
  breadboardPaperTraderStoreGeneration?: symbol;
};

export function getPaperTraderStore(): PaperTraderStore {
  if (
    !globals.breadboardPaperTraderStore ||
    globals.breadboardPaperTraderStoreGeneration !== moduleGeneration
  ) {
    // The constructor re-runs the schema, which is how an added column reaches a
    // database that was opened before it existed. Every migration in there is
    // idempotent, so doing this again is free.
    globals.breadboardPaperTraderStore = new PaperTraderStore(db);
    globals.breadboardPaperTraderStoreGeneration = moduleGeneration;
  }
  return globals.breadboardPaperTraderStore;
}
