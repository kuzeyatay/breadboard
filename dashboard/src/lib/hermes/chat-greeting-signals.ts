import type Database from "better-sqlite3";

import {
  EMPTY_CHAT_GREETING_SIGNALS,
  type ChatGreetingGarden,
  type ChatGreetingSignals,
} from "./chat-greeting.ts";

/** A chat that was never named is not worth offering to resume by name. */
const PLACEHOLDER_CHAT_TITLE = "New chat";

/** Long enough for a real title, short enough to sit inside an opener card. */
const MAX_CHAT_TITLE_LENGTH = 48;

/** How many recent chats an opener may be built from. */
const RECENT_CHAT_LIMIT = 3;

/** How many recent gardens the greeting may name. */
const RECENT_GARDEN_LIMIT = 4;

/**
 * What the blank chat needs to know about the person opening it.
 *
 * Everything the greeting reacts to is counted here rather than shipped to the
 * browser wholesale: the client gets four numbers and two short lists, not a
 * history. Times come back as elapsed minutes and whole days, computed by
 * SQLite, so nothing downstream has to agree with anything else about which
 * timezone the stored stamps are in.
 */
export function readChatGreetingSignals(
  database: Database.Database,
  userId: number,
): ChatGreetingSignals {
  const user = database
    .prepare(
      `SELECT username, first_name,
              CAST(julianday('now') - julianday(created_at) AS INTEGER) AS days
         FROM users
        WHERE id = ?`,
    )
    .get(userId) as
    | { username: string | null; first_name: string | null; days: number | null }
    | undefined;
  if (!user) return EMPTY_CHAT_GREETING_SIGNALS;

  const gardenCount = (
    database
      .prepare("SELECT COUNT(*) AS value FROM clusters WHERE user_id = ?")
      .get(userId) as { value: number }
  ).value;

  // Freshest first. A garden that has never been opened falls back to when it
  // was made, so a brand-new one still counts as the thing on their mind.
  const recentGardens = (
    database
      .prepare(
        `SELECT name, slug
           FROM clusters
          WHERE user_id = ?
          ORDER BY COALESCE(last_viewed_at, created_at) DESC, id DESC
          LIMIT ?`,
      )
      .all(userId, RECENT_GARDEN_LIMIT) as Array<{ name: string; slug: string }>
  ).map((row): ChatGreetingGarden => ({ name: row.name, slug: row.slug }));

  // Temporary chats are excluded the same way they are everywhere else: a chat
  // kept out of history must not come back as a suggestion to resume it.
  const recentChats = (
    database
      .prepare(
        `SELECT title
           FROM conversations
          WHERE user_id = ? AND temporary = 0 AND title <> ?
          ORDER BY updated_at DESC, id DESC
          LIMIT ?`,
      )
      .all(userId, PLACEHOLDER_CHAT_TITLE, RECENT_CHAT_LIMIT * 2) as Array<{ title: string }>
  )
    .map((row) => (row.title ?? "").trim())
    .filter((title) => title.length > 0 && title.length <= MAX_CHAT_TITLE_LENGTH)
    .slice(0, RECENT_CHAT_LIMIT);

  const activity = database
    .prepare(
      `SELECT
         COALESCE(
           SUM(CASE WHEN date(m.created_at, 'localtime') = date('now', 'localtime') THEN 1 ELSE 0 END),
           0
         ) AS today,
         CAST((julianday('now') - julianday(MAX(m.created_at))) * 1440 AS INTEGER) AS minutes
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'`,
    )
    .get(userId) as { today: number | null; minutes: number | null };

  return {
    // Their own first name if they have given one, and only then the handle
    // they sign in with. Greeting someone by their username is the tell that
    // the product knows an account rather than a person.
    name: user.first_name?.trim() || user.username?.trim() || null,
    gardenCount: Number(gardenCount),
    recentGardens,
    recentChats,
    promptsToday: Number(activity.today ?? 0),
    // A clock skewed backwards would otherwise report a negative age and read
    // as "they were here in the future".
    minutesSinceLastPrompt:
      activity.minutes === null ? null : Math.max(0, Number(activity.minutes)),
    daysSinceJoined: Math.max(0, Number(user.days ?? 0)),
  };
}
