//! Storage maintenance for the fixed, Runtime-owned Recall data directory.
use crate::storage_compaction::{available_bytes, reject_link};
use crate::RuntimePaths;
use breadboard_runtime_protocol::RuntimeRecallStorageIssue as Issue;
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const DIRECTORY: &str = "recall/data";
pub(crate) const RECALL_DATABASE: &str = "recall/data/db.sqlite";
const MARKER: &str = "db.sqlite.quarantine.json";
const GIB: u64 = 1024 * 1024 * 1024;
const PROBE_MS: u64 = 5_000;
const SWEEP_MS: u64 = 10 * 60_000;
const RECOVERY_RETRY_MS: u64 = 15 * 60_000;
const SCAN_SIZE: i64 = 2_000;
const BATCH_SIZE: i64 = 64;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Prepare an empty database once so SQLite can return free pages in place.
/// Screenpipe initializes its own schema and remains the recording writer.
pub fn prepare_new_recall_database(paths: &RuntimePaths) -> Result<()> {
    let directory = paths.prepare_data_directory(DIRECTORY)?;
    let database = directory.absolute().join("db.sqlite");
    if regular_file(&database)? {
        return Ok(());
    }
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&database)?;
    let db = open_database(
        &database,
        OpenFlags::SQLITE_OPEN_READ_WRITE,
        Duration::from_secs(2),
    )?;
    db.execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM")?;
    Ok(())
}

#[derive(Default)]
pub struct RecallStorage {
    issue: Option<Issue>,
    next_probe_ms: u64,
    next_sweep_ms: u64,
    cursor: i64,
    next_recovery_ms: u64,
    checking: bool,
    worker: Option<JoinHandle<Work>>,
}

enum Work {
    Compact(Result<Option<i64>>),
    Recover(Result<bool>),
}

impl RecallStorage {
    pub fn issue(&self) -> Option<Issue> {
        self.issue
    }

    pub fn tick(&mut self, paths: &RuntimePaths, now_ms: u64, ready: bool, offline: bool) {
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| worker.is_finished())
        {
            let worker = self.worker.take().expect("finished Recall worker");
            match worker.join() {
                Ok(Work::Compact(Ok(Some(cursor)))) => {
                    self.cursor = cursor;
                    self.next_sweep_ms = now_ms.saturating_add(1_000);
                }
                Ok(Work::Compact(result)) => {
                    if let Err(error) = result {
                        eprintln!("[recall] history compaction deferred: {error}");
                    }
                    self.cursor = 0;
                }
                Ok(Work::Recover(Ok(true))) => {
                    self.checking = false;
                    self.next_probe_ms = 0;
                }
                Ok(Work::Recover(result)) => {
                    if let Err(error) = result {
                        eprintln!("[recall] history check deferred: {error}");
                    }
                    self.checking = false;
                    self.issue = Some(Issue::HistoryNeedsRepair);
                }
                Err(_) => {
                    self.checking = false;
                    eprintln!("[recall] storage worker stopped unexpectedly");
                }
            }
        }
        if now_ms < self.next_probe_ms {
            return;
        }
        self.next_probe_ms = now_ms.saturating_add(PROBE_MS);
        if let Err(error) = self.probe(paths, now_ms, ready, offline) {
            if self.issue != Some(Issue::StorageUnavailable) {
                eprintln!("[recall] storage is unavailable: {error}");
            }
            self.issue = Some(Issue::StorageUnavailable);
        }
    }

    fn probe(
        &mut self,
        paths: &RuntimePaths,
        now_ms: u64,
        ready: bool,
        offline: bool,
    ) -> Result<()> {
        let directory = paths.resolve_data(DIRECTORY)?;
        let volume = if directory.absolute().try_exists()? {
            Some(paths.pin_data_launch_directory(DIRECTORY)?)
        } else if paths.resolve_data("recall")?.absolute().try_exists()? {
            Some(paths.pin_data_launch_directory("recall")?)
        } else {
            None
        };
        let volume_path = volume
            .as_ref()
            .map_or(paths.data_root(), |pin| pin.absolute());
        if !has_headroom(
            available_bytes(volume_path)?,
            !offline && self.issue != Some(Issue::LowDisk),
        ) {
            self.issue = Some(Issue::LowDisk);
            return Ok(());
        }
        let installer_status = paths.resolve_data("recall/install-status.json")?;
        if self.checking || repair_active(installer_status.absolute())? {
            self.issue = Some(Issue::CheckingHistory);
            return Ok(());
        }
        let marker = directory.absolute().join(MARKER);
        if regular_file(&marker)? {
            // A repair across a live DB/WAL generation is unsafe. Let the
            // controller drain the recorder tree first, even during startup.
            self.issue = Some(Issue::HistoryNeedsRepair);
            if self.worker.is_none()
                && offline
                && now_ms >= self.next_recovery_ms
                && io_fault_marker(&marker)?
            {
                self.next_recovery_ms = now_ms.saturating_add(RECOVERY_RETRY_MS);
                self.spawn("recall-history-check", move || {
                    Work::Recover((|| {
                        volume
                            .as_ref()
                            .ok_or("missing Recall directory")?
                            .revalidate()?;
                        release_io_quarantine(&marker)
                    })())
                })?;
                self.checking = true;
                self.issue = Some(Issue::CheckingHistory);
            }
            return Ok(());
        }
        self.issue = None;
        self.next_recovery_ms = 0;
        if ready && self.worker.is_none() && now_ms >= self.next_sweep_ms {
            self.next_sweep_ms = now_ms.saturating_add(SWEEP_MS);
            let database = directory.absolute().join("db.sqlite");
            if regular_file(&database)? {
                let cursor = self.cursor;
                self.spawn("recall-history-compaction", move || {
                    Work::Compact((|| {
                        volume
                            .as_ref()
                            .ok_or("missing Recall directory")?
                            .revalidate()?;
                        compact_slice(&database, cursor)
                    })())
                })?;
            }
        }
        Ok(())
    }

    fn spawn(
        &mut self,
        name: &str,
        task: impl FnOnce() -> Work + Send + 'static,
    ) -> io::Result<()> {
        self.worker = Some(thread::Builder::new().name(name.into()).spawn(task)?);
        Ok(())
    }
}

