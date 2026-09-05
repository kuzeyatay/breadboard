import type Database from "better-sqlite3";

export interface GardenDeletionInventory {
  conversationIds: number[];
  runtimeSessionIds: number[];
  openharnessRuntimeSessionIds: number[];
  artifactDirectories: Array<{ userId: number; artifactId: string }>;
  cadProjectIds: string[];
  learnJobIds: string[];
  durableMemoryIds: number[];
  memoryTreeNodeIds: number[];
  memoryVaultPaths: string[];
  gbrainSourceId: string | null;
}

const SLUG_TABLES = [
  ["hermes_audit_events", "garden_id"],
  ["hermes_proposals", "garden_id"],
  ["openharness_audit_events", "garden_id"],
  ["openharness_proposals", "garden_id"],
  ["runtime_v2_outer_agent_runs", "garden_id"],
  ["learn_clear_operations", "garden_id"],
  ["learn_council_legacy_boundary_adoptions", "garden_id"],
  ["learn_council_legacy_failure_proofs", "garden_id"],
  ["learn_council_missing_receipt_recoveries", "garden_id"],
  ["learn_council_native_lineage_boundaries", "garden_id"],
  ["learn_council_request_checkpoints", "garden_id"],
  ["learn_planning_request_checkpoints", "garden_id"],
  ["learn_maps", "garden_id"],
  ["learn_versions", "garden_id"],
  ["learn_publication_retries", "garden_id"],
  ["learn_jobs", "garden_id"],
  ["review_cards", "garden_slug"],
  ["review_gardens", "garden_slug"],
  ["scheduled_chat_jobs", "garden_slug"],
  ["hooks", "garden_slug"],
] as const;

const CLUSTER_TABLES = [
  "cad_projects",
  "chat_sessions",
  "gbrain_sync_jobs",
  "hermes_artifact_events",
  "hermes_artifacts",
  "hermes_proposals",
  "hermes_runtime_sessions",
  "openharness_artifact_events",
  "openharness_artifacts",
  "openharness_proposals",
  "openharness_runtime_sessions",
  "pdf_document_edit_history",
  "pdf_document_edits",
  "thought_topology_jobs",
  "video_transcription_jobs",
] as const;

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
      .get(table),
  );
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(",");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function artifactInventory(
  database: Database.Database,
  table: "hermes_artifacts" | "openharness_artifacts",
  clusterId: number,
  conversationIds: readonly number[],
  runtimeSessionIds: readonly number[],
): Array<{ userId: number; artifactId: string }> {
  if (!tableExists(database, table)) return [];
  const clauses = ["cluster_id = ?"];
  const bindings: unknown[] = [clusterId];
  if (conversationIds.length > 0) {
    clauses.push(`conversation_id IN (${placeholders(conversationIds)})`);
    bindings.push(...conversationIds);
  }
  if (runtimeSessionIds.length > 0) {
    clauses.push(`runtime_session_id IN (${placeholders(runtimeSessionIds)})`);
    bindings.push(...runtimeSessionIds);
  }
  const rows = database
    .prepare(`SELECT id, user_id FROM ${table} WHERE ${clauses.join(" OR ")}`)
    .all(...bindings) as Array<{ id: string; user_id: number }>;
  return rows.map((row) => ({ userId: row.user_id, artifactId: row.id }));
}

