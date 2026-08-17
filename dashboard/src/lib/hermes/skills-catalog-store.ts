import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { load as loadYaml, JSON_SCHEMA } from "js-yaml";
import { databaseDir } from "../runtime-paths.ts";
import type {
  SkillsShAudit,
  SkillsShDetail,
  SkillsShRateLimit,
  SkillsShSkill,
  SkillsShView,
} from "./skills-sh-client.ts";

export type CatalogFilter =
  | "all"
  | "featured"
  | "scientific"
  | "reverse"
  | "design"
  | "engineering"
  | "office"
  /** Skills distilled from the user's own documents; served outside the catalog store. */
  | "documents"
  | "omh"
  | "coding"
  | "trending"
  | "hot"
  | "official"
  | "installed"
  | "updates"
  | "audited"
  | "unreviewed";

export interface CatalogSnapshotRecord extends SkillsShSkill {
  ranks: Partial<Record<SkillsShView, number>>;
  curated: boolean;
  slashCommand: string;
}

export interface LocalCatalogSnapshotRecord {
  record: CatalogSnapshotRecord;
  detail: SkillsShDetail;
  description: string | null;
}

export interface CatalogSkillRecord {
  upstreamId: string;
  source: string;
  slug: string;
  name: string;
  slashCommand: string;
  sourceType: string | null;
  installUrl: string | null;
  pageUrl: string | null;
  installs: number;
  duplicate: boolean;
  curated: boolean;
  rankAllTime: number | null;
  rankTrending: number | null;
  rankHot: number | null;
  description: string | null;
  upstreamHash: string | null;
  approvedHash: string | null;
  localHash: string | null;
  quarantineLocalHash: string | null;
  catalogRevision: string | null;
  installedPath: string | null;
  reviewStatus: string;
  installationStatus: string;
  updateStatus: string;
  upstreamStatus: string;
  lastSeenAt: string;
  lastSynchronizedAt: string;
  detailCheckedAt: string | null;
  files: Array<{ path: string; contents?: string }> | null;
  audits: SkillsShAudit[] | null;
}

export interface CatalogSyncStats {
  syncId: string;
  startedAt: string;
  completedAt: string;
  pagesFetched: number;
  recordsReceived: number;
  recordsAdded: number;
  recordsChanged: number;
  recordsUnlisted: number;
  cacheMaxAgeSeconds: number | null;
  rateLimit: SkillsShRateLimit;
}

export interface CatalogStatus {
  hasSnapshot: boolean;
  totalAvailable: number;
  stale: boolean;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  lastFailure: string | null;
  nextRefreshAt: string | null;
  rateLimit: SkillsShRateLimit | null;
  latestRun: Record<string, unknown> | null;
}

type SqliteDatabase = InstanceType<typeof Database>;

const storeCache = new Map<string, SkillsCatalogStore>();

export function catalogDatabasePath(): string {
  if (process.env.SKILLS_CATALOG_DB?.trim()) return path.resolve(process.env.SKILLS_CATALOG_DB.trim());
  return path.join(databaseDir(), "skills-catalog.db");
}

export function getSkillsCatalogStore(): SkillsCatalogStore {
  const filename = catalogDatabasePath();
  const cached = storeCache.get(filename);
  if (cached) return cached;
  const store = new SkillsCatalogStore(filename);
  storeCache.set(filename, store);
  return store;
}

export class SkillsCatalogStore {
  readonly filename: string;
  private readonly db: SqliteDatabase;