fn has_headroom(available: u64, resident: bool) -> bool {
    available >= if resident { GIB } else { 2 * GIB }
}

fn regular_file(path: &Path) -> io::Result<bool> {
    reject_link(path)?;
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(true),
        Ok(_) => Err(io::Error::other("expected a regular Recall storage file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn open_database(path: &Path, mode: OpenFlags, deadline: Duration) -> Result<Connection> {
    for member in [
        path.to_owned(),
        path.with_file_name("db.sqlite-wal"),
        path.with_file_name("db.sqlite-shm"),
        path.with_file_name("db.sqlite-journal"),
    ] {
        regular_file(&member)?;
    }
    let db = Connection::open_with_flags(path, mode)?;
    db.busy_timeout(Duration::from_millis(75))?;
    let deadline = Instant::now() + deadline;
    db.progress_handler(10_000, Some(move || Instant::now() >= deadline));
    Ok(db)
}

fn marker_bytes(marker: &Path) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(marker)?.take(4097).read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn repair_active(status: &Path) -> Result<bool> {
    if !regular_file(status)? {
        return Ok(false);
    }
    let metadata = fs::metadata(status)?;
    if metadata.len() > 4096
        || metadata.modified()?.elapsed().unwrap_or_default() > Duration::from_secs(120)
    {
        return Ok(false);
    }
    let value: serde_json::Value = match serde_json::from_slice(&marker_bytes(status)?) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    Ok(
        value.get("phase").and_then(|phase| phase.as_str()) == Some("installing")
            && value
                .get("message")
                .and_then(|message| message.as_str())
                .is_some_and(|message| message.starts_with("Repairing")),
    )
}

fn is_io_fault(bytes: &[u8]) -> bool {
    if bytes.len() > 4096 {
        return false;
    }
    let code = serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|value| value.get("sqlite_code")?.as_i64());
    matches!(code.map(|code| code & 0xff), Some(10 | 13))
}

fn io_fault_marker(marker: &Path) -> Result<bool> {
    Ok(is_io_fault(&marker_bytes(marker)?))
}

fn release_io_quarantine(marker: &Path) -> Result<bool> {
    if !regular_file(marker)? {
        return Ok(false);
    }
    // SQLite checks the database together with its WAL. A known disk write
    // error can be cleared in place only when the existing history is intact.
    let before = marker_bytes(marker)?;
    if !is_io_fault(&before) {
        return Ok(false);
    }
    let database = marker.with_file_name("db.sqlite");
    let db = open_database(
        &database,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
        Duration::from_secs(60),
    )?;
    let intact = db.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0))? == "ok";
    drop(db);
    if !intact || !regular_file(marker)? || marker_bytes(marker)? != before {
        return Ok(false);
    }
    let resolved = marker.with_file_name("db.sqlite.quarantine.last-resolved.json");
    reject_link(&resolved)?;
    crate::paths::install_file_replace(marker, &resolved)?;
    Ok(true)
}