export function inventoryGardenOwnedData(
  database: Database.Database,
  input: { clusterId: number; userId: number; gardenSlug: string },
): GardenDeletionInventory {
  const conversationIds = tableExists(database, "conversations")
    ? (
        database
          .prepare(
            "SELECT id FROM conversations WHERE user_id = ? AND default_garden_id = ?",
          )
          .all(input.userId, input.clusterId) as Array<{ id: number }>
      ).map((row) => row.id)
    : [];

  const runtimeSessionIds = tableExists(database, "hermes_runtime_sessions")
    ? (
        database
          .prepare(
            `SELECT id FROM hermes_runtime_sessions
             WHERE cluster_id = ? OR garden_id = ?${
               conversationIds.length > 0
                 ? ` OR conversation_id IN (${placeholders(conversationIds)})`
                 : ""
             }`,
          )
          .all(input.clusterId, input.gardenSlug, ...conversationIds) as Array<{
          id: number;
        }>
      ).map((row) => row.id)
    : [];

  const openharnessRuntimeSessionIds = tableExists(
    database,
    "openharness_runtime_sessions",
  )
    ? (
        database
          .prepare(
            `SELECT id FROM openharness_runtime_sessions
             WHERE cluster_id = ? OR garden_id = ?${
               conversationIds.length > 0
                 ? ` OR conversation_id IN (${placeholders(conversationIds)})`
                 : ""
             }`,
          )
          .all(input.clusterId, input.gardenSlug, ...conversationIds) as Array<{
          id: number;
        }>
      ).map((row) => row.id)
    : [];

  const artifactDirectories = unique(
    [
      ...artifactInventory(
        database,
        "hermes_artifacts",
        input.clusterId,
        conversationIds,
        runtimeSessionIds,
      ),
      ...artifactInventory(
        database,
        "openharness_artifacts",
        input.clusterId,
        conversationIds,
        openharnessRuntimeSessionIds,
      ),
    ].map((entry) => `${entry.userId}\0${entry.artifactId}`),
  ).map((entry) => {
    const [userId, artifactId] = entry.split("\0");
    return { userId: Number(userId), artifactId };
  });

  const cadProjectIds = tableExists(database, "cad_projects")
    ? (
        database
          .prepare(
            `SELECT id FROM cad_projects WHERE cluster_id = ?${
              conversationIds.length > 0
                ? ` OR conversation_id IN (${placeholders(conversationIds)})`
                : ""
            }`,
          )
          .all(input.clusterId, ...conversationIds) as Array<{ id: string }>
      ).map((row) => row.id)
    : [];

  const learnJobIds = tableExists(database, "learn_jobs")
    ? (
        database
          .prepare("SELECT id FROM learn_jobs WHERE garden_id = ?")
          .all(input.gardenSlug) as Array<{ id: string }>
      ).map((row) => row.id)
    : [];

  const gardenScopeId = String(input.clusterId);
  const durableMemoryIds = tableExists(database, "durable_memories")
    ? (
        database
          .prepare(
            `SELECT id FROM durable_memories
             WHERE user_id = ? AND scope = 'garden' AND scope_id = ?`,
          )
          .all(input.userId, gardenScopeId) as Array<{ id: number }>
      ).map((row) => row.id)
    : [];

  const memoryTreeNodeIds = tableExists(database, "memory_tree_nodes")
    ? (
        database
          .prepare(
            `WITH RECURSIVE garden_nodes(id) AS (
               SELECT id FROM memory_tree_nodes
               WHERE user_id = ? AND scope = 'garden' AND scope_id = ?
               UNION
               SELECT child.id
               FROM memory_tree_nodes child
               JOIN garden_nodes parent ON child.parent_id = parent.id
               WHERE child.user_id = ?
             )
             SELECT id FROM garden_nodes`,
          )
          .all(input.userId, gardenScopeId, input.userId) as Array<{ id: number }>
      ).map((row) => row.id)
    : [];

  const vaultClauses: string[] = [];
  const vaultBindings: unknown[] = [input.userId];
  if (durableMemoryIds.length > 0) {
    vaultClauses.push(`memory_id IN (${placeholders(durableMemoryIds)})`);
    vaultBindings.push(...durableMemoryIds);
  }
  if (memoryTreeNodeIds.length > 0) {
    vaultClauses.push(`node_id IN (${placeholders(memoryTreeNodeIds)})`);
    vaultBindings.push(...memoryTreeNodeIds);
  }
  const memoryVaultPaths =
    tableExists(database, "memory_vault_files") && vaultClauses.length > 0
      ? (
          database
            .prepare(
              `SELECT path FROM memory_vault_files
               WHERE user_id = ? AND (${vaultClauses.join(" OR ")})`,
            )
            .all(...vaultBindings) as Array<{ path: string }>
        ).map((row) => row.path)
      : [];

  const mapping = tableExists(database, "gbrain_garden_sources")
    ? (database
        .prepare(
          "SELECT source_id FROM gbrain_garden_sources WHERE cluster_id = ? OR garden_slug = ? LIMIT 1",
        )
        .get(input.clusterId, input.gardenSlug) as { source_id: string } | undefined)
    : undefined;

  return {
    conversationIds,
    runtimeSessionIds,
    openharnessRuntimeSessionIds,
    artifactDirectories,
    cadProjectIds,
    learnJobIds,
    durableMemoryIds,
    memoryTreeNodeIds,
    memoryVaultPaths,
    gbrainSourceId: mapping?.source_id ?? null,
  };
}