  constructor(filename: string) {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.db = new Database(this.filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
    storeCache.delete(this.filename);
  }

  beginSync(input: { syncId: string; startedAt: string; provider: string }): void {
    this.db.prepare(
      `INSERT INTO skills_catalog_sync_runs
        (sync_id, started_at, provider, status)
       VALUES (?, ?, ?, 'running')`,
    ).run(input.syncId, input.startedAt, input.provider);
  }

  failSync(syncId: string, message: string, rateLimit?: SkillsShRateLimit | null): void {
    const completedAt = new Date().toISOString();
    this.db.prepare(
      `UPDATE skills_catalog_sync_runs
       SET completed_at = ?, status = 'failed', failure_reason = ?, rate_limit_json = ?
       WHERE sync_id = ?`,
    ).run(completedAt, message.slice(0, 2_000), rateLimit ? JSON.stringify(rateLimit) : null, syncId);
    this.setMeta("last_attempt_at", completedAt);
    this.setMeta("last_failure", message.slice(0, 2_000));
    if (rateLimit) this.setMeta("rate_limit", JSON.stringify(rateLimit));
  }

  replaceSnapshot(input: {
    syncId: string;
    startedAt: string;
    records: CatalogSnapshotRecord[];
    pagesFetched: number;
    recordsReceived: number;
    cacheMaxAgeSeconds: number | null;
    rateLimit: SkillsShRateLimit;
  }): CatalogSyncStats {
    const completedAt = new Date().toISOString();
    const existing = new Map(
      (this.db.prepare(
        `SELECT upstream_id, source, slug, name, slash_command, source_type,
                install_url, page_url, installs, duplicate_flag, curated,
                rank_all_time, rank_trending, rank_hot, upstream_status
         FROM skills_catalog`,
      ).all() as Array<Record<string, unknown>>).map((row) => [String(row.upstream_id), row]),
    );
    let added = 0;
    let changed = 0;
    for (const record of input.records) {
      const previous = existing.get(record.id);
      if (!previous) added += 1;
      else if (metadataChanged(previous, record)) changed += 1;
    }
    const incomingIds = new Set(input.records.map((record) => record.id));
    const unlisted = [...existing.values()].filter(
      (row) => row.upstream_status === "available" && !incomingIds.has(String(row.upstream_id)),
    ).length;

    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE skills_catalog
         SET upstream_status = 'unlisted_upstream'
         WHERE upstream_status = 'available'`,
      ).run();
      const upsert = this.db.prepare(
        `INSERT INTO skills_catalog (
          upstream_id, source, slug, name, slash_command, source_type,
          install_url, page_url, installs, duplicate_flag, curated,
          rank_all_time, rank_trending, rank_hot, review_status,
          installation_status, update_status, upstream_status,
          last_seen_at, last_synchronized_at
        ) VALUES (
          @upstreamId, @source, @slug, @name, @slashCommand, @sourceType,
          @installUrl, @pageUrl, @installs, @duplicate, @curated,
          @rankAllTime, @rankTrending, @rankHot, 'unreviewed',
          'not_installed', 'not_installed', 'available',
          @completedAt, @completedAt
        )
        ON CONFLICT(upstream_id) DO UPDATE SET
          source = excluded.source,
          slug = excluded.slug,
          name = excluded.name,
          slash_command = excluded.slash_command,
          source_type = excluded.source_type,
          install_url = excluded.install_url,
          page_url = excluded.page_url,
          installs = excluded.installs,
          duplicate_flag = excluded.duplicate_flag,
          curated = excluded.curated,
          rank_all_time = excluded.rank_all_time,
          rank_trending = excluded.rank_trending,
          rank_hot = excluded.rank_hot,
          upstream_status = 'available',
          last_seen_at = excluded.last_seen_at,
          last_synchronized_at = excluded.last_synchronized_at`,
      );
      for (const record of input.records) {
        upsert.run({
          upstreamId: record.id,
          source: record.source,
          slug: record.slug,
          name: record.name,
          slashCommand: record.slashCommand,
          sourceType: record.sourceType,
          installUrl: record.installUrl,
          pageUrl: record.url,
          installs: record.installs,
          duplicate: Number(record.duplicate),
          curated: Number(record.curated),
          rankAllTime: record.ranks["all-time"] ?? null,
          rankTrending: record.ranks.trending ?? null,
          rankHot: record.ranks.hot ?? null,
          completedAt,
        });
      }
      this.db.prepare(
        `UPDATE skills_catalog_sync_runs SET
           completed_at = @completedAt,
           status = 'succeeded',
           pages_fetched = @pagesFetched,
           records_received = @recordsReceived,
           records_added = @recordsAdded,
           records_changed = @recordsChanged,
           records_unlisted = @recordsUnlisted,
           cache_max_age_seconds = @cacheMaxAgeSeconds,
           rate_limit_json = @rateLimit
         WHERE sync_id = @syncId`,
      ).run({
        syncId: input.syncId,
        completedAt,
        pagesFetched: input.pagesFetched,
        recordsReceived: input.recordsReceived,
        recordsAdded: added,
        recordsChanged: changed,
        recordsUnlisted: unlisted,
        cacheMaxAgeSeconds: input.cacheMaxAgeSeconds,
        rateLimit: JSON.stringify(input.rateLimit),
      });
      this.setMeta("last_attempt_at", completedAt);
      this.setMeta("last_successful_sync_at", completedAt);
      this.setMeta("last_failure", "");
      this.setMeta("cache_max_age_seconds", String(input.cacheMaxAgeSeconds ?? ""));
      this.setMeta("rate_limit", JSON.stringify(input.rateLimit));
    });
    transaction();
    return {
      syncId: input.syncId,
      startedAt: input.startedAt,
      completedAt,
      pagesFetched: input.pagesFetched,
      recordsReceived: input.recordsReceived,
      recordsAdded: added,
      recordsChanged: changed,
      recordsUnlisted: unlisted,
      cacheMaxAgeSeconds: input.cacheMaxAgeSeconds,
      rateLimit: input.rateLimit,
    };
  }

  list(input: {
    filter?: CatalogFilter;
    source?: string;
    query?: string;
    page?: number;
    perPage?: number;
    ids?: string[];
  } = {}): { skills: CatalogSkillRecord[]; page: number; perPage: number; total: number; hasMore: boolean } {
    const page = Math.max(0, Math.trunc(input.page ?? 0));
    const perPage = Math.min(100, Math.max(1, Math.trunc(input.perPage ?? 50)));
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    const filter = input.filter ?? "all";
    if (filter === "installed") clauses.push("installation_status = 'installed'");
    else if (filter === "updates") clauses.push("update_status = 'update_available'");
    else {
      clauses.push("upstream_status = 'available'");
      if (filter === "trending") clauses.push("rank_trending IS NOT NULL");
      if (filter === "hot") clauses.push("rank_hot IS NOT NULL");
      if (filter === "official") clauses.push("(curated = 1 OR lower(source_type) = 'official')");
      if (filter === "audited") clauses.push("audits_json IS NOT NULL AND audits_json != '[]'");
      if (filter === "unreviewed") clauses.push("review_status = 'unreviewed'");
    }
    const source = input.source?.trim().slice(0, 300);
    if (source) {
      clauses.push("source = ?");
      parameters.push(source);
    }
    const query = input.query?.trim().slice(0, 200);
    if (query) {
      clauses.push("(lower(name) LIKE ? ESCAPE '\\' OR lower(slug) LIKE ? ESCAPE '\\' OR lower(source) LIKE ? ESCAPE '\\' OR lower(COALESCE(description, '')) LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(query.toLowerCase())}%`;
      parameters.push(pattern, pattern, pattern, pattern);
    }
    if (input.ids?.length) {
      const ids = [...new Set(input.ids)].slice(0, 200);
      clauses.push(`upstream_id IN (${ids.map(() => "?").join(",")})`);
      parameters.push(...ids);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const order = filter === "trending"
      ? "rank_trending ASC, installs DESC"
      : filter === "hot"
        ? "rank_hot ASC, installs DESC"
        : "rank_all_time ASC NULLS LAST, installs DESC, name COLLATE NOCASE";
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM skills_catalog ${where}`).get(...parameters) as { count: number }).count);
    const rows = this.db.prepare(
      `SELECT * FROM skills_catalog ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).all(...parameters, perPage, page * perPage) as Array<Record<string, unknown>>;
    return {
      skills: rows.map(rowToCatalogSkill),
      page,
      perPage,
      total,
      hasMore: (page + 1) * perPage < total,
    };
  }

