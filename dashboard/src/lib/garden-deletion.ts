import type Database from "better-sqlite3";

import db from "./db.ts";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { acquireGardenMutationLease } from "./garden-mutation-lease.ts";
import {
  deleteGardenDatabaseRows,
  gardenDatabaseResidue,
  inventoryGardenOwnedData,
} from "./garden-deletion-db.ts";
import { GBrainClient } from "./gbrain/client.ts";
import { deleteConversation, getConversationById } from "./conversations/store.ts";
import { cancelRunningExternalAgentRuns } from "./conversations/external-agent-cancel.ts";
import { cancelRuntimeSessionWork } from "./hermes/session-cancel.ts";
import type { RuntimeSessionRow } from "./hermes/runtime-store.ts";
import {
  refreshOrganizationQuartzIndex,
  refreshPrivateQuartzIndex,
  refreshPublicQuartzIndex,
} from "./quartz-garden-index.ts";
import { publishQuartzAfterMutation } from "./quartz-publish.ts";
import { dashboardDataDir } from "./runtime-paths.ts";
import { exportVault, vaultRoot } from "./memory-tree/vault.ts";
import { mem0Config } from "./mem0/config.ts";
import { withSemanticMemoryClient } from "./mem0/client.ts";
import { reconcileSemanticMirrors } from "./mem0/mirror.ts";

interface OwnedGardenRow {
  id: number;
  user_id: number;
  slug: string;
  organization_id: number | null;
}

export interface GardenDeletionResult {
  clusterId: number;
  gardenSlug: string;
  userId: number;
  organizationId: number | null;
  deletedRecords: number;
  deletedArtifactDirectories: number;
  deletedCadProjects: number;
  deletedLearnWorkspaces: number;
  gbrainSourceId: string | null;
  contentPath: string | null;
  verified: true;
}

function resolveWithin(rootPath: string, ...parts: string[]): string | null {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, ...parts);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function removeExactOwnedPath(rootPath: string, ...parts: string[]): boolean {
  const target = resolveWithin(rootPath, ...parts);
  if (!target || !fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  if (fs.existsSync(target)) {
    throw new Error("A managed Garden path could not be removed.");
  }
  return true;
}

function removeEmptyParents(rootPath: string, removedPath: string): void {
  const root = path.resolve(rootPath);
  let candidate = path.dirname(path.resolve(removedPath));
  while (candidate.startsWith(`${root}${path.sep}`)) {
    try {
      if (fs.readdirSync(candidate).length > 0) return;
      fs.rmdirSync(candidate);
    } catch {
      return;
    }
    candidate = path.dirname(candidate);
  }
}

function auxiliaryGardenPaths(
  contentPath: string,
  gardenSlug: string,
  includeLeasePaths = true,
): string[] {
  if (!fs.existsSync(contentPath)) return [];
  const prefixes = [
    `.${gardenSlug}.incoming-`,
    `.${gardenSlug}.previous-`,
    `.${gardenSlug}.failed-commit-`,
  ];
  const exact = includeLeasePaths
    ? new Set([
        `.${gardenSlug}.learn-build.lock.json`,
        `.${gardenSlug}.learn-build.lock.json.guard`,
      ])
    : new Set<string>();
  return fs
    .readdirSync(contentPath, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter(
      (name) => exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix)),
    )
    .map((name) => resolveWithin(contentPath, name))
    .filter((candidate): candidate is string => candidate !== null);
}

function removeAuxiliaryGardenPaths(contentPath: string, gardenSlug: string): void {
  for (const candidate of auxiliaryGardenPaths(contentPath, gardenSlug)) {
    fs.rmSync(candidate, { recursive: true, force: true });
  }
}

function quartzPublicPath(contentPath: string): string {
  return path.join(path.dirname(path.resolve(contentPath)), "public");
}

function removePublishedGarden(contentPath: string, gardenSlug: string): void {
  const publicPath = quartzPublicPath(contentPath);
  removeExactOwnedPath(publicPath, gardenSlug);
  removeExactOwnedPath(publicPath, `${gardenSlug}.html`);
}

