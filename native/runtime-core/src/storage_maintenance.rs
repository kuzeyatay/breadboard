//! Retention belongs to the runtime owner, never to a dashboard SQL connection.
use crate::{JobStore, RuntimePaths, StoreError};
use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DAY: i64 = 86_400_000;
const NOOP_FOLDER_SETTLE_MS: i64 = 3_600_000;
/// Only foreground work defers retention. The scheduler starts a background
/// tick every few seconds, so counting those made `busy` the normal answer:
/// on a real install the cursor fell 56 days behind while ~9,000 jobs a day
/// accumulated. Candidates are `succeeded` rows only and an in-flight
/// occurrence of the same schedule is still protected by `unsettled` below,
/// so a running tick can never be the job being cleaned.
const FOREGROUND_ACTIVE: &str = "SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling') AND owner_principal<>'internal:runtime-scheduler')";
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

/// Settled history is kept forever, but 97% of it (measured on a real 900k-job
/// store) is liveness pings: `heartbeat` and `progress`, ~1.8 GB for 71k jobs a
/// person started. Thirty days after a job settles its pings are packed into one
/// deflated row (about 23x smaller) and replay reads them back transparently:
/// the same events, sequences and payload bytes. Nothing is dropped.
pub(crate) const SCHEMA_V15: &str = r#"
CREATE TABLE runtime_job_event_archive (
  job_id TEXT PRIMARY KEY REFERENCES runtime_jobs(job_id) ON DELETE CASCADE,
  first_sequence INTEGER NOT NULL, last_sequence INTEGER NOT NULL, event_count INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL, data BLOB NOT NULL, archived_at INTEGER NOT NULL
);
CREATE TABLE runtime_storage_archive_cursor (id INTEGER PRIMARY KEY CHECK(id=1), row_id INTEGER NOT NULL);
INSERT INTO runtime_storage_archive_cursor VALUES(1,0);
PRAGMA user_version=15;
"#;
const ARCHIVE_AFTER_MS: i64 = 30 * DAY;
const ARCHIVE_MIN_EVENTS: usize = 16;
/// Replay never inflates more than this; a larger job simply stays unpacked.
const ARCHIVE_MAX_RAW_BYTES: usize = 64 * 1024 * 1024;
/// Rowids scanned per slice, so finding candidates stays bounded.
const ARCHIVE_WINDOW: i64 = 2_048;
const SETTLED: &str = "state IN ('succeeded','failed','cancelled','resource_exhausted')";

/// One archived event, exactly as its row stored it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ArchivedEvent {
    pub sequence: i64,
    pub attempt: i64,
    pub worker_instance_id: Option<String>,
    pub worker_sequence: Option<i64>,
    pub event_type: String,
    pub payload_json: String,
    pub created_at: i64,
}

pub(crate) fn unpack_archived_events(data: &[u8], raw_bytes: i64) -> Result<Vec<ArchivedEvent>, StoreError> {
    let corrupt = || StoreError::CorruptState("archived job events could not be read".into());
    let length = usize::try_from(raw_bytes)
        .ok()
        .filter(|length| *length <= ARCHIVE_MAX_RAW_BYTES)
        .ok_or_else(corrupt)?;
    let mut bytes = Vec::with_capacity(length);
    DeflateDecoder::new(data)
        .take(length as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| corrupt())?;
    if bytes.len() != length {
        return Err(corrupt());
    }
    serde_json::from_slice(&bytes).map_err(|_| corrupt())
}