function deleteArtifacts(
  database: Database.Database,
  table: "hermes_artifacts" | "openharness_artifacts",
  clusterId: number,
  conversationIds: readonly number[],
  runtimeSessionIds: readonly number[],
): number {
  if (!tableExists(database, table)) return 0;
  const clauses = ["cluster_id = ?"];
  const bindings: unknown[] = [clusterId];
  if (conversationIds.length > 0) {
    clauses.push(`conversation_id IN (${placeholders(conversationIds)})`);
    bindings.push(...conversationIds);
  }
  if (runtimeSessionIds.length > 0) {
    clauses.push(`runtime_session_id IN (${placeholders(runtimeSessionIds)})`);
    bindings.push(...runtimeSessionIds);
  }
  return database
    .prepare(`DELETE FROM ${table} WHERE ${clauses.join(" OR ")}`)
    .run(...bindings).changes;
}

function removeAllowedGardenId(
  database: Database.Database,
  table: "hermes_runtime_sessions" | "openharness_runtime_sessions",
  clusterId: number,
): number {
  if (!tableExists(database, table)) return 0;
  const rows = database
    .prepare(`SELECT id, allowed_garden_ids FROM ${table} WHERE allowed_garden_ids LIKE ?`)
    .all(`%${clusterId}%`) as Array<{ id: number; allowed_garden_ids: string }>;
  let changes = 0;
  const update = database.prepare(
    `UPDATE ${table} SET allowed_garden_ids = ? WHERE id = ?`,
  );
  for (const row of rows) {
    let ids: unknown;
    try {
      ids = JSON.parse(row.allowed_garden_ids);
    } catch {
      continue;
    }
    if (!Array.isArray(ids) || !ids.includes(clusterId)) continue;
    update.run(
      JSON.stringify(ids.filter((candidate) => candidate !== clusterId)),
      row.id,
    );
    changes += 1;
  }
  return changes;
}

export function deleteGardenDatabaseRows(
  database: Database.Database,
  input: {
    clusterId: number;
    userId: number;
    gardenSlug: string;
    inventory: GardenDeletionInventory;
  },
): number {
  return database.transaction(() => {
    let changes = 0;
    changes += deleteArtifacts(
      database,
      "hermes_artifacts",
      input.clusterId,
      input.inventory.conversationIds,
      input.inventory.runtimeSessionIds,
    );
    changes += deleteArtifacts(
      database,
      "openharness_artifacts",
      input.clusterId,
      input.inventory.conversationIds,
      input.inventory.openharnessRuntimeSessionIds,
    );

    if (tableExists(database, "cad_projects")) {
      const clauses = ["cluster_id = ?"];
      const bindings: unknown[] = [input.clusterId];
      if (input.inventory.conversationIds.length > 0) {
        clauses.push(
          `conversation_id IN (${placeholders(input.inventory.conversationIds)})`,
        );
        bindings.push(...input.inventory.conversationIds);
      }
      changes += database
        .prepare(`DELETE FROM cad_projects WHERE ${clauses.join(" OR ")}`)
        .run(...bindings).changes;
    }

    if (
      tableExists(database, "conversations") &&
      input.inventory.conversationIds.length > 0
    ) {
      changes += database
        .prepare(
          `DELETE FROM conversations WHERE id IN (${placeholders(
            input.inventory.conversationIds,
          )})`,
        )
        .run(...input.inventory.conversationIds).changes;
    }

    for (const table of [
      "hermes_runtime_sessions",
      "openharness_runtime_sessions",
    ] as const) {
      if (!tableExists(database, table)) continue;
      const clauses = ["cluster_id = ?", "garden_id = ?"];
      const bindings: unknown[] = [input.clusterId, input.gardenSlug];
      if (input.inventory.conversationIds.length > 0) {
        clauses.push(
          `conversation_id IN (${placeholders(input.inventory.conversationIds)})`,
        );
        bindings.push(...input.inventory.conversationIds);
      }
      changes += database
        .prepare(`DELETE FROM ${table} WHERE ${clauses.join(" OR ")}`)
        .run(...bindings).changes;
      changes += removeAllowedGardenId(database, table, input.clusterId);
    }

    if (tableExists(database, "semantic_chunks_fts")) {
      changes += database
        .prepare("DELETE FROM semantic_chunks_fts WHERE garden_slug = ?")
        .run(input.gardenSlug).changes;
    }
    if (tableExists(database, "semantic_chunks")) {
      changes += database
        .prepare("DELETE FROM semantic_chunks WHERE garden_slug = ?")
        .run(input.gardenSlug).changes;
    }

    if (
      tableExists(database, "memory_tree_nodes") &&
      input.inventory.memoryTreeNodeIds.length > 0
    ) {
      changes += database
        .prepare(
          `DELETE FROM memory_tree_nodes WHERE user_id = ? AND id IN (${placeholders(
            input.inventory.memoryTreeNodeIds,
          )})`,
        )
        .run(input.userId, ...input.inventory.memoryTreeNodeIds).changes;
    }
    if (
      tableExists(database, "durable_memories") &&
      input.inventory.durableMemoryIds.length > 0
    ) {
      changes += database
        .prepare(
          `DELETE FROM durable_memories WHERE user_id = ? AND id IN (${placeholders(
            input.inventory.durableMemoryIds,
          )})`,
        )
        .run(input.userId, ...input.inventory.durableMemoryIds).changes;
    }

    for (const [table, column] of SLUG_TABLES) {
      if (!tableExists(database, table)) continue;
      changes += database
        .prepare(`DELETE FROM ${table} WHERE ${column} = ?`)
        .run(input.gardenSlug).changes;
    }

    if (tableExists(database, "gbrain_sync_jobs")) {
      const sourceClause = input.inventory.gbrainSourceId
        ? " OR source_id = ?"
        : "";
      changes += database
        .prepare(`DELETE FROM gbrain_sync_jobs WHERE cluster_id = ?${sourceClause}`)
        .run(
          input.clusterId,
          ...(input.inventory.gbrainSourceId
            ? [input.inventory.gbrainSourceId]
            : []),
        ).changes;
    }
    if (tableExists(database, "gbrain_garden_sources")) {
      changes += database
        .prepare(
          "DELETE FROM gbrain_garden_sources WHERE cluster_id = ? OR garden_slug = ?",
        )
        .run(input.clusterId, input.gardenSlug).changes;
    }

    for (const table of CLUSTER_TABLES) {
      if (
        table === "cad_projects" ||
        table === "gbrain_sync_jobs" ||
        table === "hermes_artifacts" ||
        table === "openharness_artifacts" ||
        table === "hermes_runtime_sessions" ||
        table === "openharness_runtime_sessions" ||
        !tableExists(database, table)
      ) {
        continue;
      }
      changes += database
        .prepare(`DELETE FROM ${table} WHERE cluster_id = ?`)
        .run(input.clusterId).changes;
    }

    changes += database
      .prepare("DELETE FROM clusters WHERE id = ? AND user_id = ?")
      .run(input.clusterId, input.userId).changes;
    return changes;
  }).immediate();
}

