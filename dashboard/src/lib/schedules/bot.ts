import type Database from "better-sqlite3";
import { BotsStore } from "../bots/store.ts";
import { botHandle } from "../bots/mentions.ts";

const addressee = /^(\s*)@([\p{L}\p{N}][\p{L}\p{M}\p{N}-]*)/u;

interface ScheduledBotAssignment {
  prompt: string;
  bot_id?: string | null;
}

export function scheduledBotId(db: Database.Database, userId: number, prompt: string, previous?: ScheduledBotAssignment) {
  const handle = prompt.match(addressee)?.[2]?.toLowerCase();
  if (!handle || handle === "bread") return null;
  if (previous?.bot_id && handle === previous.prompt.match(addressee)?.[2]?.toLowerCase()) return previous.bot_id;
  return new BotsStore(db).list(userId).find(bot => botHandle(bot.name) === handle)?.id ?? null;
}

export function scheduledBotPrompt(db: Database.Database, job: ScheduledBotAssignment & { user_id: number }) {
  if (!job.bot_id) return job.prompt;
  const store = new BotsStore(db);
  const bot = store.get(job.user_id, job.bot_id);
  const handle = botHandle(bot.name);
  if (store.list(job.user_id).filter(entry => botHandle(entry.name) === handle).length !== 1)
    throw new Error("This routine's bot needs a unique handle before it can run.");
  return job.prompt.replace(addressee, (_, space: string) => space + "@" + handle);
}
