// One small SQL surface over two engines. The indexer is a rebuildable cache
// and always uses SQLite. The organization store holds the only copy of its
// data, so it uses Postgres when DATABASE_URL is set and SQLite for local work.
// Queries use `?` placeholders and portable SQL (TEXT ids and ISO timestamps).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function sqliteAdapter(database) {
  const api = {
    kind: "sqlite",
    async exec(sql) { database.exec(sql); },
    async run(sql, params = []) { const r = database.prepare(sql).run(...params); return { changes: Number(r.changes) }; },
    async all(sql, params = []) { return database.prepare(sql).all(...params); },
    async get(sql, params = []) { return database.prepare(sql).get(...params); },
    async tx(work) {
      database.exec("BEGIN IMMEDIATE");
      try { const result = await work(api); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    async close() { database.close(); },
  };
  return api;
}

const numbered = sql => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };

/** `client` is anything with pg's `query(text, params)`: a pg Pool, a pg Client, or PGlite. */
export function postgresAdapter(client, close = async () => {}) {
  const on = target => ({
    kind: "postgres",
    async exec(sql) { if (target.exec) await target.exec(sql); else await target.query(sql); },
    async run(sql, params = []) { const r = await target.query(numbered(sql), params); return { changes: r.rowCount ?? r.affectedRows ?? 0 }; },
    async all(sql, params = []) { return (await target.query(numbered(sql), params)).rows; },
    async get(sql, params = []) { return (await target.query(numbered(sql), params)).rows[0]; },
  });
  let queue = Promise.resolve();
  return {
    ...on(client),
    // Serialise transactions on one connection; the store's traffic is small.
    tx(work) {
      const next = queue.then(async () => {
        const session = client.connect ? await client.connect() : client;
        try {
          await session.query("BEGIN");
          const result = await work(on(session));
          await session.query("COMMIT");
          return result;
        } catch (error) { await session.query("ROLLBACK"); throw error; }
        finally { session.release?.(); }
      });
      queue = next.catch(() => {});
      return next;
    },
    close,
  };
}

export async function openDatabase({ url, file }) {
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 5, ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
    return postgresAdapter(pool, () => pool.end());
  }
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  return sqliteAdapter(database);
}