fn compact_slice(path: &Path, cursor: i64) -> Result<Option<i64>> {
    let mut db = open_database(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE,
        Duration::from_secs(2),
    )?;
    let end: Option<i64> = db.query_row(
        "SELECT max(id) FROM (SELECT id FROM frames WHERE id > ?1 ORDER BY id LIMIT ?2)",
        (cursor, SCAN_SIZE),
        |row| row.get(0),
    )?;
    let Some(end) = end else {
        // Databases converted by Storage maintenance release free pages here.
        // Older databases reuse their free pages with no live rebuild.
        let free = db.query_row("PRAGMA freelist_count", [], |row| row.get::<_, i64>(0))?;
        if free > 512 {
            db.execute_batch("PRAGMA incremental_vacuum(512)")?;
        }
        return Ok(None);
    };
    let mut pick = db.prepare(
        "SELECT id FROM frames WHERE id > ?1 AND id <= ?2
         AND timestamp < strftime('%Y-%m-%dT%H:%M:%S','now','-2 days')
         AND accessibility_tree_json IS NOT NULL ORDER BY id LIMIT ?3",
    )?;
    let ids = pick
        .query_map((cursor, end, BATCH_SIZE), |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(pick);
    if let Some(last) = ids.last() {
        let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        {
            let mut tree = transaction
                .prepare("UPDATE frames SET accessibility_tree_json = NULL WHERE id = ?1")?;
            let mut properties = transaction.prepare("UPDATE elements SET properties = NULL WHERE frame_id = ?1 AND properties IS NOT NULL")?;
            for id in &ids {
                properties.execute([id])?;
                tree.execute([id])?;
            }
        }
        transaction.commit()?;
        if ids.len() as i64 == BATCH_SIZE {
            return Ok(Some(*last));
        }
    }
    Ok(Some(end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_and_restart_have_distinct_disk_thresholds() {
        assert!(!has_headroom(GIB - 1, true));
        assert!(has_headroom(GIB, true));
        assert!(!has_headroom(2 * GIB - 1, false));
        assert!(has_headroom(2 * GIB, false));
    }

    #[test]
    fn a_new_database_reclaims_pages_and_existing_history_is_left_in_place() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let paths = RuntimePaths::new(root, root, root).unwrap();
        prepare_new_recall_database(&paths).unwrap();
        let path = root.join(RECALL_DATABASE);
        let db = Connection::open(&path).unwrap();
        let mode: i64 = db
            .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, 2);
        db.execute_batch(
            "CREATE TABLE history(id INTEGER PRIMARY KEY); INSERT INTO history VALUES(7);",
        )
        .unwrap();
        prepare_new_recall_database(&paths).unwrap();
        assert_eq!(
            db.query_row("SELECT id FROM history", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            7
        );
    }

    #[test]
    fn compaction_reuses_pages_and_preserves_search_and_recent_context() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("db.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("PRAGMA auto_vacuum=INCREMENTAL;
            CREATE TABLE frames(id INTEGER PRIMARY KEY, timestamp TEXT, full_text TEXT, accessibility_tree_json TEXT);
            CREATE TABLE elements(id INTEGER PRIMARY KEY, frame_id INTEGER, text TEXT, properties TEXT);
            CREATE INDEX idx_elements_frame_id ON elements(frame_id);
            CREATE VIRTUAL TABLE frames_fts USING fts5(full_text, content='frames', content_rowid='id');
            INSERT INTO frames VALUES(1,'2020-01-01T00:00:00Z','kept words',zeroblob(3145728)),
                (2,strftime('%Y-%m-%dT%H:%M:%SZ','now'),'recent words','recent tree');
            INSERT INTO elements VALUES(1,1,'old text','props'),(2,2,'recent text','props');
            INSERT INTO frames_fts(frames_fts) VALUES('rebuild');").unwrap();
        let original_size = fs::metadata(&path).unwrap().len();
        assert_eq!(compact_slice(&path, 0).unwrap(), Some(2));
        assert_eq!(compact_slice(&path, 2).unwrap(), None);
        assert_eq!(
            db.query_row(
                "SELECT rowid FROM frames_fts WHERE frames_fts MATCH 'kept'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        let payloads: (bool, bool) = db
            .query_row(
                "SELECT frames.accessibility_tree_json IS NULL, elements.properties IS NULL
            FROM frames JOIN elements ON frames.id=elements.frame_id WHERE frames.id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(payloads, (true, true));
        let recent: String = db
            .query_row(
                "SELECT accessibility_tree_json FROM frames WHERE id=2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recent, "recent tree");
        assert!(fs::metadata(&path).unwrap().len() < original_size);
    }

    #[test]
    fn full_disk_quarantine_clears_only_on_an_intact_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("db.sqlite");
        let marker = directory.path().join(MARKER);
        fs::write(&path, "invalid database").unwrap();
        fs::write(&marker, r#"{"sqlite_code":13}"#).unwrap();
        assert!(release_io_quarantine(&marker).is_err());
        assert!(marker.exists());

        fs::remove_file(&path).unwrap();
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE history(value TEXT); INSERT INTO history VALUES('kept');")
            .unwrap();
        drop(db);
        fs::write(&marker, r#"{"sqlite_code":11}"#).unwrap();
        assert!(!release_io_quarantine(&marker).unwrap());
        fs::write(&marker, r#"{"sqlite_code":13}"#).unwrap();
        assert!(release_io_quarantine(&marker).unwrap());
        assert!(!marker.exists());
        assert!(directory
            .path()
            .join("db.sqlite.quarantine.last-resolved.json")
            .exists());
        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.query_row("SELECT value FROM history", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "kept"
        );
    }
}
