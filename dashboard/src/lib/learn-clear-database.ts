import type Database from "better-sqlite3";

export interface LearnDatabaseClearResult {
  deletedJobs: number;
  deletedTokenUsageRows: number;
  deletedMaps: number;
  deletedVersions: number;
}

/** Delete persisted Learn workflow state for exactly one garden.
 *
 * The caller owns the surrounding transaction and must create/migrate the
 * Learn tables first. Keeping this operation database-parameterized makes the
 * garden boundary directly testable without touching the live dashboard DB.
 */
export function clearLearnDatabaseRecords(
  database: Database.Database,
  gardenId: string,
): LearnDatabaseClearResult {
  const deletedTokenUsageRows = database
    .prepare(
      "DELETE FROM learn_job_token_usage WHERE job_id IN (SELECT id FROM learn_jobs WHERE garden_id = ?)",
    )
    .run(gardenId).changes;
  const deletedVersions = database
    .prepare("DELETE FROM learn_versions WHERE garden_id = ?")
    .run(gardenId).changes;
  const deletedMaps = database
    .prepare("DELETE FROM learn_maps WHERE garden_id = ?")
    .run(gardenId).changes;
  const deletedJobs = database
    .prepare("DELETE FROM learn_jobs WHERE garden_id = ?")
    .run(gardenId).changes;
  return {
    deletedJobs,
    deletedTokenUsageRows,
    deletedMaps,
    deletedVersions,
  };
}
