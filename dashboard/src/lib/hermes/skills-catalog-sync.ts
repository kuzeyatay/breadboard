import crypto from "node:crypto";
import {
  SkillsCatalogProxyError,
  SkillsShClient,
  type SkillsShRateLimit,
  type SkillsShSkill,
  type SkillsShView,
} from "./skills-sh-client.ts";
import {
  collisionCommands,
  configuredStaleMs,
  getSkillsCatalogStore,
  type CatalogSnapshotRecord,
  type CatalogSyncStats,
  type SkillsCatalogStore,
} from "./skills-catalog-store.ts";
import {
  getLocalReviewedSkill,
  synchronizeLocalSkillsCatalogs,
} from "./local-skills-sources.ts";
import { hashSkillDirectory } from "./skills.ts";

const VIEWS: SkillsShView[] = ["all-time", "trending", "hot"];
const MAX_PAGES_PER_VIEW = 10_000;
let inFlightSync: Promise<CatalogSyncStats> | null = null;

export interface CatalogSynchronizerOptions {
  client?: SkillsShClient;
  store?: SkillsCatalogStore;
  signal?: AbortSignal;
  force?: boolean;
  includeLocalSources?: boolean;
}

export async function synchronizeSkillsCatalog(
  options: CatalogSynchronizerOptions = {},
): Promise<CatalogSyncStats> {
  if (inFlightSync) return inFlightSync;
  const store = options.store ?? getSkillsCatalogStore();
  if (!options.force) {
    const status = store.status(configuredStaleMs());
    if (status.hasSnapshot && !status.stale && status.latestRun?.status === "succeeded") {
      return latestStats(status.latestRun);
    }
  }
  const client = options.client ?? new SkillsShClient();
  inFlightSync = performSynchronization(
    client,
    store,
    options.signal,
    options.includeLocalSources === true,
  ).finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

export function revalidateSkillsCatalogInBackground(): void {
  const store = getSkillsCatalogStore();
  const status = store.status();
  if (!status.stale || inFlightSync) return;
  void synchronizeSkillsCatalog({ store, includeLocalSources: true }).catch(() => {
    // Failure is durably recorded; reads continue from the last-known-good snapshot.
  });
}

export function catalogSyncInProgress(): boolean {
  return Boolean(inFlightSync);
}

async function performSynchronization(
  client: SkillsShClient,
  store: SkillsCatalogStore,
  signal?: AbortSignal,
  includeLocalSources = false,
): Promise<CatalogSyncStats> {
  const syncId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  store.beginSync({ syncId, startedAt, provider: "skills.sh/api/v1" });
  let rateLimit: SkillsShRateLimit = {
    limit: null,
    remaining: null,
    resetAt: null,
    retryAfterSeconds: null,
  };
  try {
    const byId = new Map<string, CatalogSnapshotRecord>();
    let pagesFetched = 0;
    let recordsReceived = 0;
    let cacheMaxAgeSeconds: number | null = null;
    for (const view of VIEWS) {
      let page = 0;
      while (true) {
        signal?.throwIfAborted();
        if (page >= MAX_PAGES_PER_VIEW) throw new Error(`skills.sh ${view} pagination exceeded its safety limit`);
        const result = await client.listSkills({ page, perPage: 500, view, signal });
        if (result.pagination.page !== page) {
          throw new Error(`skills.sh ${view} pagination returned page ${result.pagination.page} while page ${page} was requested`);
        }
        pagesFetched += 1;
        recordsReceived += result.data.length;
        rateLimit = result.rateLimit;
        cacheMaxAgeSeconds = maximumNullable(cacheMaxAgeSeconds, result.cacheMaxAgeSeconds);
        result.data.forEach((skill, index) => mergeRecord(byId, skill, view, page * result.pagination.perPage + index + 1));
        if (!result.pagination.hasMore) break;
        if (result.data.length === 0) {
          throw new Error(`skills.sh ${view} pagination claimed more pages after an empty page`);
        }
        page += 1;
      }
    }
    const curated = await client.curated(signal);
    const records = [...byId.values()];
    const commands = collisionCommands(records);
    for (const record of records) {
      record.curated = curated.has(record.id);
      record.slashCommand = commands.get(record.id) ?? record.slug;
    }
    const stats = store.replaceSnapshot({
      syncId,
      startedAt,
      records,
      pagesFetched,
      recordsReceived,
      cacheMaxAgeSeconds,
      rateLimit,
    });
    if (includeLocalSources) synchronizeLocalSkillsCatalogs({ store, force: true });
    await refreshInstalledRevisions(client, store, signal);
    return stats;
  } catch (error) {
    if (error instanceof SkillsCatalogProxyError) rateLimit = error.rateLimit;
    const message = error instanceof Error ? error.message : "Catalog proxy synchronization failed";
    store.failSync(syncId, message, rateLimit);
    throw error;
  }
}

async function refreshInstalledRevisions(
  client: SkillsShClient,
  store: SkillsCatalogStore,
  signal?: AbortSignal,
): Promise<void> {
  const installed = [] as ReturnType<SkillsCatalogStore["list"]>["skills"];
  for (let page = 0; ; page += 1) {
    const result = store.list({ filter: "installed", page, perPage: 100 });
    installed.push(...result.skills);
    if (!result.hasMore) break;
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < installed.length) {
      const skill = installed[cursor++];
      signal?.throwIfAborted();
      if (skill.installedPath && skill.localHash) {
        try {
          if (hashSkillDirectory(skill.installedPath) !== skill.localHash) {
            store.markLocalModification(skill.upstreamId);
          }
        } catch {
          store.markLocalModification(skill.upstreamId);
        }
      }
      if (skill.upstreamStatus !== "available") continue;
      const local = getLocalReviewedSkill(skill.upstreamId);
      if (local) {
        store.saveDetail(skill.upstreamId, local.detail, skill.audits ?? []);
        continue;
      }
      try {
        const detail = await client.detail(skill.source, skill.slug, signal);
        let audits = skill.audits ?? [];
        try {
          audits = await client.audits(skill.source, skill.slug, signal);
        } catch {
          // A 404 is normal when no partner has audited this skill yet.
        }
        store.saveDetail(skill.upstreamId, detail, audits);
      } catch {
        store.markUpstreamUnavailable(skill.upstreamId);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, installed.length) }, () => worker()));
}