export function gardenDatabaseResidue(
  database: Database.Database,
  input: { clusterId: number; userId: number; gardenSlug: string },
): string[] {
  const residue: string[] = [];
  const hasRows = (table: string, clause: string, ...bindings: unknown[]) =>
    tableExists(database, table) &&
    Boolean(database.prepare(`SELECT 1 FROM ${table} WHERE ${clause} LIMIT 1`).get(...bindings));

  if (hasRows("clusters", "id = ?", input.clusterId)) residue.push("clusters");
  if (hasRows("conversations", "default_garden_id = ?", input.clusterId)) {
    residue.push("conversations");
  }
  if (
    hasRows(
      "durable_memories",
      "user_id = ? AND scope = 'garden' AND scope_id = ?",
      input.userId,
      String(input.clusterId),
    )
  ) {
    residue.push("durable_memories");
  }
  if (
    hasRows(
      "memory_tree_nodes",
      "user_id = ? AND scope = 'garden' AND scope_id = ?",
      input.userId,
      String(input.clusterId),
    )
  ) {
    residue.push("memory_tree_nodes");
  }
  if (
    hasRows(
      "gbrain_garden_sources",
      "cluster_id = ? OR garden_slug = ?",
      input.clusterId,
      input.gardenSlug,
    )
  ) {
    residue.push("gbrain_garden_sources");
  }
  for (const table of CLUSTER_TABLES) {
    if (hasRows(table, "cluster_id = ?", input.clusterId)) residue.push(table);
  }
  for (const [table, column] of SLUG_TABLES) {
    if (hasRows(table, `${column} = ?`, input.gardenSlug)) residue.push(table);
  }
  for (const table of [
    "hermes_runtime_sessions",
    "openharness_runtime_sessions",
  ] as const) {
    if (!tableExists(database, table)) continue;
    const rows = database
      .prepare(`SELECT allowed_garden_ids FROM ${table} WHERE allowed_garden_ids LIKE ?`)
      .all(`%${input.clusterId}%`) as Array<{ allowed_garden_ids: string }>;
    if (
      rows.some((row) => {
        try {
          const parsed = JSON.parse(row.allowed_garden_ids) as unknown;
          return Array.isArray(parsed) && parsed.includes(input.clusterId);
        } catch {
          return false;
        }
      })
    ) {
      residue.push(`${table}.allowed_garden_ids`);
    }
  }
  return unique(residue);
}
