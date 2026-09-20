import db from "./db.ts";
import { PageUnderstandingStore } from "./page-understanding-store.ts";

export const pageUnderstanding = new PageUnderstandingStore(db);
