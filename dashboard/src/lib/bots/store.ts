import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { BOT_SHAPES, type BotDefinition, type BotInput } from "./types.ts";
import { PREBUILT_BOTS } from "./presets.ts";

export class BotStoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validateBotInput(value: unknown): BotInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BotStoreError(400, "Invalid bot.");
  const input = value as Record<string, unknown>;
  function field(key: string, limit: number, required = true): string {
    const text = typeof input[key] === "string" ? input[key].trim() : "";
    if ((required && !text) || text.length > limit || /[\u0000-\u0008]/.test(text)) throw new BotStoreError(400, `${key} must contain ${required ? "1" : "0"}–${limit} characters.`);
    return text;
  }
  const avatar = input.avatar as Record<string, unknown> | null;
  if (!avatar || !BOT_SHAPES.includes(avatar.shape as never) ||
      typeof avatar.color !== "string" || !/^#[0-9a-f]{6}$/i.test(avatar.color) ||
      !["eyes", "mouth"].includes(String(avatar.face))) throw new BotStoreError(400, "Choose a valid avatar shape, color, and face.");
  return { name: field("name", 60), description: field("description", 180, false), personality: field("personality", 6000), avatar: { shape: avatar.shape as BotInput["avatar"]["shape"], color: avatar.color, face: avatar.face as "eyes" | "mouth" } };
}

interface BotRow { id: string; name: string; description: string; personality: string; avatar: string; prebuilt: number; archived: number; updated_at: string }
function present(row: BotRow): BotDefinition {
  return { id: row.id, name: row.name, description: row.description, personality: row.personality, avatar: JSON.parse(row.avatar), prebuilt: Boolean(row.prebuilt), archived: Boolean(row.archived), updatedAt: row.updated_at };
}

export class BotsStore {
  private db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_bots (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      personality TEXT NOT NULL, avatar TEXT NOT NULL,
      prebuilt INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS bot_chats (
      user_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, bot_id),
      FOREIGN KEY (user_id, bot_id) REFERENCES conversation_bots(user_id, id) ON DELETE CASCADE
    );`);
  }
  seed(userId: number): void {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO conversation_bots
      (user_id,id,name,description,personality,avatar,prebuilt) VALUES (?,?,?,?,?,?,1)`);
    this.db.transaction(() => { for (const bot of PREBUILT_BOTS) insert.run(userId, bot.id, bot.name, bot.description, bot.personality, JSON.stringify(bot.avatar)); })();
  }
  list(userId: number): BotDefinition[] {
    this.seed(userId);
    return (this.db.prepare("SELECT * FROM conversation_bots WHERE user_id=? AND archived=0 ORDER BY prebuilt DESC, name COLLATE NOCASE").all(userId) as BotRow[]).map(present);
  }
  get(userId: number, id: string, includeArchived = false): BotDefinition {
    const row = this.db.prepare(`SELECT * FROM conversation_bots WHERE user_id=? AND id=? ${includeArchived ? "" : "AND archived=0"}`).get(userId, id) as BotRow | undefined;
    if (!row) throw new BotStoreError(404, "Bot not found.");
    return present(row);
  }
  save(userId: number, value: unknown, id?: string): BotDefinition {
    const input = validateBotInput(value);
    if (id !== undefined) this.get(userId, id);
    else {
      this.seed(userId);
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM conversation_bots WHERE user_id=? AND archived=0").get(userId) as { n: number };
      if (count.n >= 100) throw new BotStoreError(400, "You can keep up to 100 bots. Remove one before creating another.");
    }
    const botId = id ?? `bot_${randomUUID()}`;
    if (id !== undefined) this.db.prepare(`UPDATE conversation_bots SET name=?,description=?,personality=?,avatar=?,updated_at=datetime('now') WHERE user_id=? AND id=?`).run(input.name, input.description, input.personality, JSON.stringify(input.avatar), userId, id);
    else this.db.prepare(`INSERT INTO conversation_bots(user_id,id,name,description,personality,avatar) VALUES (?,?,?,?,?,?)`).run(userId, botId, input.name, input.description, input.personality, JSON.stringify(input.avatar));
    return this.get(userId, botId);
  }
  archive(userId: number, id: string): void {
    this.get(userId, id);
    // Keep the identity and personality of existing chats. Removing a bot from
    // the roster must never erase a conversation or silently turn it into Bread.
    this.db.prepare("UPDATE conversation_bots SET archived=1,updated_at=datetime('now') WHERE user_id=? AND id=?").run(userId, id);
  }
  forConversation(userId: number, publicId: string): BotDefinition | null {
    const row = this.db.prepare(`SELECT b.* FROM conversation_bots b
      JOIN bot_chats bc ON bc.user_id=b.user_id AND bc.bot_id=b.id
      JOIN conversations c ON c.id=bc.conversation_id AND c.user_id=bc.user_id
      WHERE c.user_id=? AND c.public_id=?`).get(userId, publicId) as BotRow | undefined;
    return row ? present(row) : null;
  }
  chat(userId: number, botId: string, create: (name: string) => { id: number; public_id: string }): string {
    return this.db.transaction(() => {
      const bot = this.get(userId, botId);
      const current = this.db.prepare(`SELECT c.public_id FROM bot_chats b JOIN conversations c ON c.id=b.conversation_id AND c.user_id=b.user_id WHERE b.user_id=? AND b.bot_id=?`).get(userId, botId) as { public_id: string } | undefined;
      if (current) return current.public_id;
      const conversation = create(bot.name);
      const owner = this.db.prepare("SELECT user_id FROM conversations WHERE id=?").get(conversation.id) as { user_id: number } | undefined;
      if (owner?.user_id !== userId) throw new BotStoreError(403, "Conversation owner mismatch.");
      this.db.prepare("INSERT INTO bot_chats(user_id,bot_id,conversation_id) VALUES (?,?,?)").run(userId, botId, conversation.id);
      return conversation.public_id;
    })();
  }
}
