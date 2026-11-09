import type Database from "better-sqlite3";
import { MAX_SYSTEM_PROMPT_LENGTH, type SystemPromptDefinition, type SystemPromptEdit, type SystemPromptView } from "./types.ts";

interface PromptRow { content: string | null; revision: number; updated_at: string }

export class SystemPromptError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** SQLite transactions protect edits across tabs, workers and dashboard processes. */
export class SystemPromptStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS system_prompt_overrides (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt_id TEXT NOT NULL,
      content TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, prompt_id)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS system_prompt_installation_owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS system_prompt_installation_overrides (
      prompt_id TEXT PRIMARY KEY,
      content TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`);
  }

  private row(userId: number, id: string): PromptRow | undefined {
    return this.db.prepare("SELECT content, revision, updated_at FROM system_prompt_overrides WHERE user_id = ? AND prompt_id = ?")
      .get(userId, id) as PromptRow | undefined;
  }

  private installationRow(id: string): PromptRow | undefined {
    return this.db.prepare("SELECT content, revision, updated_at FROM system_prompt_installation_overrides WHERE prompt_id = ?")
      .get(id) as PromptRow | undefined;
  }

  private installationOwner(): number | null {
    return (this.db.prepare("SELECT user_id FROM system_prompt_installation_owner WHERE id = 1").get() as { user_id: number | null } | undefined)?.user_id ?? null;
  }

  content(userId: number | null | undefined, id: string, fallback: string, scope: SystemPromptDefinition["scope"] = "account"): string {
    if (scope === "installation") return this.installationRow(id)?.content ?? fallback;
    if (!Number.isSafeInteger(userId) || userId! <= 0) return fallback;
    return this.row(userId!, id)?.content ?? fallback;
  }

  view(userId: number, definition: SystemPromptDefinition): SystemPromptView {
    const installation = definition.scope === "installation";
    const row = installation ? this.installationRow(definition.id) : this.row(userId, definition.id);
    const owner = installation ? this.installationOwner() : null;
    return { ...definition, content: row?.content ?? definition.defaultContent,
      editable: !installation || owner === null || owner === userId,
      ...(installation ? { installationOwner: owner === null ? "unclaimed" as const : owner === userId ? "you" as const : "other-account" as const } : {}),
      customized: row?.content != null, revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null };
  }

  update(userId: number, edit: SystemPromptEdit, definitions: SystemPromptDefinition[]): SystemPromptView {
    const definition = definitions.find((item) => item.id === edit.id);
    if (!definition) throw new SystemPromptError(404, "System prompt not found.");
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new SystemPromptError(401, "Sign in to edit system prompts.");
    if (!Number.isSafeInteger(edit.revision) || edit.revision < 0) throw new SystemPromptError(400, "A valid prompt revision is required.");
    if (edit.content !== null && (typeof edit.content !== "string" || edit.content.length > MAX_SYSTEM_PROMPT_LENGTH || edit.content.includes("\0"))) {
      throw new SystemPromptError(400, `Use up to ${MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()} characters without null characters.`);
    }
    return this.db.transaction(() => {
      const current = this.view(userId, definition);
      if (current.editable === false) throw new SystemPromptError(403, "These installation-wide prompts are managed by another account.");
      if (edit.revision !== current.revision) throw new SystemPromptError(409, "This prompt changed in another window. Reload its latest version before saving.");
      const content = edit.content === definition.defaultContent ? null : edit.content;
      if (definition.scope === "installation") {
        // The evaluation uses four baseline sections together; the separate
        // repair request has its own per-prompt limit.
        const length = definitions.filter(item => item.scope === "installation" && item.id !== "maintenance-repair")
          .reduce((total, item) => total + (item.id === edit.id ? content ?? item.defaultContent
            : this.content(null, item.id, item.defaultContent, "installation")).length, 0);
        if (length > 180_000) throw new SystemPromptError(400, "The combined maintenance instructions are too long. Shorten this prompt before saving.");
        this.db.prepare(`INSERT INTO system_prompt_installation_owner (id, user_id) VALUES (1, ?)
          ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id WHERE system_prompt_installation_owner.user_id IS NULL`).run(userId);
        this.db.prepare(`INSERT INTO system_prompt_installation_overrides (prompt_id, content, revision, updated_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(prompt_id) DO UPDATE SET
          content = excluded.content, revision = excluded.revision, updated_at = excluded.updated_at`)
          .run(edit.id, content, current.revision + 1, new Date().toISOString());
        return this.view(userId, definition);
      }
      // Leave room for model identity, authority and turn context. Check the
      // complete catalog conservatively, so no combination silently clips edits.
      const length = definitions.filter(item => ["Chat", "Tools", "Voice", "Goals"].includes(item.group)).reduce((total, item) => total + (item.id === edit.id
        ? (content ?? item.defaultContent).length
        : this.content(userId, item.id, item.defaultContent).length), 0);
      // Only one persona runs at once. Reserve its full text and shared wrapper;
      // summing every installed specialist would reject ordinary edits.
      const scaffoldIds = ["agency-persona-wrapper", "agency-orchestration"];
      const editedLength = (item: SystemPromptDefinition) => (item.id === edit.id
        ? (content ?? item.defaultContent) : this.content(userId, item.id, item.defaultContent)).length;
      const personaLength = definitions.filter(item => item.id.startsWith("agency-") && !scaffoldIds.includes(item.id))
        .reduce((maximum, item) => Math.max(maximum, editedLength(item)), 0);
      const scaffoldingLength = definitions.filter(item => scaffoldIds.includes(item.id))
        .reduce((total, item) => total + editedLength(item), 0);
      const changesChat = ["Chat", "Tools", "Voice", "Goals"].includes(definition.group) || edit.id.startsWith("agency-");
      if (length > 180_000 || (changesChat && length + personaLength + scaffoldingLength > 180_000)) {
        throw new SystemPromptError(400, "The combined chat and specialist instructions are too long. Shorten this prompt before saving.");
      }
      this.db.prepare(`INSERT INTO system_prompt_overrides (user_id, prompt_id, content, revision, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, prompt_id) DO UPDATE SET
        content = excluded.content, revision = excluded.revision, updated_at = excluded.updated_at`)
        .run(userId, edit.id, content, current.revision + 1, new Date().toISOString());
      // Retain a revision on reset: an older tab must not resurrect a deleted edit.
      return this.view(userId, definition);
    }).immediate();
  }
}
