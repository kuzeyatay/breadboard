import type Database from "better-sqlite3";
import {
  generativeUiResourcesFromVerification,
  normalizeGenerativeUiResources,
} from "./contracts.ts";

interface MessageMetadataRow {
  id: number;
  metadata: string | null;
}

function metadataRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Promote native UI resources that an older live-event adapter left nested in
 * verification evidence. The query is deliberately narrow, and every result
 * is revalidated before it is promoted to transcript metadata.
 */
export function backfillGenerativeUiResources(database: Database.Database): number {
  const rows = database.prepare(`
    SELECT id, metadata
    FROM conversation_messages
    WHERE role = 'assistant'
      AND metadata LIKE '%"product_search"%'
      AND metadata LIKE '%"uiResources"%'
  `).all() as MessageMetadataRow[];
  const update = database.prepare(
    "UPDATE conversation_messages SET metadata = ? WHERE id = ?",
  );
  let changed = 0;

  for (const row of rows) {
    const metadata = metadataRecord(row.metadata);
    if (!metadata || normalizeGenerativeUiResources(metadata.uiResources).length > 0) {
      continue;
    }
    const uiResources = generativeUiResourcesFromVerification(metadata.verification);
    if (uiResources.length === 0) continue;
    changed += update.run(JSON.stringify({ ...metadata, uiResources }), row.id).changes;
  }

  return changed;
}
