// SQLite-backed persistence for inbound webhook "Hooks". A plain module over
// an injected database handle (matching src/lib/schedules/store.ts) so it can
// be unit-tested against an in-memory SQLite database.

import type DatabaseType from "better-sqlite3";

import { pruneHookDeliveries } from "./schema.ts";
import { SUPPORTED_HOOK_PROVIDERS } from "@/lib/sim/triggers/providers/registry";

type Db = DatabaseType.Database;

export class HookError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HookError";
    this.status = status;
  }
}

export type HookMode = "chat" | "workflow";

export interface HookRow {
  id: string;
  user_id: number;
  name: string;
  provider: string;
  mode: HookMode;
  workflow_id: string | null;
  chat_instructions: string | null;
  provider_config: string;
  enabled: number;
  created_at: string;
  last_fired_at: string | null;
  fire_count: number;
  /** The garden this hook belongs to, or null for a dashboard-wide hook. */
  garden_slug: string | null;
}

export interface CreateHookInput {
  name: string;
  provider: string;
  mode: HookMode;
  workflowId?: string | null;
  chatInstructions?: string | null;
  providerConfig?: Record<string, unknown>;
  enabled?: boolean;
  gardenSlug?: string | null;
}

export type UpdateHookInput = Partial<{
  name: string;
  enabled: boolean;
  chatInstructions: string | null;
  workflowId: string | null;
  providerConfig: Record<string, unknown>;
}>;

const MAX_NAME_LENGTH = 120;
const MAX_INSTRUCTIONS_LENGTH = 8_000;
const URL_SAFE_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

/** A 21-character URL-safe id, used as the webhook path segment. */
function generateHookId(): string {
  const bytes = new Uint8Array(21);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < 21; i += 1) {
    id += URL_SAFE_ALPHABET[bytes[i] & 63];
  }
  return id;
}

function boundedText(value: unknown, max: number, field: string, required = true): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new HookError(400, `${field} is required.`);
  return text.slice(0, max);
}

function assertProvider(provider: string): void {
  if (!SUPPORTED_HOOK_PROVIDERS.includes(provider)) {
    throw new HookError(400, `Unknown hook provider: ${provider}`);
  }
}

function assertMode(mode: string): asserts mode is HookMode {
  if (mode !== "chat" && mode !== "workflow") {
    throw new HookError(400, "Hook mode must be 'chat' or 'workflow'.");
  }
}

export function createHook(userId: number, input: CreateHookInput, db: Db): HookRow {
  const name = boundedText(input.name, MAX_NAME_LENGTH, "Hook name");
  assertProvider(input.provider);
  assertMode(input.mode);

  if (input.mode === "workflow" && !input.workflowId) {
    throw new HookError(400, "A workflow hook needs a workflow to run.");
  }
  if (input.mode === "chat" && !input.chatInstructions?.trim()) {
    throw new HookError(400, "A chat hook needs instructions for the assistant.");
  }

  const id = generateHookId();
  db.prepare(
    `INSERT INTO hooks (id, user_id, name, provider, mode, workflow_id, chat_instructions, provider_config, enabled, garden_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    name,
    input.provider,
    input.mode,
    input.mode === "workflow" ? input.workflowId ?? null : null,
    input.mode === "chat"
      ? boundedText(input.chatInstructions, MAX_INSTRUCTIONS_LENGTH, "Chat instructions")
      : null,
    JSON.stringify(input.providerConfig ?? {}),
    input.enabled === false ? 0 : 1,
    input.gardenSlug?.trim() || null,
  );

  return getHookByIdForUser(id, userId, db)!;
}

/**
 * One user's hooks. `gardenSlug` narrows to the hooks of one garden — the
 * Garden panel's view; omitting it answers with everything, which is the
 * Terminal's.
 */
export function listHooksForUser(
  userId: number,
  db: Db,
  options: { gardenSlug?: string | null } = {},
): HookRow[] {
  const gardenSlug = options.gardenSlug?.trim() || null;
  if (gardenSlug) {
    return db
      .prepare(
        `SELECT * FROM hooks WHERE user_id = ? AND garden_slug = ? ORDER BY created_at DESC`,
      )
      .all(userId, gardenSlug) as HookRow[];
  }
  return db
    .prepare(`SELECT * FROM hooks WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as HookRow[];
}

export function getHookById(id: string, db: Db): HookRow | null {
  return (db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as HookRow | undefined) ?? null;
}

export function getHookByIdForUser(id: string, userId: number, db: Db): HookRow | null {
  return (
    (db.prepare(`SELECT * FROM hooks WHERE id = ? AND user_id = ?`).get(id, userId) as
      | HookRow
      | undefined) ?? null
  );
}

export function updateHook(
  id: string,
  userId: number,
  patch: UpdateHookInput,
  db: Db,
): HookRow {
  const existing = getHookByIdForUser(id, userId, db);
  if (!existing) throw new HookError(404, "Hook not found.");

  const name = patch.name !== undefined ? boundedText(patch.name, MAX_NAME_LENGTH, "Hook name") : existing.name;
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled;
  const chatInstructions =
    patch.chatInstructions !== undefined
      ? boundedText(patch.chatInstructions, MAX_INSTRUCTIONS_LENGTH, "Chat instructions", false) || null
      : existing.chat_instructions;
  const workflowId = patch.workflowId !== undefined ? patch.workflowId : existing.workflow_id;
  const providerConfig =
    patch.providerConfig !== undefined
      ? JSON.stringify(patch.providerConfig)
      : existing.provider_config;

  db.prepare(
    `UPDATE hooks SET name = ?, enabled = ?, chat_instructions = ?, workflow_id = ?, provider_config = ? WHERE id = ? AND user_id = ?`,
  ).run(name, enabled, chatInstructions, workflowId, providerConfig, id, userId);

  return getHookByIdForUser(id, userId, db)!;
}

export function deleteHook(id: string, userId: number, db: Db): boolean {
  const result = db.prepare(`DELETE FROM hooks WHERE id = ? AND user_id = ?`).run(id, userId);
  return result.changes > 0;
}

/** Bump last_fired_at/fire_count after a delivery has been accepted for dispatch. */
export function recordHookFire(id: string, db: Db): void {
  db.prepare(
    `UPDATE hooks SET last_fired_at = datetime('now'), fire_count = fire_count + 1 WHERE id = ?`,
  ).run(id);
}

/**
 * Claim a delivery for dedupe. Returns false when this (hookId, key) pair was
 * already seen — the caller must then skip dispatch. The PK on
 * `hook_deliveries` makes the INSERT OR IGNORE atomic: two concurrent
 * requests racing the same key can only have one of them succeed.
 */
export function recordDelivery(hookId: string, idempotencyKey: string, db: Db): boolean {
  // Opportunistic prune, cheap against the indexed received_at column — no
  // separate cron needed to keep the table from growing unbounded.
  pruneHookDeliveries(db);
  const result = db
    .prepare(`INSERT OR IGNORE INTO hook_deliveries (hook_id, idempotency_key) VALUES (?, ?)`)
    .run(hookId, idempotencyKey);
  return result.changes > 0;
}