fn pack_archived_events(events: &[ArchivedEvent]) -> Option<(Vec<u8>, i64)> {
    let raw = serde_json::to_vec(events).ok()?;
    if raw.len() > ARCHIVE_MAX_RAW_BYTES {
        return None;
    }
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&raw).ok()?;
    let data = encoder.finish().ok()?;
    let raw_bytes = i64::try_from(raw.len()).ok()?;
    // Never trade rows for a blob that does not read back identically.
    (unpack_archived_events(&data, raw_bytes).ok()?.as_slice() == events).then_some((data, raw_bytes))
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMaintenanceReport {
    pub busy: bool,
    pub inspected: usize,
    pub jobs_pruned: usize,
    pub directories_removed: usize,
    pub protected: usize,
    pub diagnostic_events_pruned: usize,
    pub events_archived: usize,
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

/// Status probes a page starts for the signed-in person: is the Claude account
/// connected, where is this device, is transcription up. The answer goes back to
/// the page that asked and is never read again, so a succeeded probe has no
/// history worth keeping. A closed list of job types, each bound to the key
/// prefix its own caller uses; anything else a person started is kept.
fn status_probe(job_type: &str, key: &str) -> bool {
    (job_type == "claude-account" && key.starts_with("claude-account-status-"))
        || (job_type == "system-location" && key.starts_with("system-location-v2:"))
        || (job_type == "scriberr-garden-health" && key.starts_with("scriberr-health-v2:"))
}

/// Closed result shapes: new output fields require an explicit policy review.
fn verified_noop(schedule: &str, result: &Value) -> bool {
    let Some(object) = result.as_object() else {
        return false;
    };
    // Fields a schedule added later, so older and newer receipts differ only by
    // their presence. Each still has to be exactly zero when present: about
    // 49,000 receipts of these two shapes were otherwise protected forever.
    let optional_zero: &[&str] = match schedule {
        // `handedBack` (runs returned to their owner) arrived after `dispatched`.
        "scheduled-chats" => &["handedBack"],
        // Older reaper builds reported only `resumed`.
        "hermes-abandoned-run-recovery" => &["reconciled"],
        _ => &[],
    };
    let zero_fields: &[&str] = match schedule {
        "review-scheduler" => &["considered", "sent"],
        "scheduled-chats" => &["dispatched"],
        "caldav-sync" => &["considered", "synced", "failed", "leased"],
        "calendar-reminders" => {
            // `recipients` counts the people who have reminders switched on, not
            // work done: with two of them and nothing due, every run reported
            // recipients=2 and none was ever recognised as a no-op.
            return object.len() == 5
                && object.get("operation").and_then(Value::as_str) == Some(schedule)
                && object.get("recipients").and_then(Value::as_u64).is_some()
                && ["delivered", "failed"]
                    .iter()
                    .all(|key| object.get(*key).and_then(Value::as_u64) == Some(0))
                && object
                    .get("errors")
                    .and_then(Value::as_array)
                    .is_some_and(|errors| errors.is_empty())
        }
        "hermes-abandoned-run-recovery" => &["resumed"],
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
    let present_optional = optional_zero.iter().filter(|field| object.contains_key(**field)).count();
    object.len() == zero_fields.len() + present_optional + 1
        && object.get("operation").and_then(Value::as_str) == Some(schedule)
        && zero_fields
            .iter()
            .chain(optional_zero.iter().filter(|field| object.contains_key(**field)))
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
        report.busy = connection.query_row(FOREGROUND_ACTIVE, [], |row| row.get(0))?;
        if report.busy {
            return Ok(report);
        }
        // The archive goes first with a fixed share of the slice, so neither a
        // retention backlog nor a slow disk can starve it (or it the pruner).
        {
            let from: i64 = connection.query_row(
                "SELECT row_id FROM runtime_storage_archive_cursor WHERE id=1",
                [],
                |r| r.get(0),
            )?;
            let jobs: Vec<(i64, String)> = connection
                .prepare(&format!(
                    // `+` keeps the planner on the rowid window. Through the
                    // state index it walked every settled job older than 30
                    // days (400,000 rows, ~31 ms warm on a real install), most
                    // of the slice, so the pruner below retired about one job
                    // per pass and fell weeks behind.
                    "SELECT rowid,job_id FROM runtime_jobs
                    WHERE rowid>?1 AND rowid<=?1+?2 AND +{SETTLED} AND +updated_at<?3
                      AND NOT (state='succeeded' AND owner_principal='internal:runtime-scheduler')
                      AND NOT EXISTS(SELECT 1 FROM runtime_job_event_archive a WHERE a.job_id=runtime_jobs.job_id)
                    ORDER BY rowid"
                ))?
                .query_map(params![from, ARCHIVE_WINDOW, now - ARCHIVE_AFTER_MS], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?
                .collect::<Result<_, _>>()?;
            let mut reached = from + ARCHIVE_WINDOW;
            for (row_id, job) in jobs {
                if started.elapsed() > Duration::from_millis(50) {
                    reached = row_id - 1;
                    break;
                }
                let events: Vec<ArchivedEvent> = connection
                    .prepare(
                        "SELECT sequence,attempt,worker_instance_id,worker_sequence,event_type,payload_json,created_at
                        FROM runtime_job_events WHERE job_id=?1 AND event_type IN ('heartbeat','progress')
                          AND typeof(payload_json)='text' ORDER BY sequence",
                    )?
                    .query_map([&job], |r| {
                        Ok(ArchivedEvent {
                            sequence: r.get(0)?,
                            attempt: r.get(1)?,
                            worker_instance_id: r.get(2)?,
                            worker_sequence: r.get(3)?,
                            event_type: r.get(4)?,
                            payload_json: r.get(5)?,
                            created_at: r.get(6)?,
                        })
                    })?
                    .collect::<Result<_, _>>()?;
                if events.len() < ARCHIVE_MIN_EVENTS {
                    continue;
                }
                let Some((data, raw_bytes)) = pack_archived_events(&events) else {
                    continue;
                };
                let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let settled: bool = tx.query_row(
                    &format!(
                        "SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE job_id=?1 AND {SETTLED} AND updated_at<?2)
                        AND NOT EXISTS(SELECT 1 FROM runtime_schedules WHERE inflight_job_id=?1 OR reconcile_job_id=?1)"
                    ),
                    params![job, now - ARCHIVE_AFTER_MS],
                    |r| r.get(0),
                )?;
                if !settled {
                    continue;
                }
                tx.execute(
                    "INSERT INTO runtime_job_event_archive(job_id,first_sequence,last_sequence,event_count,raw_bytes,data,archived_at)
                    VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        job,
                        events[0].sequence,
                        events[events.len() - 1].sequence,
                        events.len() as i64,
                        raw_bytes,
                        data,
                        now
                    ],
                )?;
                let mut removed = 0;
                {
                    let mut delete = tx.prepare(
                        "DELETE FROM runtime_job_events WHERE sequence=?1 AND job_id=?2
                        AND event_type IN ('heartbeat','progress') AND payload_json=?3",
                    )?;
                    for event in &events {
                        removed += delete.execute(params![event.sequence, job, event.payload_json])?;
                    }
                }
                // Exactly the packed rows, or nothing: a row changed since it was read.
                if removed != events.len() {
                    continue;
                }
                tx.commit()?;
                report.events_archived += removed;
            }
            let last: i64 =
                connection.query_row("SELECT COALESCE(MAX(rowid),0) FROM runtime_jobs", [], |r| r.get(0))?;
            connection.execute(
                "UPDATE runtime_storage_archive_cursor SET row_id=?1 WHERE id=1",
                [if reached >= last { 0 } else { reached }],
            )?;
        }
        let cursor: (i64, String) = connection.query_row(
            "SELECT finished_at,job_id FROM runtime_storage_cursor WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let candidates: Vec<(String, String, String, i64, i64, String)> = {
            let mut statement = connection.prepare("SELECT job_id,owner_principal,idempotency_key,updated_at,finished_at,job_type FROM runtime_jobs
                WHERE state='succeeded' AND (updated_at,job_id)>(?1,?2)
                ORDER BY updated_at,job_id LIMIT 256")?;
            let rows = statement.query_map(params![cursor.0, cursor.1], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
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
        // The cursor is saved once per slice, not per candidate: each commit is a
        // full fsync, and on a slow disk those per-candidate commits were most of
        // the slice. After a crash the slice is simply re-inspected; every step
        // below is idempotent (INSERT OR IGNORE, digest-checked cleanup, a
        // state-guarded delete).
        let mut reached: Option<(i64, String)> = None;
        for (job, owner, key, updated, finished, job_type) in candidates {
            // Every slice retires at least one candidate: on a large store the
            // archive step alone can use the budget, and slices that inspected
            // nothing left the cursor where it was, pass after pass.
            if report.inspected > 0 && started.elapsed() > Duration::from_millis(150) {
                break;
            }
            // Recheck after every filesystem yield; a new foreground job ends this slice.
            if connection.query_row(FOREGROUND_ACTIVE, [], |r|r.get::<_,bool>(0))? { report.busy=true; break; }
            report.inspected += 1;
            reached = Some((updated, job.clone()));
            // A verified no-op's folder holds nothing but its own receipt. Waiting
            // a day meant ~9,000 folders (and their files) always existed first;
            // an hour bounds that to a few hundred. History rows still keep 7 days.
            if finished >= now - NOOP_FOLDER_SETTLE_MS {
                continue;
            }
            if status_probe(&job_type, &key) {
                if finished >= now - 7 * DAY || !owner.starts_with("user:") {
                    continue;
                }
                // Same evidence as a scheduled no-op: the run is confirmed over and
                // the result on disk is the one it reported, or the folder is gone.
                let digest: Option<String> = connection.query_row("SELECT json_extract(payload_json,'$.resultSha256') FROM runtime_job_events
                    WHERE job_id=?1 AND event_type='completion-confirmed' AND json_extract(payload_json,'$.treeExited')=1
                    ORDER BY sequence DESC LIMIT 1", [&job], |r|r.get(0)).optional()?.flatten();
                let Some(digest) = digest else {
                    report.protected += 1;
                    continue;
                };
                drop(connection);
                let cleanup = paths.cleanup_noop_job_directory(&job, &digest);
                connection = self.connection.lock().expect("job store mutex poisoned");
                if !matches!(cleanup, Ok(true)) {
                    report.protected += 1;
                    continue;
                }
                report.directories_removed += 1;
                report.jobs_pruned += connection.execute(
                    "DELETE FROM runtime_jobs WHERE job_id=?1 AND state='succeeded'",
                    [&job],
                )?;
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
                match bytes {
                    Ok(bytes) => {
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
                    }
                    // A scheduled occurrence whose folder is already gone has no
                    // result left to protect; only its history rows remain. They
                    // were unreachable before: the unreadable result marked the job
                    // protected on every pass, for 365,000 rows by 2026-11-16.
                    Err(_) if paths.job_directory_absent(&job) => {
                        connection.execute("INSERT OR IGNORE INTO runtime_storage_proofs(job_id,schedule_id,due_at,result_sha256,directory_cleaned) VALUES(?1,?2,?3,?4,1)",params![job,schedule,due,digest])?;
                        (digest, true)
                    }
                    Err(_) => {
                        report.protected += 1;
                        continue;
                    }
                }
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
            // An uncertain or interrupted occurrence is never settled by anyone, so
            // without the age bound one such row from September stopped every later
            // occurrence of its schedule from being pruned. The row itself is kept.
            // Driven by the state index: unsettled rows are a few hundred, while the
            // owner index walked every scheduler job (~0.6 s per candidate on a real
            // 900k-job store, so the pruner retired about one job per slice).
            let unsettled: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM runtime_jobs
                WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling','uncertain','interrupted')
                AND +owner_principal=?1
                AND (state NOT IN ('uncertain','interrupted') OR updated_at>=?4)
                AND substr(idempotency_key,1,length(?2))=?2 AND CAST(substr(idempotency_key,length(?2)+1) AS INTEGER)<=?3)",params![owner,prefix,due,now-7*DAY],|r|r.get(0))?;
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
        if let Some((updated, job)) = reached {
            connection.execute(
                "UPDATE runtime_storage_cursor SET finished_at=?1,job_id=?2 WHERE id=1",
                params![updated, job],
            )?;
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
            connection.execute_batch("PRAGMA incremental_vacuum(1024)")?;
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
        let worker = directory.join("attempts/1/worker_1");
        std::fs::create_dir_all(worker.join("workspace")).unwrap();
        std::fs::write(worker.join("diagnostics.log"), b"started\n").unwrap();
        std::fs::write(worker.join("start.json"), b"{}").unwrap();
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
        // Only a recently unsettled occurrence holds back its schedule.
        store.connection.lock().unwrap().execute(
            "UPDATE runtime_jobs SET updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE job_id='uncertain'", []).unwrap();
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
        // A scheduler tick is always in flight on a real install; it must not
        // starve retention, and it is never itself a candidate.
        assert!(!store.storage_maintenance(&paths).unwrap().busy);
        assert!(paths.data_root().join("runtime/jobs/active").exists());
        store
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE runtime_jobs SET owner_principal='user:1' WHERE job_id='active'",
                [],
            )
            .unwrap();
        assert!(store.storage_maintenance(&paths).unwrap().busy);
    }

    /// Replays retention against a snapshot of a real install:
    /// `BREADBOARD_RETENTION_PROOF_DB=<copy> cargo test -p breadboard-runtime-core --lib retention_proof -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn retention_proof_against_a_real_snapshot() {
        let Ok(database) = std::env::var("BREADBOARD_RETENTION_PROOF_DB") else { return; };
        let store = JobStore::open_for_test(&database).unwrap();
        let parent = std::path::Path::new(&database).parent().unwrap();
        let paths = RuntimePaths::new(parent, parent, parent).unwrap();
        let count = |store: &JobStore, sql: &str| -> i64 {
            store.connection.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
        };
        let before_jobs = count(&store, "SELECT count(*) FROM runtime_jobs");
        let before_events = count(&store, "SELECT count(*) FROM runtime_job_events");
        let old_gate_busy = count(&store, "SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling'))");
        // Original ping rows of the largest eligible jobs, to prove the archive is lossless.
        let sample: Vec<(String, Vec<ArchivedEvent>)> = {
            let db = store.connection.lock().unwrap();
            let cutoff = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64 - ARCHIVE_AFTER_MS;
            let jobs: Vec<String> = db.prepare(&format!("SELECT j.job_id FROM runtime_jobs j JOIN runtime_job_events e ON e.job_id=j.job_id
                WHERE j.{SETTLED} AND j.updated_at<?1 AND j.owner_principal<>'internal:runtime-scheduler' AND e.event_type IN ('heartbeat','progress')
                GROUP BY j.job_id ORDER BY count(*) DESC LIMIT 20")).unwrap()
                .query_map([cutoff], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
            jobs.into_iter().map(|job| {
                let rows = db.prepare("SELECT sequence,attempt,worker_instance_id,worker_sequence,event_type,payload_json,created_at FROM runtime_job_events
                    WHERE job_id=?1 AND event_type IN ('heartbeat','progress') AND typeof(payload_json)='text' ORDER BY sequence").unwrap()
                    .query_map([&job], |r| Ok(ArchivedEvent { sequence: r.get(0)?, attempt: r.get(1)?, worker_instance_id: r.get(2)?,
                        worker_sequence: r.get(3)?, event_type: r.get(4)?, payload_json: r.get(5)?, created_at: r.get(6)? })).unwrap()
                    .collect::<Result<_, _>>().unwrap();
                (job, rows)
            }).collect()
        };
        let started = Instant::now();
        let limit = Duration::from_secs(
            std::env::var("BREADBOARD_RETENTION_PROOF_SECONDS").ok().and_then(|v| v.parse().ok()).unwrap_or(480),
        );
        let (mut calls, mut pruned, mut idle, mut archived) = (0usize, 0usize, 0usize, 0usize);
        while started.elapsed() < limit && idle < 3 {
            let report = store.storage_maintenance(&paths).unwrap();
            assert!(!report.busy, "only scheduler ticks are active in this snapshot");
            calls += 1;
            pruned += report.jobs_pruned;
            archived += report.events_archived;
            idle = if report.jobs_pruned + report.directories_removed + report.inspected + report.events_archived == 0 { idle + 1 } else { 0 };
        }
        let elapsed = started.elapsed().as_secs_f64();
        let after_jobs = count(&store, "SELECT count(*) FROM runtime_jobs");
        let after_events = count(&store, "SELECT count(*) FROM runtime_job_events");
        let pages = count(&store, "PRAGMA page_count");
        let free = count(&store, "PRAGMA freelist_count");
        let (archives, packed, raw) = store.connection.lock().unwrap().query_row(
            "SELECT count(*),COALESCE(sum(length(data)),0),COALESCE(sum(raw_bytes),0) FROM runtime_job_event_archive", [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))).unwrap();
        let mut verified = 0;
        for (job, rows) in &sample {
            let packed_row: Option<(i64, Vec<u8>)> = store.connection.lock().unwrap().query_row(
                "SELECT raw_bytes,data FROM runtime_job_event_archive WHERE job_id=?1", [job], |r| Ok((r.get(0)?, r.get(1)?))).optional().unwrap();
            if let Some((raw_bytes, data)) = packed_row {
                assert_eq!(&unpack_archived_events(&data, raw_bytes).unwrap(), rows, "archive of {job} must equal its original rows");
                verified += 1;
            }
        }
        println!("archive: {archived} events packed into {archives} rows, {:.1} MB -> {:.1} MB; {verified}/{} sampled jobs verified byte-identical",
            raw as f64 / 1048576.0, packed as f64 / 1048576.0, sample.len());
        let page_size = count(&store, "PRAGMA page_size");
        println!(
            "old gate busy={old_gate_busy}; {calls} slices in {elapsed:.0}s ({:.1} ms of work each); \
             jobs {before_jobs} -> {after_jobs} (pruned {pruned}); events {before_events} -> {after_events}; \
             file {:.2} GB with {:.2} GB already free for incremental vacuum",
            elapsed * 1000.0 / calls as f64,
            (pages * page_size) as f64 / 1e9 / 1.073_741_824,
            (free * page_size) as f64 / 1e9 / 1.073_741_824,
        );
    }

    #[test]
    fn verified_noop_folders_go_within_hours_while_history_rows_keep_a_week() {
        let (_directory, store, paths) = fixture();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        for (id, due, age) in [("two-hours", 1, 2 * 3_600_000), ("ten-minutes", 2, 600_000)] {
            insert_job(
                &store,
                &paths,
                id,
                due,
                "succeeded",
                serde_json::json!({"operation":"scheduled-chats","dispatched":0}),
            );
            store
                .connection
                .lock()
                .unwrap()
                .execute(
                    "UPDATE runtime_jobs SET finished_at=?1,updated_at=?1 WHERE job_id=?2",
                    params![now - age, id],
                )
                .unwrap();
        }
        for _ in 0..4 {
            store.storage_maintenance(&paths).unwrap();
        }
        let jobs = paths.data_root().join("runtime/jobs");
        assert!(!jobs.join("two-hours").exists());
        assert!(jobs.join("ten-minutes/result.json").exists());
        let rows: i64 = store
            .connection
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM runtime_jobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 2, "history rows are kept for the full week");
    }

    #[test]
    fn scheduler_ticks_in_flight_do_not_stall_the_backlog() {
        let (_directory, store, paths) = fixture();
        for due in 1..=40 {
            insert_job(
                &store,
                &paths,
                &format!("job-{due}"),
                due,
                "succeeded",
                serde_json::json!({"operation":"scheduled-chats","dispatched":0}),
            );
        }
        // A later occurrence is running, as one always is.
        insert_job(&store, &paths, "tick", 10_000_000, "running", serde_json::json!({}));
        for _ in 0..100 {
            store.storage_maintenance(&paths).unwrap();
        }
        let remaining: i64 = store
            .connection
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM runtime_jobs WHERE state='succeeded'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
        assert!(paths.data_root().join("runtime/jobs/tick").exists());
        assert!(!paths.data_root().join("runtime/jobs/job-1").exists());
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
    fn history_of_a_job_whose_folder_is_gone_is_pruned_and_unknown_attempt_files_are_kept() {
        let (_directory, store, paths) = fixture();
        let noop = serde_json::json!({"operation":"scheduled-chats","dispatched":0});
        insert_job(&store, &paths, "gone", 1, "succeeded", noop.clone());
        insert_job(&store, &paths, "kept", 2, "succeeded", noop);
        std::fs::remove_dir_all(paths.data_root().join("runtime/jobs/gone")).unwrap();
        let unknown = paths.data_root().join("runtime/jobs/kept/attempts/1/worker_1/output.bin");
        std::fs::write(&unknown, b"not a known diagnostic").unwrap();
        for _ in 0..4 {
            store.storage_maintenance(&paths).unwrap();
        }
        let db = store.connection.lock().unwrap();
        let jobs: Vec<String> = db.prepare("SELECT job_id FROM runtime_jobs ORDER BY job_id").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(jobs, ["kept"]);
        assert!(unknown.exists());
        assert!(paths.data_root().join("runtime/jobs/kept/result.json").exists());
    }
    #[test]
    fn old_status_probes_are_removed_and_other_work_a_person_started_is_kept() {
        let (_directory, store, paths) = fixture();
        let result = serde_json::json!({"operation":"status","connected":true});
        for (id, kind, key) in [
            ("probe", "claude-account", "claude-account-status-0001"),
            ("place", "system-location", "system-location-v2:0002"),
            ("research", "max-research-run", "claude-account-status-0003"),
            ("renamed", "claude-account", "claude-account-login-0004"),
        ] {
            insert_job(&store, &paths, id, 1, "succeeded", result.clone());
            store.connection.lock().unwrap().execute(
                "UPDATE runtime_jobs SET owner_principal='user:1',job_type=?2,idempotency_key=?3 WHERE job_id=?1",
                params![id, kind, key]).unwrap();
        }
        for _ in 0..4 {
            store.storage_maintenance(&paths).unwrap();
        }
        let db = store.connection.lock().unwrap();
        let jobs: Vec<String> = db.prepare("SELECT job_id FROM runtime_jobs ORDER BY job_id").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(jobs, ["renamed", "research"]);
        assert!(!paths.data_root().join("runtime/jobs/probe").exists());
        assert!(paths.data_root().join("runtime/jobs/research/result.json").exists());
    }
    #[test]
    fn classifier_requires_exact_zero_result_contract() {
        assert!(verified_noop(
            "calendar-reminders",
            &serde_json::json!({"operation":"calendar-reminders","recipients":2,"delivered":0,"failed":0,"errors":[]})
        ));
        assert!(!verified_noop(
            "calendar-reminders",
            &serde_json::json!({"operation":"calendar-reminders","recipients":2,"delivered":1,"failed":0,"errors":[]})
        ));
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
        // Receipt shapes written by older and newer builds of the same schedule.
        for (schedule, result) in [
            ("scheduled-chats", serde_json::json!({"operation":"scheduled-chats","dispatched":0,"handedBack":0})),
            ("hermes-abandoned-run-recovery", serde_json::json!({"operation":"hermes-abandoned-run-recovery","resumed":0})),
            ("hermes-abandoned-run-recovery", serde_json::json!({"operation":"hermes-abandoned-run-recovery","resumed":0,"reconciled":0})),
        ] {
            assert!(verified_noop(schedule, &result), "{result}");
        }
        for (schedule, result) in [
            ("scheduled-chats", serde_json::json!({"operation":"scheduled-chats","dispatched":0,"handedBack":1})),
            ("scheduled-chats", serde_json::json!({"operation":"scheduled-chats","handedBack":0})),
            ("hermes-abandoned-run-recovery", serde_json::json!({"operation":"hermes-abandoned-run-recovery","resumed":0,"reconciled":2})),
            ("hermes-abandoned-run-recovery", serde_json::json!({"operation":"hermes-abandoned-run-recovery","reconciled":0})),
            ("hermes-abandoned-run-recovery", serde_json::json!({"operation":"hermes-abandoned-run-recovery","resumed":0,"note":"x"})),
            ("review-scheduler", serde_json::json!({"operation":"review-scheduler","considered":0,"sent":0,"handedBack":0})),
        ] {
            assert!(!verified_noop(schedule, &result), "{result}");
        }
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
