import db from "../db.ts";
import { BotsStore } from "./store.ts";
let store: BotsStore | undefined;
export function botsStore(): BotsStore { return store ??= new BotsStore(db); }
