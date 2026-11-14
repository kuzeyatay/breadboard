import type Database from "better-sqlite3";
import { STORAGE_POLICY } from "./policy.ts";

const initialized = new WeakSet<Database.Database>();
export function ensureStorageSchema(db: Database.Database): void {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), automatic INTEGER NOT NULL DEFAULT 1 CHECK(automatic IN (0,1)),
      owner_user_id INTEGER, compression_cursor INTEGER NOT NULL DEFAULT 0,
      last_result TEXT, inventory TEXT, updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO storage_settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS storage_disposable_files (
      relative_path TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('temporary','download','diagnostic')),
      identity TEXT NOT NULL, modified_ms REAL NOT NULL, byte_length INTEGER NOT NULL,
      released_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, cleanup_path TEXT
    );
    CREATE INDEX IF NOT EXISTS storage_disposable_expiry ON storage_disposable_files(released_at,lease_until);
    CREATE TABLE IF NOT EXISTS storage_maintenance_lease (
      id INTEGER PRIMARY KEY CHECK(id=1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  initialized.add(db);
}

export function storageSettings(db: Database.Database) {
  ensureStorageSchema(db);
  return db.prepare("SELECT * FROM storage_settings WHERE id=1").get() as {
    automatic: number; owner_user_id: number | null; compression_cursor: number;
    last_result: string | null; inventory: string | null;
  };
}

export function assertStorageOwner(db: Database.Database, userId: number): void {
  ensureStorageSchema(db);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw Object.assign(new Error("Sign in to manage storage."), { status: 401 });
  const settings = storageSettings(db);
  let owner = settings.owner_user_id;
  if (owner === null) {
    const hasOwner = db.prepare("SELECT 1 FROM sqlite_master WHERE name='system_prompt_installation_owner'").get();
    const configured = hasOwner ? db.prepare("SELECT user_id FROM system_prompt_installation_owner WHERE id=1").get() as { user_id: number | null } | undefined : undefined;
    owner = configured?.user_id ?? (db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id ?? null;
    if (owner !== null) db.prepare("UPDATE storage_settings SET owner_user_id=? WHERE id=1 AND owner_user_id IS NULL").run(owner);
  }
  if (owner !== userId) throw Object.assign(new Error("Only the installation owner can manage storage."), { status: 403 });
}

export function acquireStorageLease(db: Database.Database, holder: string, now: number): boolean {
  ensureStorageSchema(db);
  return db.prepare(`INSERT INTO storage_maintenance_lease(id,holder,expires_at) VALUES(1,?,?)
    ON CONFLICT(id) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at
    WHERE storage_maintenance_lease.expires_at<?`).run(holder, now + 60_000, now).changes === 1;
}

export function sqliteSpace(db: Database.Database) {
  const pageBytes = Number(db.pragma("page_size", { simple: true }));
  return {
    allocatedBytes: Number(db.pragma("page_count", { simple: true })) * pageBytes,
    reusableBytes: Number(db.pragma("freelist_count", { simple: true })) * pageBytes,
    incrementalVacuum: db.pragma("auto_vacuum", { simple: true }) === 2,
    reserveBytes: STORAGE_POLICY.reserveBytes,
  };
}
