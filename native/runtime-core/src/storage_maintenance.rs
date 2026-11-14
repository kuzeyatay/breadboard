//! Retention belongs to the runtime owner, never to a dashboard SQL connection.
use crate::{JobStore, RuntimePaths, StoreError};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DAY: i64 = 86_400_000;
pub(crate) const SCHEMA: &str = r#"
CREATE TABLE runtime_storage_watermarks (
  owner_principal TEXT NOT NULL, schedule_id TEXT NOT NULL, through_due_at INTEGER NOT NULL,
  PRIMARY KEY(owner_principal,schedule_id)
);
CREATE TABLE runtime_storage_proofs (
  job_id TEXT PRIMARY KEY REFERENCES runtime_jobs(job_id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL, due_at INTEGER NOT NULL, result_sha256 TEXT NOT NULL,
  directory_cleaned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE runtime_storage_daily (
  day INTEGER NOT NULL, schedule_id TEXT NOT NULL, noop_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,schedule_id)
);
CREATE TABLE runtime_storage_cursor (id INTEGER PRIMARY KEY CHECK(id IN (1,2)), finished_at INTEGER NOT NULL, job_id TEXT NOT NULL);
INSERT INTO runtime_storage_cursor VALUES(1,0,''),(2,0,'');
PRAGMA user_version=14;
"#;

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMaintenanceReport {
    pub busy: bool,
    pub inspected: usize,
    pub jobs_pruned: usize,
    pub directories_removed: usize,
    pub protected: usize,
    pub diagnostic_events_pruned: usize,
}

fn occurrence(key: &str) -> Option<(&str, i64)> {
    let value = key.strip_prefix("runtime-schedule-")?;
    let (schedule, due) = value.rsplit_once('-')?;
    if !matches!(
        schedule,
        "review-scheduler"
            | "scheduled-chats"
            | "caldav-sync"
            | "calendar-reminders"
            | "hermes-abandoned-run-recovery"
            | "learn-recovery"
            | "skills-catalog-refresh"
            | "memory-autofetch"
            | "email-poll"
    ) {
        return None;
    }
    let due = due.parse::<i64>().ok()?;
    (due > 0).then_some((schedule, due))
}

/// Closed result shapes: new output fields require an explicit policy review.
fn verified_noop(schedule: &str, result: &Value) -> bool {
    let Some(object) = result.as_object() else {
        return false;
    };
    let zero_fields: &[&str] = match schedule {
        "review-scheduler" => &["considered", "sent"],
        "scheduled-chats" => &["dispatched"],
        "caldav-sync" => &["considered", "synced", "failed", "leased"],
        "calendar-reminders" => {
            return object.len() == 5
                && object.get("operation").and_then(Value::as_str) == Some(schedule)
                && ["recipients", "delivered", "failed"]
                    .iter()
                    .all(|key| object.get(*key).and_then(Value::as_u64) == Some(0))
                && object
                    .get("errors")
                    .and_then(Value::as_array)
                    .is_some_and(|errors| errors.is_empty())
        }
        "hermes-abandoned-run-recovery" => &["resumed", "reconciled"],
        "memory-autofetch" => &["users", "written"],
        "email-poll" => &["fetched", "answered", "ignored", "errors"],
        "skills-catalog-refresh" => {
            return object.len() == 2
                && object.get("operation").and_then(Value::as_str) == Some(schedule)
                && object.get("changed") == Some(&Value::Bool(false))
        }
        "learn-recovery" => {
            return object.len() == 3
                && object.get("operation").and_then(Value::as_str) == Some("recovery")
                && object.get("learnJobId") == Some(&Value::Null)
                && object
                    .get("value")
                    .and_then(Value::as_object)
                    .is_some_and(|value| {
                        value.len() == 2
                            && ["recoveredJobIds", "skippedJobIds"].iter().all(|key| {
                                value
                                    .get(*key)
                                    .and_then(Value::as_array)
                                    .is_some_and(|v| v.is_empty())
                            })
                    })
        }
        _ => return false,
    };
    object.len() == zero_fields.len() + 1
        && object.get("operation").and_then(Value::as_str) == Some(schedule)
        && zero_fields
            .iter()
            .all(|field| object.get(*field).and_then(Value::as_u64) == Some(0))
}

pub(crate) fn reject_expired_occurrence(
    connection: &rusqlite::Connection,
    owner: &str,
    key: &str,
) -> Result<(), StoreError> {
    let Some((schedule, due)) = occurrence(key) else {
        return Ok(());
    };
    let expired = connection.query_row("SELECT 1 FROM runtime_storage_watermarks WHERE owner_principal=?1 AND schedule_id=?2 AND through_due_at>=?3",
        params![owner,schedule,due], |_| Ok(())).optional()?.is_some();
    if expired {
        return Err(StoreError::InvalidInput(
            "scheduled occurrence history has expired; replay is forbidden".into(),
        ));
    }
    Ok(())
}

impl JobStore {
    pub fn storage_maintenance(
        &self,
        paths: &RuntimePaths,
    ) -> Result<StorageMaintenanceReport, StoreError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let started = Instant::now();
        let mut report = StorageMaintenanceReport::default();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        report.busy = connection.query_row("SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling'))", [], |row| row.get(0))?;
        if report.busy {
            return Ok(report);
        }
        let cursor: (i64, String) = connection.query_row(
            "SELECT finished_at,job_id FROM runtime_storage_cursor WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let candidates: Vec<(String, String, String, i64, i64)> = {
            let mut statement = connection.prepare("SELECT job_id,owner_principal,idempotency_key,updated_at,finished_at FROM runtime_jobs
                WHERE state='succeeded' AND (updated_at,job_id)>(?1,?2)
                ORDER BY updated_at,job_id LIMIT 32")?;
            let rows = statement.query_map(params![cursor.0, cursor.1], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?;
            rows.collect::<Result<_, _>>()?
        };
        if candidates.is_empty() {
            connection.execute(
                "UPDATE runtime_storage_cursor SET finished_at=0,job_id='' WHERE id=1",
                [],
            )?;
        }
        for (job, owner, key, updated, finished) in candidates {
            if started.elapsed() > Duration::from_millis(150) {
                break;
            }
            // Recheck after every filesystem yield; a new foreground job ends this slice.
            if connection.query_row("SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling'))", [], |r|r.get::<_,bool>(0))? { report.busy=true; break; }
            report.inspected += 1;
            connection.execute(
                "UPDATE runtime_storage_cursor SET finished_at=?1,job_id=?2 WHERE id=1",
                params![updated, job],
            )?;
            if finished >= now - DAY {
                continue;
            }
            let Some((schedule, due)) = occurrence(&key) else {
                continue;
            };
            if owner != "internal:runtime-scheduler" {
                report.protected += 1;
                continue;
            }
            // Require runtime-owned schedule membership, not a caller-chosen key.
            let bound: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM runtime_schedules WHERE schedule_id=?1)",
                [schedule],
                |r| r.get(0),
            )?;
            if !bound {
                report.protected += 1;
                continue;
            }
            let proof: Option<(String,bool)> = connection.query_row("SELECT result_sha256,directory_cleaned FROM runtime_storage_proofs WHERE job_id=?1", [&job], |r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            let (digest, cleaned) = if let Some(proof) = proof {
                proof
            } else {
                let digest: Option<String> = connection.query_row("SELECT json_extract(payload_json,'$.resultSha256') FROM runtime_job_events
                    WHERE job_id=?1 AND event_type='completion-confirmed' AND json_extract(payload_json,'$.treeExited')=1
                    ORDER BY sequence DESC LIMIT 1", [&job], |r|r.get(0)).optional()?.flatten();
                let Some(digest) = digest else {
                    report.protected += 1;
                    continue;
                };
                drop(connection);
                let bytes = paths.read_bounded_job_result(&job, 64 * 1024);
                connection = self.connection.lock().expect("job store mutex poisoned");
                let Ok(bytes) = bytes else {
                    report.protected += 1;
                    continue;
                };
                let actual = format!("{:x}", Sha256::digest(&bytes));
                let result: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
                if actual != digest
                    || result.pointer("/identity/jobId").and_then(Value::as_str)
                        != Some(job.as_str())
                    || !verified_noop(schedule, &result["result"])
                {
                    report.protected += 1;
                    continue;
                }
                connection.execute("INSERT OR IGNORE INTO runtime_storage_proofs(job_id,schedule_id,due_at,result_sha256) VALUES(?1,?2,?3,?4)",params![job,schedule,due,digest])?;
                (digest, false)
            };
            if !cleaned {
                drop(connection);
                let cleanup = paths.cleanup_noop_job_directory(&job, &digest);
                connection = self.connection.lock().expect("job store mutex poisoned");
                match cleanup {
                    Ok(true) => {
                        connection.execute(
                            "UPDATE runtime_storage_proofs SET directory_cleaned=1 WHERE job_id=?1",
                            [&job],
                        )?;
                        report.directories_removed += 1;
                    }
                    _ => {
                        report.protected += 1;
                        continue;
                    }
                }
            }
            if finished >= now - 7 * DAY {
                continue;
            }
            let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            if !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE job_id=?1 AND state='succeeded')",
                [&job],
                |r| r.get::<_, bool>(0),
            )? {
                continue;
            }
            let prefix = format!("runtime-schedule-{schedule}-");
            let unsettled: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE owner_principal=?1
                AND state IN ('queued','admitted','starting','running','checkpointing','cancelling','uncertain','interrupted')
                AND substr(idempotency_key,1,length(?2))=?2 AND CAST(substr(idempotency_key,length(?2)+1) AS INTEGER)<=?3)",params![owner,prefix,due],|r|r.get(0))?;
            let referenced: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM runtime_schedules WHERE inflight_job_id=?1 OR reconcile_job_id=?1)",[&job],|r|r.get(0))?;
            if unsettled || referenced {
                report.protected += 1;
                continue;
            }
            tx.execute("INSERT INTO runtime_storage_watermarks(owner_principal,schedule_id,through_due_at) VALUES(?1,?2,?3)
                ON CONFLICT(owner_principal,schedule_id) DO UPDATE SET through_due_at=MAX(through_due_at,excluded.through_due_at)",params![owner,schedule,due])?;
            tx.execute(
                "INSERT INTO runtime_storage_daily(day,schedule_id,noop_count) VALUES(?1,?2,1)
                ON CONFLICT(day,schedule_id) DO UPDATE SET noop_count=noop_count+1",
                params![finished / DAY, schedule],
            )?;
            tx.execute(
                "DELETE FROM runtime_jobs WHERE job_id=?1 AND state='succeeded'",
                [&job],
            )?;
            tx.commit()?;
            report.jobs_pruned += 1;
        }
        // Failure outcomes and recovery records stay durable. Only heartbeat and
        // progress diagnostics of settled scheduler failures expire after 30 days.
        // Traverse the existing state/updated_at index; no startup index rebuild.
        if started.elapsed() < Duration::from_millis(150) && !report.busy {
            let cursor: (i64, String) = connection.query_row(
                "SELECT finished_at,job_id FROM runtime_storage_cursor WHERE id=2",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let rows:Vec<(String,String,i64)>=connection.prepare("SELECT job_id,idempotency_key,updated_at FROM runtime_jobs WHERE state='failed' AND (updated_at,job_id)>(?1,?2) ORDER BY updated_at,job_id LIMIT 8")?
                .query_map(params![cursor.0,cursor.1],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<Result<_,_>>()?;
            if rows.is_empty() {
                connection.execute(
                    "UPDATE runtime_storage_cursor SET finished_at=0,job_id='' WHERE id=2",
                    [],
                )?;
            }
            for (job, key, updated) in rows {
                connection.execute(
                    "UPDATE runtime_storage_cursor SET finished_at=?1,job_id=?2 WHERE id=2",
                    params![updated, job],
                )?;
                if updated >= now - 30 * DAY || occurrence(&key).is_none() {
                    continue;
                }
                report.diagnostic_events_pruned+=connection.execute("DELETE FROM runtime_job_events WHERE sequence IN (
                    SELECT e.sequence FROM runtime_job_events e JOIN runtime_jobs j ON j.job_id=e.job_id
                    WHERE j.job_id=?1 AND j.owner_principal='internal:runtime-scheduler' AND j.state='failed'
                      AND e.event_type IN ('heartbeat','progress') AND e.created_at<?2
                      AND NOT EXISTS(SELECT 1 FROM runtime_schedules s WHERE s.inflight_job_id=j.job_id OR s.reconcile_job_id=j.job_id)
                    ORDER BY e.sequence LIMIT 128)",params![job,now-30*DAY])?;
                if started.elapsed() > Duration::from_millis(150) {
                    break;
                }
            }
        }
        connection.execute(
            "DELETE FROM runtime_storage_daily WHERE day<?1",
            [now / DAY - 365],
        )?;
        if started.elapsed() < Duration::from_millis(150)
            && connection.query_row("PRAGMA auto_vacuum", [], |r| r.get::<_, i64>(0))? == 2
        {
            connection.execute_batch("PRAGMA incremental_vacuum(32)")?;
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, JobStore, RuntimePaths) {
        let directory = tempfile::tempdir().unwrap();
        let paths =
            RuntimePaths::new(directory.path(), directory.path(), directory.path()).unwrap();
        let store = JobStore::open_for_test(directory.path().join("runtime.sqlite3")).unwrap();
        store.connection.lock().unwrap().execute("INSERT INTO runtime_schedules(schedule_id,schedule_kind,desired_state,decision_epoch,initial_delay_ms,interval_ms,updated_at) VALUES('scheduled-chats','fixed','running',0,0,1000,1)",[]).unwrap();
        (directory, store, paths)
    }
    fn insert_job(
        store: &JobStore,
        paths: &RuntimePaths,
        id: &str,
        due: i64,
        state: &str,
        result: Value,
    ) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let at = now - 40 * DAY + due;
        let directory = paths.data_root().join(format!("runtime/jobs/{id}"));
        std::fs::create_dir_all(directory.join("workspace")).unwrap();
        let body =
            serde_json::to_vec(&serde_json::json!({"identity":{"jobId":id},"result":result}))
                .unwrap();
        std::fs::write(directory.join("result.json"), &body).unwrap();
        std::fs::write(directory.join("input.json"), b"{}").unwrap();
        let db = store.connection.lock().unwrap();
        db.execute("INSERT INTO runtime_jobs(job_id,job_type,worker_kind,resource_class,owner_principal,state,input_manifest_path,workspace_path,checkpoint_path,result_path,created_at,updated_at,finished_at,idempotency_key,request_digest)
            VALUES(?1,'check','check','lightweight','internal:runtime-scheduler',?2,'input.json','workspace','checkpoint.json','result.json',?3,?3,?3,?4,?5)",
            params![id,state,at,format!("runtime-schedule-scheduled-chats-{due}"),"a".repeat(64)]).unwrap();
        db.execute("INSERT INTO runtime_job_events(job_id,attempt,event_type,payload_json,created_at) VALUES(?1,0,'completion-confirmed',?2,?3)",
            params![id,serde_json::json!({"treeExited":true,"resultSha256":format!("{:x}",Sha256::digest(&body))}).to_string(),at]).unwrap();
    }
    #[test]
    fn recurring_noops_are_bounded_and_expired_retries_cannot_create_work() {
        let (_directory, store, paths) = fixture();
        for due in 1..=80 {
            insert_job(
                &store,
                &paths,
                &format!("job-{due}"),
                due,
                "succeeded",
                serde_json::json!({"operation":"scheduled-chats","dispatched":0}),
            );
        }
        for _ in 0..100 {
            store.storage_maintenance(&paths).unwrap();
            if store
                .connection
                .lock()
                .unwrap()
                .query_row("SELECT count(*) FROM runtime_jobs", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap()
                == 0
            {
                break;
            }
        }
        let db = store.connection.lock().unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM runtime_jobs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT sum(noop_count) FROM runtime_storage_daily",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            80
        );
        assert!(reject_expired_occurrence(
            &db,
            "internal:runtime-scheduler",
            "runtime-schedule-scheduled-chats-80"
        )
        .is_err());
        assert!(reject_expired_occurrence(
            &db,
            "internal:runtime-scheduler",
            "runtime-schedule-scheduled-chats-81"
        )
        .is_ok());
        assert!(!paths.data_root().join("runtime/jobs/job-80").exists());
    }
    #[test]
    fn uncertainty_unique_outputs_and_active_jobs_block_destructive_retention() {
        let (_directory, store, paths) = fixture();
        insert_job(
            &store,
            &paths,
            "uncertain",
            1,
            "uncertain",
            serde_json::json!({}),
        );
        insert_job(
            &store,
            &paths,
            "later",
            2,
            "succeeded",
            serde_json::json!({"operation":"scheduled-chats","dispatched":0}),
        );
        insert_job(
            &store,
            &paths,
            "work",
            3,
            "succeeded",
            serde_json::json!({"operation":"scheduled-chats","dispatched":1}),
        );
        insert_job(
            &store,
            &paths,
            "unique",
            4,
            "succeeded",
            serde_json::json!({"operation":"scheduled-chats","dispatched":0}),
        );
        std::fs::write(
            paths
                .data_root()
                .join("runtime/jobs/unique/workspace/retained.txt"),
            b"unique user work",
        )
        .unwrap();
        for _ in 0..4 {
            store.storage_maintenance(&paths).unwrap();
        }
        let db = store.connection.lock().unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM runtime_jobs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM runtime_storage_watermarks", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(paths
            .data_root()
            .join("runtime/jobs/unique/workspace/retained.txt")
            .exists());
        drop(db);
        insert_job(
            &store,
            &paths,
            "active",
            5,
            "running",
            serde_json::json!({}),
        );
        assert!(store.storage_maintenance(&paths).unwrap().busy);
    }
    #[test]
    fn old_failure_progress_expires_without_removing_failure_or_recovery_evidence() {
        let (_directory, store, paths) = fixture();
        insert_job(&store, &paths, "failed", 1, "failed", serde_json::json!({}));
        insert_job(
            &store,
            &paths,
            "uncertain",
            2,
            "uncertain",
            serde_json::json!({}),
        );
        {
            let db = store.connection.lock().unwrap();
            for id in ["failed", "uncertain"] {
                for kind in ["heartbeat", "progress", "failed", "checkpoint"] {
                    db.execute("INSERT INTO runtime_job_events(job_id,attempt,event_type,payload_json,created_at) VALUES(?1,0,?2,'{}',1)",params![id,kind]).unwrap();
                }
            }
        }
        assert_eq!(
            store
                .storage_maintenance(&paths)
                .unwrap()
                .diagnostic_events_pruned,
            2
        );
        let db = store.connection.lock().unwrap();
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM runtime_job_events WHERE job_id='uncertain'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            5
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM runtime_jobs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn classifier_requires_exact_zero_result_contract() {
        assert!(verified_noop(
            "scheduled-chats",
            &serde_json::json!({"operation":"scheduled-chats","dispatched":0})
        ));
        for result in [
            serde_json::json!({"operation":"scheduled-chats","dispatched":1}),
            serde_json::json!({"operation":"scheduled-chats"}),
            serde_json::json!({"operation":"scheduled-chats","dispatched":0,"artifact":"unique"}),
        ] {
            assert!(!verified_noop("scheduled-chats", &result));
        }
        assert!(!verified_noop(
            "learn-recovery",
            &serde_json::json!({"learnJobId":null})
        ));
    }
    #[test]
    fn watermark_rejects_expired_occurrences_without_reexecuting() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE runtime_storage_watermarks(owner_principal TEXT,schedule_id TEXT,through_due_at INTEGER);").unwrap();
        db.execute(
            "INSERT INTO runtime_storage_watermarks VALUES('runtime','scheduled-chats',100)",
            [],
        )
        .unwrap();
        assert!(
            reject_expired_occurrence(&db, "runtime", "runtime-schedule-scheduled-chats-100")
                .is_err()
        );
        assert!(
            reject_expired_occurrence(&db, "runtime", "runtime-schedule-scheduled-chats-101")
                .is_ok()
        );
        assert!(
            reject_expired_occurrence(&db, "user:1", "runtime-schedule-scheduled-chats-100")
                .is_ok()
        );
        assert!(reject_expired_occurrence(&db, "runtime", "user-request-100").is_ok());
    }
}
