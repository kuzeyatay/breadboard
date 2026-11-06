//! Installation exclusion shares the job/service admission transaction. A queued
//! setup reserves its environment until terminal state and authoritative release.
use crate::store::StoreError;
use rusqlite::{params, Connection};
use serde_json::Value;

const SETUP_ACTIONS: &[(&str, &[&str])] = &[
    ("deep-tutor", &["install", "reinstall", "remove"]),
    ("deer-flow", &["install", "reinstall", "remove"]),
    ("legal", &["install", "reinstall", "remove"]),
    ("money-printer", &["install", "reinstall", "remove"]),
    ("openexecutive", &["install", "reinstall", "remove"]),
    ("shorts", &["install", "reinstall", "remove"]),
    ("stock-analyst", &["install", "reinstall", "remove"]),
    ("tradingagents", &["install", "reinstall", "remove"]),
    ("vibe-trading", &["install", "reinstall", "remove"]),
    ("bolt-slides", &["install-dependencies", "remove"]),
    ("career-ops", &["install", "browsers", "scaffold", "remove"]),
    ("hyperframes", &["install-cli", "remove"]),
    ("matraix", &["install-runtime", "remove"]),
    ("acestep", &["install", "remove"]),
    ("openmontage", &["install-dependencies", "install-remotion", "remove"]),
    ("openscience", &["install", "remove"]),
    ("openwork", &["prepare-server", "remove"]),
    ("resource2skill", &["install-runtime", "install-web", "install-blender", "remove"]),
    ("wardrobe", &["install", "remove"]),
];

fn target(job_type: &str, payload: &[u8]) -> Option<(String, bool)> {
    if job_type == "managed-setup" {
        let value: Value = serde_json::from_slice(payload).ok()?;
        let operation = value.get("operation")?.as_str()?;
        let action = value.get("action")?.as_str()?;
        return SETUP_ACTIONS.iter().any(|(id, actions)| *id == operation && actions.contains(&action))
            .then(|| (operation.to_owned(), true));
    }
    if job_type == "trading-agent-run" { return Some(("tradingagents".into(), false)); }
    if job_type == "music-producer-run" { return Some(("acestep".into(), false)); }
    SETUP_ACTIONS.iter().find(|(id, _)| job_type.starts_with(&format!("{id}-")))
        .map(|(id, _)| ((*id).to_owned(), false))
}

fn live_jobs(connection: &Connection, exclude: Option<&str>) -> Result<Vec<(String, Vec<u8>)>, StoreError> {
    let mut statement = connection.prepare(
        "WITH active_jobs AS (
           SELECT job_id FROM runtime_jobs
             WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling')
           UNION
           SELECT subject_id FROM runtime_admission_reservations
             WHERE subject_kind='job' AND lifecycle_state IN ('pending','resident')
         )
         SELECT j.job_type, i.canonical_request_payload FROM active_jobs a
         JOIN runtime_jobs j ON j.job_id=a.job_id
         JOIN runtime_job_inputs i ON i.job_id=a.job_id
         WHERE a.job_id != ?1")?;
    let rows = statement.query_map(params![exclude.unwrap_or("")], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub(crate) fn require_job_installation_access(
    connection: &Connection, job_type: &str, payload: &[u8],
) -> Result<(), StoreError> {
    require_job_installation_access_except(connection, job_type, payload, None)
}

pub(crate) fn require_job_installation_access_except(
    connection: &Connection, job_type: &str, payload: &[u8], exclude: Option<&str>,
) -> Result<(), StoreError> {
    let Some((operation, maintenance)) = target(job_type, payload) else { return Ok(()); };
    for (other_type, other_payload) in live_jobs(connection, exclude)? {
        if let Some((other_target, other_maintenance)) = target(&other_type, &other_payload) {
            if other_target == operation && (maintenance || other_maintenance) {
                return Err(StoreError::InstallationBusy(operation));
            }
        }
    }
    if maintenance {
        let active: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM runtime_services WHERE service_id=?1
                AND lifecycle_state IN ('starting','ready','stopping'))
             OR EXISTS(SELECT 1 FROM runtime_service_leases WHERE service_id=?1
                AND lifecycle_state IN ('pending','active'))
             OR EXISTS(SELECT 1 FROM runtime_admission_reservations WHERE subject_kind='service'
                AND subject_id=?1 AND lifecycle_state IN ('pending','resident'))",
            params![operation], |row| row.get(0))?;
        if active { return Err(StoreError::InstallationBusy(operation)); }
    }
    Ok(())
}