function filesystemResidue(input: {
  contentPath: string | null;
  gardenSlug: string;
  artifactDirectories: Array<{ userId: number; artifactId: string }>;
  cadProjectIds: string[];
  learnWorkspaceRoots: string[];
  memoryVaultRoot: string;
  memoryVaultPaths: string[];
}): string[] {
  const residue: string[] = [];
  if (input.contentPath) {
    const gardenDir = resolveWithin(input.contentPath, input.gardenSlug);
    if (gardenDir && fs.existsSync(gardenDir)) residue.push("garden content");
    if (
      auxiliaryGardenPaths(input.contentPath, input.gardenSlug, false).length > 0
    ) {
      residue.push("garden transaction files");
    }
    const publicPath = quartzPublicPath(input.contentPath);
    for (const name of [input.gardenSlug, `${input.gardenSlug}.html`]) {
      const candidate = resolveWithin(publicPath, name);
      if (candidate && fs.existsSync(candidate)) residue.push("published garden");
    }
  }
  const artifactRoot = path.join(dashboardDataDir(), "artifacts");
  for (const artifact of input.artifactDirectories) {
    const candidate = resolveWithin(
      artifactRoot,
      String(artifact.userId),
      artifact.artifactId,
    );
    if (candidate && fs.existsSync(candidate)) residue.push("artifact files");
  }
  const cadRoot = path.join(dashboardDataDir(), "cad-projects");
  for (const projectId of input.cadProjectIds) {
    const candidate = resolveWithin(cadRoot, projectId);
    if (candidate && fs.existsSync(candidate)) residue.push("CAD files");
  }
  if (input.learnWorkspaceRoots.some((candidate) => fs.existsSync(candidate))) {
    residue.push("Learn workspaces");
  }
  for (const relativePath of input.memoryVaultPaths) {
    const candidate = resolveWithin(input.memoryVaultRoot, relativePath);
    if (candidate && fs.existsSync(candidate)) residue.push("memory vault files");
  }
  return [...new Set(residue)];
}

async function cancelGardenWork(
  database: Database.Database,
  input: {
    clusterId: number;
    userId: number;
    gardenSlug: string;
    conversationIds: number[];
    runtimeSessionIds: number[];
    contentPath: string | null;
  },
): Promise<void> {
  const runtimeJobIds = new Set<string>();
  if (
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thought_topology_jobs'",
      )
      .get()
  ) {
    const rows = database
      .prepare(
        `SELECT runtime_job_id FROM thought_topology_jobs
         WHERE cluster_id = ? AND status IN ('queued','running')
           AND runtime_job_id IS NOT NULL`,
      )
      .all(input.clusterId) as Array<{ runtime_job_id: string }>;
    for (const row of rows) runtimeJobIds.add(row.runtime_job_id);
  }
  if (
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gbrain_sync_jobs'",
      )
      .get()
  ) {
    const rows = database
      .prepare(
        `SELECT claimed_by FROM gbrain_sync_jobs
         WHERE cluster_id = ? AND status = 'running' AND claimed_by IS NOT NULL`,
      )
      .all(input.clusterId) as Array<{ claimed_by: string }>;
    for (const row of rows) runtimeJobIds.add(row.claimed_by);
  }
  if (runtimeJobIds.size > 0) {
    const { cancelRuntimeJob, inspectRuntimeJob } = await import(
      "./supervisor-control.ts"
    );
    const authority = {
      userId: input.userId,
      gardenId: input.gardenSlug,
      conversationId: null,
    };
    const terminalStates = new Set([
      "cancelled",
      "succeeded",
      "failed",
      "resource_exhausted",
      "interrupted",
      "uncertain",
    ]);
    for (const runtimeJobId of runtimeJobIds) {
      let snapshot = await cancelRuntimeJob(authority, runtimeJobId);
      const deadline = Date.now() + 15_000;
      while (!terminalStates.has(snapshot.state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        snapshot = await inspectRuntimeJob(authority, runtimeJobId);
      }
      if (!terminalStates.has(snapshot.state)) {
        throw new Error("Garden background work did not stop before deletion.");
      }
    }
  }

  for (const conversationId of input.conversationIds) {
    await cancelRunningExternalAgentRuns(input.userId, conversationId, database);
  }

  if (input.runtimeSessionIds.length > 0) {
    const runtimeSessions = database
      .prepare(
        `SELECT * FROM hermes_runtime_sessions WHERE id IN (${input.runtimeSessionIds
          .map(() => "?")
          .join(",")})`,
      )
      .all(...input.runtimeSessionIds) as RuntimeSessionRow[];
    for (const runtimeSession of runtimeSessions) {
      await cancelRuntimeSessionWork(input.userId, runtimeSession);
    }
  }

  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video_transcription_jobs'").get()) {
    const jobs = database
      .prepare(
        `SELECT id FROM video_transcription_jobs
         WHERE cluster_id = ? AND status NOT IN ('completed','failed','cancelled')`,
      )
      .all(input.clusterId) as Array<{ id: string }>;
    if (jobs.length > 0) {
      const [{ getVideoTranscriptionStore }, { cancelScriberrRuntimeJob }] =
        await Promise.all([
          import("./scriberr/instance.ts"),
          import("./runtime-v2/scriberr-job.ts"),
        ]);
      const store = getVideoTranscriptionStore();
      for (const job of jobs) {
        await cancelScriberrRuntimeJob({ store, jobId: job.id });
      }
    }
  }

  if (!input.contentPath) return;
  if (
    !database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'learn_jobs'",
      )
      .get()
  ) {
    return;
  }
  const latestLearn = database.prepare(
    "SELECT status FROM learn_jobs WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1",
  ).get(input.gardenSlug) as { status: string } | undefined;
  if (!latestLearn || ["completed", "failed", "idle"].includes(latestLearn.status)) {
    return;
  }
  const { cancelRuntimeV2LearnOperation } = await import(
    "./learn-operation-runtime-v2.ts"
  );
  await cancelRuntimeV2LearnOperation({
    userId: input.userId,
    gardenId: input.gardenSlug,
    contentPath: input.contentPath,
  }).catch(() => undefined);
  const { cancelLatestLearnJob } = await import("./learn.ts");
  await cancelLatestLearnJob({
    gardenId: input.gardenSlug,
    contentPath: input.contentPath,
    userId: input.userId,
  });
}

