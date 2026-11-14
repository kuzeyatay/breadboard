//! Offline-only database replacement. The live runtime never VACUUMs at startup.
use crate::{PriorGenerationDrained, RuntimePaths};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

const DATABASES: [&str; 3] = [
    "runtime-v2/runtime-v2.sqlite3",
    "database/brain.db",
    "database/skills-catalog.db",
];
const RESERVE: u64 = 2 * 1024 * 1024 * 1024;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Serialize, Deserialize)]
struct Swap {
    version: u32,
    phase: String,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionReport {
    pub databases_compacted: usize,
    pub bytes_released: u64,
    pub deferred: Vec<String>,
}

fn sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut value = database.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}
fn reject_link(path: &Path) -> Result<()> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("redirected maintenance path".into());
            }
        }
        if meta.file_type().is_symlink() {
            return Err("redirected maintenance path".into());
        }
    }
    Ok(())
}
fn journal(database: &Path, phase: &str) -> Result<()> {
    let target = sidecar(database, ".storage-swap.json");
    let temporary = sidecar(database, ".storage-swap.tmp");
    reject_link(&target)?;
    reject_link(&temporary)?;
    let mut file = fs::File::create(&temporary)?;
    serde_json::to_writer(
        &mut file,
        &Swap {
            version: 1,
            phase: phase.into(),
        },
    )?;
    file.flush()?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, &target)?;
    Ok(())
}
fn remove_owned(path: &Path) -> Result<()> {
    reject_link(path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
fn verify(database: &Path) -> Result<()> {
    let db = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let check: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err("database integrity verification failed".into());
    }
    if db.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err("database foreign-key verification failed".into());
    }
    Ok(())
}
fn recover_one(database: &Path) -> Result<()> {
    let manifest = sidecar(database, ".storage-swap.json");
    let previous = sidecar(database, ".storage-previous");
    let compact = sidecar(database, ".storage-compact");
    for file in [database, &manifest, &previous, &compact] {
        reject_link(file)?;
    }
    if !manifest.exists() {
        return Ok(());
    }
    if fs::metadata(&manifest)?.len() > 1024 {
        return Err("invalid compaction journal".into());
    }
    let bytes = fs::read(&manifest)?;
    if bytes.len() > 1024 {
        return Err("invalid compaction journal".into());
    }
    let swap: Swap = serde_json::from_slice(&bytes)?;
    if swap.version != 1 || !matches!(swap.phase.as_str(), "copying" | "prepared" | "installed") {
        return Err("unknown compaction journal".into());
    }
    if swap.phase == "installed" {
        verify(database)?;
        remove_owned(&previous)?;
    } else if previous.exists() {
        verify(&previous)?;
        remove_owned(database)?;
        fs::rename(&previous, database)?;
    } else {
        verify(database)?;
    }
    remove_owned(&compact)?;
    remove_owned(&manifest)?;
    Ok(())
}

#[cfg(windows)]
fn available_bytes(directory: &Path) -> Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let path: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0;
    if unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error().into());
    }
    Ok(available)
}
#[cfg(not(windows))]
fn available_bytes(_directory: &Path) -> Result<u64> {
    Err("offline storage compaction requires the supported desktop platform".into())
}