  get(upstreamId: string): CatalogSkillRecord | null {
    const row = this.db.prepare("SELECT * FROM skills_catalog WHERE upstream_id = ?").get(upstreamId) as Record<string, unknown> | undefined;
    return row ? rowToCatalogSkill(row) : null;
  }

  upsertLocalSnapshot(input: {
    records: LocalCatalogSnapshotRecord[];
    synchronizedAt?: string;
  }): { added: number; updated: number; total: number } {
    const synchronizedAt = input.synchronizedAt ?? new Date().toISOString();
    const existingIds = new Set(
      (this.db.prepare(
        `SELECT upstream_id FROM skills_catalog WHERE upstream_id IN (${input.records.map(() => "?").join(",") || "NULL"})`,
      ).all(...input.records.map(({ record }) => record.id)) as Array<{ upstream_id: string }>).map(
        (row) => row.upstream_id,
      ),
    );
    const upsert = this.db.prepare(
      `INSERT INTO skills_catalog (
        upstream_id, source, slug, name, slash_command, source_type,
        install_url, page_url, installs, duplicate_flag, curated,
        rank_all_time, rank_trending, rank_hot, description, upstream_hash,
        review_status, installation_status, update_status, upstream_status,
        last_seen_at, last_synchronized_at, detail_checked_at, files_json, audits_json
      ) VALUES (
        @upstreamId, @source, @slug, @name, @slashCommand, @sourceType,
        @installUrl, @pageUrl, @installs, @duplicate, @curated,
        @rankAllTime, @rankTrending, @rankHot, @description, @upstreamHash,
        'unreviewed', 'not_installed', 'not_installed', 'available',
        @synchronizedAt, @synchronizedAt, @synchronizedAt, @filesJson, '[]'
      )
      ON CONFLICT(upstream_id) DO UPDATE SET
        source = excluded.source,
        slug = excluded.slug,
        name = excluded.name,
        source_type = excluded.source_type,
        install_url = excluded.install_url,
        page_url = excluded.page_url,
        installs = MAX(skills_catalog.installs, excluded.installs),
        duplicate_flag = excluded.duplicate_flag,
        curated = MAX(skills_catalog.curated, excluded.curated),
        description = excluded.description,
        upstream_hash = excluded.upstream_hash,
        files_json = excluded.files_json,
        detail_checked_at = excluded.detail_checked_at,
        update_status = CASE
          WHEN skills_catalog.update_status = 'local_content_changed' THEN skills_catalog.update_status
          WHEN skills_catalog.approved_hash IS NOT NULL
            AND skills_catalog.approved_hash != excluded.upstream_hash THEN 'update_available'
          WHEN skills_catalog.installation_status = 'installed' THEN 'current'
          WHEN skills_catalog.review_status = 'quarantined' THEN skills_catalog.update_status
          ELSE 'not_installed'
        END,
        upstream_status = 'available',
        last_seen_at = excluded.last_seen_at,
        last_synchronized_at = excluded.last_synchronized_at`,
    );
    const transaction = this.db.transaction(() => {
      for (const { record, detail, description } of input.records) {
        upsert.run({
          upstreamId: record.id,
          source: record.source,
          slug: record.slug,
          name: record.name,
          slashCommand: record.slashCommand,
          sourceType: record.sourceType,
          installUrl: record.installUrl,
          pageUrl: record.url,
          installs: record.installs,
          duplicate: Number(record.duplicate),
          curated: Number(record.curated),
          rankAllTime: record.ranks["all-time"] ?? null,
          rankTrending: record.ranks.trending ?? null,
          rankHot: record.ranks.hot ?? null,
          description,
          upstreamHash: detail.hash,
          filesJson: detail.files ? JSON.stringify(detail.files) : null,
          synchronizedAt,
        });
      }
    });
    transaction();
    const added = input.records.filter(({ record }) => !existingIds.has(record.id)).length;
    return { added, updated: input.records.length - added, total: input.records.length };
  }