export async function deleteOwnedGarden(input: {
  clusterId: number;
  userId: number;
  gardenSlug: string;
  database?: Database.Database;
  contentPath?: string | null;
}): Promise<GardenDeletionResult> {
  const database = input.database ?? db;
  const garden = database
    .prepare(
      `SELECT id, user_id, slug, organization_id FROM clusters
       WHERE id = ? AND user_id = ? AND slug = ?`,
    )
    .get(input.clusterId, input.userId, input.gardenSlug) as
    | OwnedGardenRow
    | undefined;
  if (!garden) throw new Error("Garden not found.");

  const contentPath =
    input.contentPath === undefined
      ? process.env.QUARTZ_CONTENT_PATH ?? null
      : input.contentPath;
  const inventory = inventoryGardenOwnedData(database, {
    clusterId: garden.id,
    userId: garden.user_id,
    gardenSlug: garden.slug,
  });
  const learnWorkspaceRoots: string[] = [];
  if (inventory.learnJobIds.length > 0) {
    const { learnWorkspaceRootCandidates } = await import(
      "./learn-build-workspace.ts"
    );
    for (const jobId of inventory.learnJobIds) {
      learnWorkspaceRoots.push(
        ...learnWorkspaceRootCandidates(garden.slug, jobId),
      );
    }
  }
  const memoryVaultRoot = vaultRoot(garden.user_id);

  let lease: ReturnType<typeof acquireGardenMutationLease> | null = null;
  if (contentPath) {
    const gardenDir = resolveWithin(contentPath, garden.slug);
    if (!gardenDir) throw new Error("Garden content path is invalid.");
    lease = acquireGardenMutationLease(gardenDir, "delete-garden");
  }

  try {
    await cancelGardenWork(database, {
      clusterId: garden.id,
      userId: garden.user_id,
      gardenSlug: garden.slug,
      conversationIds: inventory.conversationIds,
      runtimeSessionIds: inventory.runtimeSessionIds,
      contentPath,
    });

    // GBrain is derived state, but it is a separate database. Remove it before
    // deleting the mapping that proves which source belongs to this Garden.
    if (inventory.gbrainSourceId) {
      await new GBrainClient().removeSource(inventory.gbrainSourceId);
    }

    const artifactRoot = path.join(dashboardDataDir(), "artifacts");
    for (const artifact of inventory.artifactDirectories) {
      removeExactOwnedPath(
        artifactRoot,
        String(artifact.userId),
        artifact.artifactId,
      );
    }
    const cadRoot = path.join(dashboardDataDir(), "cad-projects");
    for (const projectId of inventory.cadProjectIds) {
      removeExactOwnedPath(cadRoot, projectId);
    }
    for (const workspaceRoot of learnWorkspaceRoots) {
      if (fs.existsSync(workspaceRoot)) {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    }
    for (const relativePath of inventory.memoryVaultPaths) {
      const absolutePath = resolveWithin(memoryVaultRoot, relativePath);
      if (!absolutePath) {
        throw new Error("A Garden memory-vault path is invalid.");
      }
      fs.rmSync(absolutePath, { force: true });
      removeEmptyParents(memoryVaultRoot, absolutePath);
    }
    if (contentPath) {
      removeExactOwnedPath(contentPath, garden.slug);
      removePublishedGarden(contentPath, garden.slug);
    }

    // deleteConversation knows where every message attachment blob lives; it
    // must run while its message rows still exist.
    for (const conversationId of inventory.conversationIds) {
      const conversation = getConversationById(conversationId, database);
      if (conversation) deleteConversation(conversation, database);
    }

    const deletedRecords = deleteGardenDatabaseRows(database, {
      clusterId: garden.id,
      userId: garden.user_id,
      gardenSlug: garden.slug,
      inventory,
    });

    const databaseLeftovers = gardenDatabaseResidue(database, {
      clusterId: garden.id,
      userId: garden.user_id,
      gardenSlug: garden.slug,
    });
    const fileLeftovers = filesystemResidue({
      contentPath,
      gardenSlug: garden.slug,
      artifactDirectories: inventory.artifactDirectories,
      cadProjectIds: inventory.cadProjectIds,
      learnWorkspaceRoots,
      memoryVaultRoot,
      memoryVaultPaths: inventory.memoryVaultPaths,
    });
    const leftovers = [...databaseLeftovers, ...fileLeftovers];
    if (leftovers.length > 0) {
      throw new Error(`Garden deletion left residual data: ${leftovers.join(", ")}.`);
    }

    return {
      clusterId: garden.id,
      gardenSlug: garden.slug,
      userId: garden.user_id,
      organizationId: garden.organization_id,
      deletedRecords,
      deletedArtifactDirectories: inventory.artifactDirectories.length,
      deletedCadProjects: inventory.cadProjectIds.length,
      deletedLearnWorkspaces: learnWorkspaceRoots.length,
      gbrainSourceId: inventory.gbrainSourceId,
      contentPath,
      verified: true,
    };
  } finally {
    lease?.release();
    if (contentPath) removeAuxiliaryGardenPaths(contentPath, garden.slug);
  }
}

async function finishSemanticMemoryDeletion(userId: number): Promise<void> {
  const config = mem0Config();
  if (!config.enabled) return;
  await withSemanticMemoryClient("deletion", async (client) => {
    // The permanent-delete trigger records vector tombstones in the same
    // transaction as the canonical memory removal. Drain the current vector
    // space in bounded batches; a crash leaves the tombstones for the next
    // reconciliation instead of losing the cleanup request.
    for (let pass = 0; pass < 100; pass += 1) {
      const before = databaseCount(
        `SELECT count(*) AS count FROM mem0_tombstones
         WHERE user_id = ? AND fingerprint = ?`,
        userId,
        config.fingerprint,
      );
      if (before === 0) return;
      await reconcileSemanticMirrors({
        userId,
        client,
        fingerprint: config.fingerprint,
        database: db,
        itemBudget: 100,
        timeBudgetMs: 30_000,
      });
      const after = databaseCount(
        `SELECT count(*) AS count FROM mem0_tombstones
         WHERE user_id = ? AND fingerprint = ?`,
        userId,
        config.fingerprint,
      );
      if (after >= before) return;
    }
  });
}

function databaseCount(sql: string, ...bindings: unknown[]): number {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mem0_tombstones'",
      )
      .get()
  ) {
    return 0;
  }
  return Number((db.prepare(sql).get(...bindings) as { count: number }).count);
}

