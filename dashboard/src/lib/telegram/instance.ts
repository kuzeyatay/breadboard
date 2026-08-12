// Real wiring for the Telegram link: the SQLite store on the shared app database,
// kept as a process-wide singleton the way the db handle is, so Next.js dev hot
// reloads reuse it. Routes and the gateway import from here; tests import
// ./store.ts directly with an in-memory database.

import db from "../db.ts";
import { TelegramStore } from "./store.ts";

const globals = globalThis as typeof globalThis & {
  breadboardTelegramStore?: TelegramStore;
};

export function getTelegramStore(): TelegramStore {
  if (!globals.breadboardTelegramStore) {
    globals.breadboardTelegramStore = new TelegramStore(db);
  }
  return globals.breadboardTelegramStore;
}