  saveDetail(upstreamId: string, detail: SkillsShDetail, audits: SkillsShAudit[]): CatalogSkillRecord {
    const current = this.get(upstreamId);
    if (!current) throw new Error("Skill is not present in the synchronized catalog");
    if (detail.id !== upstreamId) throw new Error("skills.sh detail identity does not match the catalog record");
    if (detail.source !== current.source || detail.slug !== current.slug) {
      throw new Error("skills.sh detail source does not match the catalog record");
    }
    const description = descriptionFromSkillMarkdown(detail.files?.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "");
    const updateStatus = !detail.hash || !detail.files
      ? current.installationStatus === "installed" ? "upstream_unavailable" : "not_installed"
      : current.approvedHash && current.approvedHash !== detail.hash
      ? "update_available"
      : current.installationStatus === "installed"
        ? "current"
        : "not_installed";
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE skills_catalog SET
         upstream_hash = ?, description = ?, files_json = ?, audits_json = ?,
         detail_checked_at = ?, update_status = ?
       WHERE upstream_id = ?`,
    ).run(detail.hash, description, detail.files ? JSON.stringify(detail.files) : null, JSON.stringify(audits), now, updateStatus, upstreamId);
    return this.get(upstreamId)!;
  }

  saveDescription(upstreamId: string, detail: SkillsShDetail): CatalogSkillRecord {
    const current = this.get(upstreamId);
    if (!current) throw new Error("Skill is not present in the synchronized catalog");
    if (detail.id !== upstreamId) throw new Error("skills.sh detail identity does not match the catalog record");
    if (detail.source !== current.source || detail.slug !== current.slug) {
      throw new Error("skills.sh detail source does not match the catalog record");
    }
    const description = descriptionFromSkillMarkdown(
      detail.files?.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "",
    );
    this.db.prepare(
      `UPDATE skills_catalog SET
         description = COALESCE(?, description), detail_checked_at = ?
       WHERE upstream_id = ?`,
    ).run(description, new Date().toISOString(), upstreamId);
    return this.get(upstreamId)!;
  }

  markQuarantined(input: {
    upstreamId: string;
    upstreamHash: string;
    localHash: string;
    catalogRevision: string;
    revisionKey: string;
  }): void {
    this.db.prepare(
      `UPDATE skills_catalog SET review_status = 'quarantined',
       update_status = CASE WHEN approved_hash IS NULL THEN 'reviewing' ELSE 'reviewing_update' END,
       upstream_hash = ?, quarantine_revision = ?, quarantine_local_hash = ?, catalog_revision = ?
       WHERE upstream_id = ?`,
    ).run(
      input.upstreamHash,
      input.revisionKey,
      input.localHash,
      input.catalogRevision,
      input.upstreamId,
    );
  }

  markInstalled(input: {
    upstreamId: string;
    approvedHash: string;
    localHash: string;
    installedPath: string;
  }): void {
    this.db.prepare(
      `UPDATE skills_catalog SET
         approved_hash = ?, local_hash = ?, installed_path = ?,
         review_status = 'approved', installation_status = 'installed',
         update_status = 'current', quarantine_revision = NULL,
         quarantine_local_hash = NULL
       WHERE upstream_id = ?`,
    ).run(input.approvedHash, input.localHash, input.installedPath, input.upstreamId);
  }

  markQuarantineRejected(upstreamId: string): void {
    this.db.prepare(
      `UPDATE skills_catalog SET
         review_status = CASE WHEN installation_status = 'installed' THEN 'approved' ELSE 'unreviewed' END,
         update_status = CASE
           WHEN installation_status = 'installed' AND upstream_hash != approved_hash THEN 'update_available'
           WHEN installation_status = 'installed' THEN 'current'
           ELSE 'not_installed'
         END,
         quarantine_revision = NULL, quarantine_local_hash = NULL,
         catalog_revision = CASE WHEN installation_status = 'installed' THEN approved_hash ELSE NULL END
       WHERE upstream_id = ?`,
    ).run(upstreamId);
  }

  markRemoved(upstreamId: string): void {
    this.db.prepare(
      `UPDATE skills_catalog SET approved_hash = NULL, local_hash = NULL,
       installed_path = NULL, review_status = 'unreviewed',
       installation_status = 'not_installed', update_status = 'not_installed',
       quarantine_revision = NULL, quarantine_local_hash = NULL, catalog_revision = NULL
       WHERE upstream_id = ?`,
    ).run(upstreamId);
  }

  markLocalModification(upstreamId: string): void {
    this.db.prepare(
      "UPDATE skills_catalog SET update_status = 'local_content_changed' WHERE upstream_id = ?",
    ).run(upstreamId);
  }

  markUpstreamUnavailable(upstreamId: string): void {
    this.db.prepare(
      `UPDATE skills_catalog SET update_status =
       CASE WHEN installation_status = 'installed' THEN 'upstream_unavailable' ELSE update_status END
       WHERE upstream_id = ?`,
    ).run(upstreamId);
  }

  status(staleAfterMs = configuredStaleMs()): CatalogStatus {
    const available = Number((this.db.prepare(
      "SELECT COUNT(*) AS count FROM skills_catalog WHERE upstream_status = 'available'",
    ).get() as { count: number }).count);
    const lastSuccess = this.meta("last_successful_sync_at");
    const cacheSeconds = Number(this.meta("cache_max_age_seconds"));
    const requiredAge = Math.max(
      Number.isFinite(cacheSeconds) ? cacheSeconds * 1_000 : 0,
      staleAfterMs,
    );
    const stale = !lastSuccess || Date.now() - Date.parse(lastSuccess) >= requiredAge;
    const latest = this.db.prepare(
      "SELECT * FROM skills_catalog_sync_runs ORDER BY started_at DESC, rowid DESC LIMIT 1",
    ).get() as Record<string, unknown> | undefined;
    return {
      hasSnapshot: available > 0,
      totalAvailable: available,
      stale,
      lastSuccessfulSyncAt: lastSuccess,
      lastAttemptAt: this.meta("last_attempt_at"),
      lastFailure: this.meta("last_failure") || null,
      nextRefreshAt: lastSuccess ? new Date(Date.parse(lastSuccess) + requiredAge).toISOString() : null,
      rateLimit: parseJson<SkillsShRateLimit>(this.meta("rate_limit")),
      latestRun: latest ? normalizeSyncRow(latest) : null,
    };
  }

  syncRuns(limit = 20): Array<Record<string, unknown>> {
    return (this.db.prepare(
      "SELECT * FROM skills_catalog_sync_runs ORDER BY started_at DESC, rowid DESC LIMIT ?",
    ).all(Math.min(100, Math.max(1, limit))) as Array<Record<string, unknown>>).map(normalizeSyncRow);
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO skills_catalog_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  private meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM skills_catalog_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills_catalog (
        upstream_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        slash_command TEXT NOT NULL,
        source_type TEXT,
        install_url TEXT,
        page_url TEXT,
        installs INTEGER NOT NULL DEFAULT 0,
        duplicate_flag INTEGER NOT NULL DEFAULT 0,
        curated INTEGER NOT NULL DEFAULT 0,
        rank_all_time INTEGER,
        rank_trending INTEGER,
        rank_hot INTEGER,
        description TEXT,
        upstream_hash TEXT,
        approved_hash TEXT,
        local_hash TEXT,
        installed_path TEXT,
        review_status TEXT NOT NULL DEFAULT 'unreviewed',
        installation_status TEXT NOT NULL DEFAULT 'not_installed',
        update_status TEXT NOT NULL DEFAULT 'not_installed',
        upstream_status TEXT NOT NULL DEFAULT 'available',
        last_seen_at TEXT NOT NULL,
        last_synchronized_at TEXT NOT NULL,
        detail_checked_at TEXT,
        files_json TEXT,
        audits_json TEXT,
        quarantine_revision TEXT,
        quarantine_local_hash TEXT,
        catalog_revision TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_skills_catalog_slug ON skills_catalog(slug);
      CREATE INDEX IF NOT EXISTS idx_skills_catalog_available_rank ON skills_catalog(upstream_status, rank_all_time);
      CREATE INDEX IF NOT EXISTS idx_skills_catalog_installation ON skills_catalog(installation_status, update_status);

      CREATE TABLE IF NOT EXISTS skills_catalog_sync_runs (
        sync_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        pages_fetched INTEGER NOT NULL DEFAULT 0,
        records_received INTEGER NOT NULL DEFAULT 0,
        records_added INTEGER NOT NULL DEFAULT 0,
        records_changed INTEGER NOT NULL DEFAULT 0,
        records_unlisted INTEGER NOT NULL DEFAULT 0,
        cache_max_age_seconds INTEGER,
        rate_limit_json TEXT,
        failure_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS skills_catalog_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.ensureColumn("skills_catalog", "quarantine_local_hash", "TEXT");
    this.ensureColumn("skills_catalog", "catalog_revision", "TEXT");
  }

  private ensureColumn(table: string, column: string, declaration: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((value) => value.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }
  }
}

export function collisionCommands(records: SkillsShSkill[]): Map<string, string> {
  const slugCounts = new Map<string, number>();
  for (const record of records) slugCounts.set(record.slug, (slugCounts.get(record.slug) ?? 0) + 1);
  const preliminary = records.map((record) => {
    if (slugCounts.get(record.slug) === 1) return { id: record.id, command: record.slug };
    const [owner = "source", repository = "skill"] = record.source.split("/");
    return { id: record.id, command: `${owner}:${record.slug}`, fallback: `${owner}-${repository}:${record.slug}` };
  });
  const counts = new Map<string, number>();
  for (const value of preliminary) counts.set(value.command, (counts.get(value.command) ?? 0) + 1);
  return new Map(preliminary.map((value) => [
    value.id,
    counts.get(value.command) === 1
      ? value.command
      : `${value.fallback}-${crypto.createHash("sha256").update(value.id).digest("hex").slice(0, 6)}`,
  ]));
}

export function configuredStaleMs(): number {
  const minutes = Number(process.env.SKILLS_CATALOG_SYNC_INTERVAL_MINUTES ?? 15);
  return (Number.isFinite(minutes) ? Math.max(5, minutes) : 15) * 60_000;
}

function rowToCatalogSkill(row: Record<string, unknown>): CatalogSkillRecord {
  return {
    upstreamId: String(row.upstream_id),
    source: String(row.source),
    slug: String(row.slug),
    name: String(row.name),
    slashCommand: String(row.slash_command),
    sourceType: nullable(row.source_type),
    installUrl: nullable(row.install_url),
    pageUrl: nullable(row.page_url),
    installs: Number(row.installs),
    duplicate: Boolean(row.duplicate_flag),
    curated: Boolean(row.curated),
    rankAllTime: nullableNumber(row.rank_all_time),
    rankTrending: nullableNumber(row.rank_trending),
    rankHot: nullableNumber(row.rank_hot),
    description: nullable(row.description),
    upstreamHash: nullable(row.upstream_hash),
    approvedHash: nullable(row.approved_hash),
    localHash: nullable(row.local_hash),
    quarantineLocalHash: nullable(row.quarantine_local_hash),
    catalogRevision: nullable(row.catalog_revision),
    installedPath: nullable(row.installed_path),
    reviewStatus: String(row.review_status),
    installationStatus: String(row.installation_status),
    updateStatus: String(row.update_status),
    upstreamStatus: String(row.upstream_status),
    lastSeenAt: String(row.last_seen_at),
    lastSynchronizedAt: String(row.last_synchronized_at),
    detailCheckedAt: nullable(row.detail_checked_at),
    files: parseJson<Array<{ path: string; contents?: string }>>(nullable(row.files_json)),
    audits: parseJson<SkillsShAudit[]>(nullable(row.audits_json)),
  };
}

function metadataChanged(previous: Record<string, unknown>, current: CatalogSnapshotRecord): boolean {
  return JSON.stringify([
    previous.source,
    previous.slug,
    previous.name,
    previous.slash_command,
    previous.source_type,
    previous.install_url,
    previous.page_url,
    Number(previous.installs),
    Boolean(previous.duplicate_flag),
    Boolean(previous.curated),
    nullableNumber(previous.rank_all_time),
    nullableNumber(previous.rank_trending),
    nullableNumber(previous.rank_hot),
    previous.upstream_status,
  ]) !== JSON.stringify([
    current.source,
    current.slug,
    current.name,
    current.slashCommand,
    current.sourceType,
    current.installUrl,
    current.url,
    current.installs,
    current.duplicate,
    current.curated,
    current.ranks["all-time"] ?? null,
    current.ranks.trending ?? null,
    current.ranks.hot ?? null,
    "available",
  ]);
}

function normalizeSyncRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    syncId: row.sync_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    provider: row.provider,
    status: row.status,
    pagesFetched: row.pages_fetched,
    recordsReceived: row.records_received,
    recordsAdded: row.records_added,
    recordsChanged: row.records_changed,
    recordsUnlisted: row.records_unlisted,
    cacheMaxAgeSeconds: row.cache_max_age_seconds,
    rateLimit: parseJson(row.rate_limit_json as string | null),
    failureReason: row.failure_reason,
  };
}

function descriptionFromSkillMarkdown(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)?.[1] ?? "";
  try {
    const parsed = loadYaml(frontmatter, { schema: JSON_SCHEMA });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const description = (parsed as Record<string, unknown>).description;
    return typeof description === "string" ? description.trim() || null : null;
  } catch {
    const lines = frontmatter.split(/\r?\n/);
    const index = lines.findIndex((line) => /^description:\s*/i.test(line));
    if (index < 0) return null;
    const initial = lines[index].replace(/^description:\s*/i, "").trim();
    if (initial === ">" || initial === "|") {
      const continuation: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (!/^\s+/.test(lines[cursor])) break;
        continuation.push(lines[cursor].trim());
      }
      return (initial === ">" ? continuation.join(" ") : continuation.join("\n")).trim() || null;
    }
    return initial.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim() || null;
  }
}

function nullable(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseJson<T = unknown>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