pub(crate) fn require_service_installation_access(
    connection: &Connection, service_id: &str,
) -> Result<(), StoreError> {
    if !SETUP_ACTIONS.iter().any(|(id, _)| *id == service_id) { return Ok(()); }
    for (job_type, payload) in live_jobs(connection, None)? {
        if target(&job_type, &payload) == Some((service_id.to_owned(), true)) {
            return Err(StoreError::InstallationBusy(service_id.to_owned()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE runtime_jobs(job_id TEXT, job_type TEXT, state TEXT);
            CREATE TABLE runtime_job_inputs(job_id TEXT, canonical_request_payload BLOB);
            CREATE TABLE runtime_services(service_id TEXT, lifecycle_state TEXT);
            CREATE TABLE runtime_service_leases(service_id TEXT, lifecycle_state TEXT);
            CREATE TABLE runtime_admission_reservations(subject_kind TEXT, subject_id TEXT, lifecycle_state TEXT);").unwrap();
        connection
    }

    fn payload(operation: &str) -> Vec<u8> {
        let action = SETUP_ACTIONS.iter().find(|(id, _)| *id == operation).unwrap().1[0];
        serde_json::to_vec(&serde_json::json!({"protocolVersion":1,"operation":operation,"action":action})).unwrap()
    }

    fn insert_job(connection: &Connection, job_type: &str, state: &str, payload: &[u8]) {
        connection.execute("INSERT INTO runtime_jobs VALUES ('job_1',?1,?2)", params![job_type,state]).unwrap();
        connection.execute("INSERT INTO runtime_job_inputs VALUES ('job_1',?1)", params![payload]).unwrap();
    }

    #[test]
    fn setup_and_work_exclude_each_other_in_both_submission_orders() {
        for (operation, _) in SETUP_ACTIONS {
            let mut connection = database();
            let transaction = connection.transaction().unwrap();
            let run_type = match *operation {
                "tradingagents" => "trading-agent-run".into(),
                "acestep" => "music-producer-run".into(),
                _ => format!("{operation}-run"),
            };
            require_job_installation_access(&transaction, "managed-setup", &payload(operation)).unwrap();
            insert_job(&transaction, "managed-setup", "queued", &payload(operation));
            assert!(matches!(require_job_installation_access(&transaction, &run_type, b"{}"), Err(StoreError::InstallationBusy(_))));
            assert!(require_job_installation_access(&transaction, "managed-setup", &payload(operation)).is_err());
            assert!(require_service_installation_access(&transaction, operation).is_err());
            require_job_installation_access(&transaction, "learn", b"{}").unwrap();
            transaction.commit().unwrap();

            let connection = database();
            insert_job(&connection, &run_type, "admitted", b"{}");
            assert!(require_job_installation_access(&connection, "managed-setup", &payload(operation)).is_err());
            require_job_installation_access(&connection, &run_type, b"{}").unwrap();
        }
    }

    #[test]
    fn every_manager_setup_action_reserves_its_own_operation() {
        assert_eq!(SETUP_ACTIONS.len(), 19);
        for (operation, actions) in SETUP_ACTIONS {
            for action in *actions {
                let request = serde_json::to_vec(&serde_json::json!({"protocolVersion":1,"operation":operation,"action":action})).unwrap();
                assert_eq!(target("managed-setup", &request), Some(((*operation).into(), true)));
            }
        }
        assert!(target("managed-setup", br#"{"operation":"openwork","action":"remove-anything"}"#).is_none());
    }

    #[test]
    fn terminal_jobs_release_exclusion_only_after_process_residency_is_released() {
        let connection = database();
        insert_job(&connection, "managed-setup", "failed", &payload("deer-flow"));
        connection.execute("INSERT INTO runtime_admission_reservations VALUES ('job','job_1','resident')", []).unwrap();
        assert!(require_service_installation_access(&connection, "deer-flow").is_err());
        connection.execute("DELETE FROM runtime_admission_reservations", []).unwrap();
        require_service_installation_access(&connection, "deer-flow").unwrap();
    }

    #[test]
    fn setup_requires_no_live_service_process_or_lease() {
        for state in ["starting", "ready", "stopping"] {
            let connection = database();
            connection.execute("INSERT INTO runtime_services VALUES ('money-printer',?1)", params![state]).unwrap();
            assert!(require_job_installation_access(&connection, "managed-setup", &payload("money-printer")).is_err());
        }
        for state in ["pending", "active"] {
            let connection = database();
            connection.execute("INSERT INTO runtime_service_leases VALUES ('money-printer',?1)", params![state]).unwrap();
            assert!(require_job_installation_access(&connection, "managed-setup", &payload("money-printer")).is_err());
        }
        let connection = database();
        connection.execute("INSERT INTO runtime_services VALUES ('money-printer','available_but_stopped')", []).unwrap();
        require_job_installation_access(&connection, "managed-setup", &payload("money-printer")).unwrap();
    }
}
