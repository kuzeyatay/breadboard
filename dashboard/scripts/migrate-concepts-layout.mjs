import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(dashboardRoot, "src");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
await import("./learn-worker-import-hook.mjs");

const {
  createKnowledgeWriteTransaction,
  migrateLegacyIngestSectionsToConcepts,
  refreshClusterIndex,
} = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "knowledge.ts")).href
);

const apply = process.argv.includes("--apply");
const contentPath = path.resolve(
  process.env.QUARTZ_CONTENT_PATH?.trim() ||
    path.join(dashboardRoot, "..", "quartz", "content"),
);
const gardenFilter = process.argv
  .filter((argument) => argument.startsWith("--garden="))
  .map((argument) => argument.slice("--garden=".length).trim())
  .filter(Boolean);
const gardens = fs
  .readdirSync(contentPath, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      (gardenFilter.length === 0 || gardenFilter.includes(entry.name)),
  )
  .map((entry) => entry.name)
  .sort();

const results = [];
for (const garden of gardens) {
  const inspection = migrateLegacyIngestSectionsToConcepts(
    contentPath,
    garden,
    {
      apply: false,
    },
  );
  if (inspection.detectedSections === 0) continue;
  if (!apply) {
    results.push({ garden, ...inspection });
    continue;
  }

  const transaction = createKnowledgeWriteTransaction(contentPath, garden);
  try {
    const migration = migrateLegacyIngestSectionsToConcepts(
      contentPath,
      garden,
      {
        transaction,
      },
    );
    refreshClusterIndex(contentPath, garden, { transaction });
    transaction.commit();
    results.push({ garden, ...migration });
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

console.log(
  JSON.stringify(
    {
      applied: apply,
      contentPath,
      affectedGardens: results.length,
      results,
    },
    null,
    2,
  ),
);