fn compact_one(database: &Path, free_bytes: u64) -> Result<u64> {
    recover_one(database)?;
    let before = fs::metadata(database)?.len();
    let mut db = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    db.busy_timeout(std::time::Duration::ZERO)?;
    db.pragma_update(None, "foreign_keys", "ON")?;
    let pages: u64 = db.query_row("PRAGMA page_count", [], |r| r.get(0))?;
    let free: u64 = db.query_row("PRAGMA freelist_count", [], |r| r.get(0))?;
    let page_bytes: u64 = db.query_row("PRAGMA page_size", [], |r| r.get(0))?;
    let mode: u64 = db.query_row("PRAGMA auto_vacuum", [], |r| r.get(0))?;
    let has_pdf_store: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='storage_pdf_references')",
        [],
        |r| r.get(0),
    )?;
    if free < 256 && mode == 2 && !has_pdf_store {
        return Ok(0);
    }
    let required = (pages.saturating_sub(free) * page_bytes).saturating_mul(12) / 10 + RESERVE;
    if free_bytes < required {
        return Err(
            "insufficient free space for a verified compact copy plus the 2 GiB reserve".into(),
        );
    }
    let checkpoint: i64 = db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
    if checkpoint != 0 {
        return Err("database still has active readers or writers".into());
    }
    // Switching out of WAL also refuses an independently opened live reader.
    let journal_mode: String = db.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0))?;
    if journal_mode != "delete" {
        return Err("database is not quiescent".into());
    }
    db.execute_batch("PRAGMA synchronous=FULL; PRAGMA auto_vacuum=INCREMENTAL;")?;
    if has_pdf_store {
        deduplicate_pdf_revisions(&mut db, free_bytes)?;
    }
    let compact = sidecar(database, ".storage-compact");
    let previous = sidecar(database, ".storage-previous");
    if compact.exists() || previous.exists() {
        return Err("unrecognized maintenance file requires review".into());
    }
    journal(database, "copying")?;
    db.execute("VACUUM INTO ?1", [compact.to_string_lossy().as_ref()])?;
    verify(&compact)?;
    let target = Connection::open_with_flags(&compact, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    if target.query_row("PRAGMA auto_vacuum", [], |r| r.get::<_, i64>(0))? != 2 {
        return Err("incremental vacuum conversion failed".into());
    }
    // SQLite may renumber implicit ROWIDs. Refuse a replacement that would
    // change any row identity, including external-content search bindings.
    let tables: Vec<String> = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    for table in tables {
        let name = format!("\"{}\"", table.replace('"', "\"\""));
        let count = format!("SELECT count(*) FROM {name}");
        if db.query_row(&count, [], |r| r.get::<_, i64>(0))?
            != target.query_row(&count, [], |r| r.get::<_, i64>(0))?
        {
            return Err("compaction changed a table's row count".into());
        }
        let primary: Vec<String> = db
            .prepare(&format!("PRAGMA table_info({name})"))?
            .query_map([], |r| Ok((r.get::<_, i64>(5)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|(rank, _)| *rank > 0)
            .map(|(_, column)| format!("\"{}\"", column.replace('"', "\"\"")))
            .collect();
        let order = if db.prepare(&format!("SELECT rowid FROM {name}")).is_ok() {
            "rowid".to_owned()
        } else if !primary.is_empty() {
            primary.join(",")
        } else {
            return Err("table identity cannot be verified".into());
        };
        let contents = format!("SELECT * FROM {name} ORDER BY {order}");
        let mut left = db.prepare(&contents)?;
        let mut right = target.prepare(&contents)?;
        let columns = left.column_count();
        if right.column_count() != columns {
            return Err("compaction changed a table schema".into());
        }
        let mut a = left.query([])?;
        let mut b = right.query([])?;
        loop {
            match (a.next()?, b.next()?) {
                (None, None) => break,
                (Some(a), Some(b)) => {
                    for column in 0..columns {
                        if a.get_ref(column)? != b.get_ref(column)? {
                            return Err("compaction changed retained content".into());
                        }
                    }
                }
                _ => return Err("compaction changed retained rows".into()),
            }
        }
        let query = format!("SELECT rowid FROM {name} ORDER BY rowid");
        if let (Ok(mut left), Ok(mut right)) = (db.prepare(&query), target.prepare(&query)) {
            let mut a = left.query([])?;
            let mut b = right.query([])?;
            loop {
                match (a.next()?, b.next()?) {
                    (None, None) => break,
                    (Some(a), Some(b)) if a.get::<_, i64>(0)? == b.get::<_, i64>(0)? => {}
                    _ => return Err("compaction would change search or row identities".into()),
                }
            }
        }
    }
    drop(target);
    drop(db);
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&compact)?
        .sync_all()?;
    journal(database, "prepared")?;
    fs::rename(database, &previous)?;
    fs::rename(&compact, database)?;
    verify(database)?;
    journal(database, "installed")?;
    let after = fs::metadata(database)?.len();
    recover_one(database)?;
    Ok(before.saturating_sub(after))
}

/// Large BLOB replacement is deliberately offline. The source remains complete
/// until its content hash, shared object and reference commit in one transaction.
fn deduplicate_pdf_revisions(db: &mut Connection, free_bytes: u64) -> Result<()> {
    let mut after = 0i64;
    loop {
        let mut statement=db.prepare("SELECT id,pdf_data FROM pdf_document_edit_history WHERE id>?1 AND length(pdf_data)>0 ORDER BY id LIMIT 1")?;
        let mut rows = statement.query([after])?;
        let Some(row) = rows.next()? else {
            break;
        };
        let id: i64 = row.get(0)?;
        let bytes: Vec<u8> = row.get(1)?;
        after = id;
        drop(rows);
        drop(statement);
        if free_bytes < RESERVE.saturating_add((bytes.len() as u64).saturating_mul(3)) {
            continue;
        }
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing = tx
            .prepare("SELECT data FROM storage_pdf_objects WHERE sha256=?1")?
            .query_map([&hash], |r| r.get::<_, Vec<u8>>(0))?
            .next()
            .transpose()?;
        if existing.as_ref().is_some_and(|value| *value != bytes) {
            return Err("PDF object checksum mismatch".into());
        }
        tx.execute(
            "INSERT OR IGNORE INTO storage_pdf_objects(sha256,data,byte_length) VALUES(?1,?2,?3)",
            rusqlite::params![hash, bytes, bytes.len() as i64],
        )?;
        tx.execute(
            "INSERT INTO storage_pdf_references(revision_id,sha256) VALUES(?1,?2)",
            rusqlite::params![id, hash],
        )?;
        tx.execute(
            "UPDATE pdf_document_edit_history SET pdf_data=zeroblob(0) WHERE id=?1",
            [id],
        )?;
        tx.commit()?;
    }
    Ok(())
}

pub fn recover_storage_swaps(paths: &RuntimePaths, drained: &PriorGenerationDrained) -> Result<()> {
    if !drained.matches_scope(&paths.runtime_generation_scope()) {
        return Err("storage generation authority mismatch".into());
    }
    for relative in DATABASES {
        let file = paths.resolve_data(relative)?;
        let manifest = sidecar(file.absolute(), ".storage-swap.json");
        if manifest.exists() {
            let _directory = paths.prepare_data_directory(
                relative
                    .rsplit_once('/')
                    .ok_or("database parent missing")?
                    .0,
            )?;
            recover_one(file.absolute())?;
        }
    }
    Ok(())
}

pub fn compact_storage(
    paths: &RuntimePaths,
    drained: &PriorGenerationDrained,
) -> Result<CompactionReport> {
    recover_storage_swaps(paths, drained)?;
    let mut report = CompactionReport::default();
    for relative in DATABASES {
        let file = paths.resolve_data(relative)?;
        if !file.absolute().exists() {
            continue;
        }
        let _directory = paths.prepare_data_directory(
            relative
                .rsplit_once('/')
                .ok_or("database parent missing")?
                .0,
        )?;
        paths.pin_existing_data_file(&file)?;
        match compact_one(file.absolute(), available_bytes(paths.data_root())?) {
            Ok(bytes) => {
                report.databases_compacted += 1;
                report.bytes_released += bytes;
            }
            Err(error) => {
                recover_one(file.absolute())?;
                report.deferred.push(format!("{relative}: {error}"));
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_copy_preserves_rows_and_search_and_enables_incremental_reclamation() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("brain.db");
        let db = Connection::open(&file).unwrap();
        db.execute_batch("CREATE TABLE messages(id INTEGER PRIMARY KEY,content TEXT); CREATE VIRTUAL TABLE search USING fts5(content,content='messages',content_rowid='id');
            INSERT INTO messages VALUES(7,'retained message'),(9,'retained tool result'); INSERT INTO search(search) VALUES('rebuild');
            CREATE VIEW cold_reads AS SELECT not_registered_here(content) AS content FROM messages;
            CREATE TABLE scratch(id INTEGER PRIMARY KEY,data BLOB); INSERT INTO scratch VALUES(1,zeroblob(2097152)); DELETE FROM scratch;").unwrap();
        drop(db);
        assert!(compact_one(&file, u64::MAX).unwrap() > 1024 * 1024);
        let db = Connection::open(&file).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT rowid FROM search WHERE search MATCH 'tool'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            9
        );
        assert_eq!(
            db.query_row("PRAGMA auto_vacuum", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn interrupted_swap_restores_original_and_low_disk_preserves_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("brain.db");
        let db = Connection::open(&file).unwrap();
        db.execute_batch("CREATE TABLE kept(id INTEGER PRIMARY KEY); INSERT INTO kept VALUES(3)")
            .unwrap();
        drop(db);
        assert!(compact_one(&file, 1024).is_err());
        journal(&file, "prepared").unwrap();
        fs::rename(&file, sidecar(&file, ".storage-previous")).unwrap();
        fs::write(&file, b"interrupted replacement").unwrap();
        recover_one(&file).unwrap();
        verify(&file).unwrap();
        assert!(!sidecar(&file, ".storage-previous").exists());
    }
    #[test]
    fn large_pdf_revisions_keep_exact_bytes_and_independent_references() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE pdf_document_edit_history(id INTEGER PRIMARY KEY,pdf_data BLOB); CREATE TABLE storage_pdf_objects(sha256 TEXT PRIMARY KEY,data BLOB,byte_length INTEGER); CREATE TABLE storage_pdf_references(revision_id INTEGER PRIMARY KEY,sha256 TEXT);").unwrap();
        let bytes = b"%PDF exact retained revision".repeat(10000);
        for id in [1, 2] {
            db.execute(
                "INSERT INTO pdf_document_edit_history VALUES(?1,?2)",
                rusqlite::params![id, bytes],
            )
            .unwrap();
        }
        deduplicate_pdf_revisions(&mut db, u64::MAX).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM storage_pdf_objects", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM storage_pdf_references", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(db.query_row("SELECT o.data FROM storage_pdf_objects o JOIN storage_pdf_references r ON r.sha256=o.sha256 WHERE r.revision_id=2",[],|r|r.get::<_,Vec<u8>>(0)).unwrap(),bytes);
    }
    #[test]
    fn another_reader_prevents_offline_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("busy.db");
        let writer = Connection::open(&file).unwrap();
        writer.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE kept(id INTEGER PRIMARY KEY); INSERT INTO kept VALUES(1)").unwrap();
        let reader = Connection::open(&file).unwrap();
        reader.execute_batch("BEGIN; SELECT * FROM kept;").unwrap();
        writer.execute("INSERT INTO kept VALUES(2)", []).unwrap();
        assert!(compact_one(&file, u64::MAX).is_err());
        assert!(!sidecar(&file, ".storage-previous").exists());
        assert_eq!(
            writer
                .query_row("SELECT count(*) FROM kept", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}