function mergeRecord(
  records: Map<string, CatalogSnapshotRecord>,
  skill: SkillsShSkill,
  view: SkillsShView,
  rank: number,
): void {
  const existing = records.get(skill.id);
  if (!existing) {
    records.set(skill.id, {
      ...skill,
      ranks: { [view]: rank },
      curated: false,
      slashCommand: skill.slug,
    });
    return;
  }
  if (existing.source !== skill.source || existing.slug !== skill.slug) {
    throw new Error(`skills.sh returned conflicting records for stable id ${skill.id}`);
  }
  existing.ranks[view] = Math.min(existing.ranks[view] ?? rank, rank);
  if (view === "all-time") {
    existing.name = skill.name;
    existing.installs = skill.installs;
    existing.sourceType = skill.sourceType;
    existing.installUrl = skill.installUrl;
    existing.url = skill.url;
    existing.duplicate = skill.duplicate;
  }
}

function maximumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function latestStats(run: Record<string, unknown>): CatalogSyncStats {
  return {
    syncId: String(run.syncId),
    startedAt: String(run.startedAt),
    completedAt: String(run.completedAt),
    pagesFetched: Number(run.pagesFetched),
    recordsReceived: Number(run.recordsReceived),
    recordsAdded: Number(run.recordsAdded),
    recordsChanged: Number(run.recordsChanged),
    recordsUnlisted: Number(run.recordsUnlisted),
    cacheMaxAgeSeconds: run.cacheMaxAgeSeconds === null ? null : Number(run.cacheMaxAgeSeconds),
    rateLimit: (run.rateLimit as SkillsShRateLimit | null) ?? {
      limit: null,
      remaining: null,
      resetAt: null,
      retryAfterSeconds: null,
    },
  };
}