/** Expensive derived-state cleanup and cross-Garden publication. Route
 * handlers schedule this with Next `after()`, so navigation cannot abort it
 * and deletion responses stay fast. */
export async function finalizeGardenDeletion(
  result: GardenDeletionResult,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    exportVault(result.userId, db);
  } catch (error) {
    failures.push(error);
  }
  try {
    await finishSemanticMemoryDeletion(result.userId);
  } catch (error) {
    failures.push(error);
  }
  try {
    // Close the narrow race with a GBrain sync worker that was already past
    // its database authority check when deletion began.
    if (result.gbrainSourceId) {
      await new GBrainClient().removeSource(result.gbrainSourceId);
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    refreshPrivateQuartzIndex(result.userId);
    refreshPublicQuartzIndex();
    if (result.organizationId !== null) {
      refreshOrganizationQuartzIndex(result.userId);
    }
    await publishQuartzAfterMutation(
      `delete cluster ${result.gardenSlug}`,
      {
        userId: result.userId,
        topologyImpact: "none",
      },
    );
  } catch (error) {
    failures.push(error);
  } finally {
    // A Quartz build already in flight when deletion began may have copied the
    // old page. The final sweep makes the published tree match the verified DB.
    if (result.contentPath) {
      removePublishedGarden(result.contentPath, result.gardenSlug);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Garden background cleanup was incomplete.");
  }
}
