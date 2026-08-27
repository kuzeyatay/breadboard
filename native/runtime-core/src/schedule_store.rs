use crate::{JobStore, StoreError};
use breadboard_runtime_protocol::{
    validate_identifier, RuntimeRecallConfiguration, MAX_JSON_SAFE_INTEGER,
    MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES, MAX_TIMEOUT_MS,
};
use rusqlite::{params, OptionalExtension, Row, TransactionBehavior};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeScheduleKind {
    Fixed,
    Dynamic,
    Gateway,
    Service,
}

impl RuntimeScheduleKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Fixed => "fixed",
            Self::Dynamic => "dynamic",
            Self::Gateway => "gateway",
            Self::Service => "service",
        }
    }

    fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "fixed" => Ok(Self::Fixed),
            "dynamic" => Ok(Self::Dynamic),
            "gateway" => Ok(Self::Gateway),
            "service" => Ok(Self::Service),
            _ => Err(StoreError::CorruptState("runtime_schedules".into())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeScheduleDesiredState {
    Running,
    Stopped,
}

impl RuntimeScheduleDesiredState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Stopped => "stopped",
        }
    }

    fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "running" => Ok(Self::Running),
            "stopped" => Ok(Self::Stopped),
            _ => Err(StoreError::CorruptState("runtime_schedules".into())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeReconcileTrigger {
    Startup,
    Explicit,
}

impl RuntimeReconcileTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::Explicit => "explicit",
        }
    }

    fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "startup" => Ok(Self::Startup),
            "explicit" => Ok(Self::Explicit),
            _ => Err(StoreError::CorruptState("runtime_schedules".into())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScheduleRegistration {
    pub schedule_id: String,
    pub kind: RuntimeScheduleKind,
    pub initial_delay_ms: Option<u64>,
    pub interval_ms: Option<u64>,
}

impl RuntimeScheduleRegistration {
    pub fn fixed(schedule_id: impl Into<String>, initial_delay_ms: u64, interval_ms: u64) -> Self {
        Self {
            schedule_id: schedule_id.into(),
            kind: RuntimeScheduleKind::Fixed,
            initial_delay_ms: Some(initial_delay_ms),
            interval_ms: Some(interval_ms),
        }
    }

    pub fn dynamic(schedule_id: impl Into<String>) -> Self {
        Self {
            schedule_id: schedule_id.into(),
            kind: RuntimeScheduleKind::Dynamic,
            initial_delay_ms: None,
            interval_ms: None,
        }
    }

    pub fn gateway(schedule_id: impl Into<String>) -> Self {
        Self {
            schedule_id: schedule_id.into(),
            kind: RuntimeScheduleKind::Gateway,
            initial_delay_ms: None,
            interval_ms: None,
        }
    }

    pub fn service(schedule_id: impl Into<String>) -> Self {
        Self {
            schedule_id: schedule_id.into(),
            kind: RuntimeScheduleKind::Service,
            initial_delay_ms: None,
            interval_ms: None,
        }
    }

    fn validate(&self) -> Result<(), StoreError> {
        validate_identifier("scheduleId", &self.schedule_id)?;
        match self.kind {
            RuntimeScheduleKind::Fixed => {
                let initial = self.initial_delay_ms.ok_or_else(invalid_schedule)?;
                let interval = self.interval_ms.ok_or_else(invalid_schedule)?;
                validate_timing(initial, true)?;
                validate_timing(interval, false)?;
            }
            RuntimeScheduleKind::Dynamic
            | RuntimeScheduleKind::Gateway
            | RuntimeScheduleKind::Service => {
                if self.initial_delay_ms.is_some() || self.interval_ms.is_some() {
                    return Err(invalid_schedule());
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScheduleSnapshot {
    pub schedule_id: String,
    pub kind: RuntimeScheduleKind,
    pub desired_state: RuntimeScheduleDesiredState,
    pub decision_epoch: u64,
    pub owner_user_id: Option<u64>,
    pub initial_delay_ms: Option<u64>,
    pub interval_ms: Option<u64>,
    pub next_fire_at_ms: Option<u64>,
    pub pending_due_at_ms: Option<u64>,
    pub inflight_job_id: Option<String>,
    pub reconcile_trigger: Option<RuntimeReconcileTrigger>,
    pub reconcile_requested_state: Option<RuntimeScheduleDesiredState>,
    pub reconcile_owner_user_id: Option<u64>,
    pub reconcile_job_id: Option<String>,
    pub launch_configuration: Option<RuntimeRecallConfiguration>,
    pub configuration_fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScheduleOccurrence {
    pub schedule_id: String,
    pub due_at_ms: u64,
}

impl JobStore {
    pub fn register_runtime_schedule(
        &self,
        registration: &RuntimeScheduleRegistration,
        now_ms: u64,
    ) -> Result<RuntimeScheduleSnapshot, StoreError> {
        registration.validate()?;
        let now = sqlite_u64(now_ms, "schedule registration time")?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = match registration.kind {
            RuntimeScheduleKind::Fixed => {
                let initial = registration.initial_delay_ms.expect("validated fixed delay");
                let interval = registration.interval_ms.expect("validated fixed interval");
                let next = sqlite_u64(
                    now_ms
                        .checked_add(initial)
                        .ok_or_else(invalid_schedule)?,
                    "schedule next fire time",
                )?;
                transaction.execute(
                    "INSERT INTO runtime_schedules (
                         schedule_id, schedule_kind, desired_state, decision_epoch,
                         owner_user_id, initial_delay_ms, interval_ms, next_fire_at,
                         pending_due_at, inflight_job_id, reconcile_trigger,
                         reconcile_requested_state, reconcile_owner_user_id,
                         reconcile_job_id, updated_at
                     ) VALUES (?1,'fixed','running',0,NULL,?2,?3,?4,NULL,NULL,NULL,NULL,NULL,NULL,?5)
                     ON CONFLICT(schedule_id) DO UPDATE SET
                         initial_delay_ms=excluded.initial_delay_ms,
                         interval_ms=excluded.interval_ms,
                         desired_state='running', updated_at=excluded.updated_at
                     WHERE runtime_schedules.schedule_kind='fixed'",
                    params![
                        registration.schedule_id,
                        sqlite_nonnegative_u64(initial, "schedule initial delay")?,
                        sqlite_u64(interval, "schedule interval")?,
                        next,
                        now,
                    ],
                )?
            }
            RuntimeScheduleKind::Dynamic
            | RuntimeScheduleKind::Gateway
            | RuntimeScheduleKind::Service => transaction.execute(
                "INSERT INTO runtime_schedules (
                     schedule_id, schedule_kind, desired_state, decision_epoch,
                     owner_user_id, initial_delay_ms, interval_ms, next_fire_at,
                     pending_due_at, inflight_job_id, reconcile_trigger,
                     reconcile_requested_state, reconcile_owner_user_id,
                     reconcile_job_id, launch_configuration_json,
                     configuration_fingerprint, updated_at
                 ) VALUES (?1,?2,'stopped',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?3)
                 ON CONFLICT(schedule_id) DO UPDATE SET updated_at=excluded.updated_at
                 WHERE runtime_schedules.schedule_kind=excluded.schedule_kind",
                params![registration.schedule_id, registration.kind.as_str(), now],
            )?,
        };
        if changed != 1 {
            return Err(StoreError::CorruptState(registration.schedule_id.clone()));
        }
        let snapshot = query_schedule(&transaction, &registration.schedule_id)?
            .ok_or_else(|| StoreError::CorruptState(registration.schedule_id.clone()))?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn begin_runtime_schedule_reconciliation(
        &self,
        schedule_id: &str,
        trigger: RuntimeReconcileTrigger,
        requested_state: Option<RuntimeScheduleDesiredState>,
        owner_user_id: Option<u64>,
        now_ms: u64,
    ) -> Result<u64, StoreError> {
        validate_identifier("scheduleId", schedule_id)?;
        match trigger {
            RuntimeReconcileTrigger::Startup
                if requested_state.is_none() && owner_user_id.is_none() => {}
            RuntimeReconcileTrigger::Explicit
                if requested_state.is_some() && owner_user_id.is_some() => {}
            _ => return Err(invalid_schedule()),
        }
        let owner = owner_user_id
            .map(|value| sqlite_positive_u64(value, "schedule owner"))
            .transpose()?;
        let now = sqlite_u64(now_ms, "schedule reconcile time")?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (kind, epoch): (String, i64) = transaction
            .query_row(
                "SELECT schedule_kind, decision_epoch FROM runtime_schedules WHERE schedule_id=?1",
                params![schedule_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| StoreError::InvalidInput("unknown runtime schedule".into()))?;
        if matches!(kind.as_str(), "fixed" | "service")
            || epoch < 0
            || epoch as u64 >= MAX_JSON_SAFE_INTEGER
        {
            return Err(invalid_schedule());
        }
        let next_epoch = epoch + 1;
        let changed = transaction.execute(
            "UPDATE runtime_schedules
                SET decision_epoch=?2, reconcile_trigger=?3,
                    reconcile_requested_state=?4, reconcile_owner_user_id=?5,
                    reconcile_job_id=NULL, updated_at=?6
              WHERE schedule_id=?1 AND decision_epoch=?7",
            params![
                schedule_id,
                next_epoch,
                trigger.as_str(),
                requested_state.map(RuntimeScheduleDesiredState::as_str),
                owner,
                now,
                epoch,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(schedule_id.into()));
        }
        transaction.commit()?;
        Ok(next_epoch as u64)
    }

    /// Atomically applies one closed persistent-service decision. The typed
    /// Recall configuration and its digest live in the same SQLite commit as
    /// the monotonic epoch and owner, so a crash can never expose a new argv
    /// policy under an old intent (or vice versa).
    pub fn apply_runtime_service_intent(
        &self,
        service_id: &str,
        desired_state: RuntimeScheduleDesiredState,
        owner_user_id: u64,
        configuration: Option<&RuntimeRecallConfiguration>,
        now_ms: u64,
    ) -> Result<Option<RuntimeScheduleSnapshot>, StoreError> {
        validate_identifier("serviceId", service_id)?;
        let owner = sqlite_positive_u64(owner_user_id, "service intent owner")?;
        let (configuration_json, fingerprint) = match (desired_state, configuration) {
            (RuntimeScheduleDesiredState::Running, Some(configuration)) => {
                configuration.validate()?;
                let encoded = serde_json::to_vec(configuration).map_err(|_| {
                    StoreError::InvalidInput("invalid service configuration".into())
                })?;
                if encoded.len() > MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES {
                    return Err(invalid_schedule());
                }
                let digest = Sha256::digest(&encoded);
                let mut fingerprint = String::with_capacity(64);
                for byte in digest {
                    use std::fmt::Write as _;
                    write!(&mut fingerprint, "{byte:02x}").map_err(|_| invalid_schedule())?;
                }
                let json = String::from_utf8(encoded).map_err(|_| invalid_schedule())?;
                (Some(json), Some(fingerprint))
            }
            (RuntimeScheduleDesiredState::Stopped, None) => (None, None),
            _ => return Err(invalid_schedule()),
        };
        let now = sqlite_u64(now_ms, "service intent time")?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_schedule(&transaction, service_id)?
            .ok_or_else(|| StoreError::InvalidInput("unknown runtime service intent".into()))?;
        if current.kind != RuntimeScheduleKind::Service {
            return Err(invalid_schedule());
        }
        if current
            .owner_user_id
            .is_some_and(|existing| existing != owner_user_id)
        {
            transaction.commit()?;
            return Ok(None);
        }
        let unchanged = current.desired_state == desired_state
            && current.owner_user_id == Some(owner_user_id)
            && current.launch_configuration.as_ref() == configuration;
        if unchanged {
            transaction.commit()?;
            return Ok(Some(current));
        }
        if current.decision_epoch >= MAX_JSON_SAFE_INTEGER {
            return Err(invalid_schedule());
        }
        let next_epoch = current.decision_epoch + 1;
        let changed = transaction.execute(
            "UPDATE runtime_schedules
                SET desired_state=?3, decision_epoch=?2, owner_user_id=?4,
                    launch_configuration_json=?5, configuration_fingerprint=?6,
                    updated_at=?7
              WHERE schedule_id=?1 AND schedule_kind='service' AND decision_epoch=?8",
            params![
                service_id,
                sqlite_u64(next_epoch, "service decision epoch")?,
                desired_state.as_str(),
                owner,
                configuration_json,
                fingerprint,
                now,
                sqlite_nonnegative_u64(current.decision_epoch, "previous service decision epoch",)?,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(service_id.into()));
        }
        let snapshot = query_schedule(&transaction, service_id)?
            .ok_or_else(|| StoreError::CorruptState(service_id.into()))?;
        transaction.commit()?;
        Ok(Some(snapshot))
    }

    pub fn bind_runtime_schedule_reconciliation_job(
        &self,
        schedule_id: &str,
        decision_epoch: u64,
        job_id: &str,
        now_ms: u64,
    ) -> Result<(), StoreError> {
        validate_identifier("scheduleId", schedule_id)?;
        validate_identifier("jobId", job_id)?;
        let changed = self
            .connection
            .lock()
            .expect("job store mutex poisoned")
            .execute(
                "UPDATE runtime_schedules
                    SET reconcile_job_id=?3, updated_at=?4
                  WHERE schedule_id=?1 AND decision_epoch=?2
                    AND reconcile_trigger IS NOT NULL
                    AND (reconcile_job_id IS NULL OR reconcile_job_id=?3)",
                params![
                    schedule_id,
                    sqlite_u64(decision_epoch, "schedule decision epoch")?,
                    job_id,
                    sqlite_u64(now_ms, "schedule reconcile bind time")?,
                ],
            )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(schedule_id.into()));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn apply_runtime_schedule_reconciliation(
        &self,
        schedule_id: &str,
        decision_epoch: u64,
        desired_state: RuntimeScheduleDesiredState,
        owner_user_id: Option<u64>,
        initial_delay_ms: Option<u64>,
        interval_ms: Option<u64>,
        now_ms: u64,
    ) -> Result<bool, StoreError> {
        validate_identifier("scheduleId", schedule_id)?;
        let owner = owner_user_id
            .map(|value| sqlite_positive_u64(value, "schedule decision owner"))
            .transpose()?;
        let initial = initial_delay_ms
            .map(|value| {
                validate_timing(value, true)?;
                sqlite_nonnegative_u64(value, "schedule initial delay")
            })
            .transpose()?;
        let interval = interval_ms
            .map(|value| {
                validate_timing(value, false)?;
                sqlite_u64(value, "schedule interval")
            })
            .transpose()?;
        let now = sqlite_u64(now_ms, "schedule decision time")?;
        let next = match (desired_state, initial_delay_ms) {
            (RuntimeScheduleDesiredState::Running, Some(delay)) => Some(sqlite_u64(
                now_ms.checked_add(delay).ok_or_else(invalid_schedule)?,
                "schedule next fire time",
            )?),
            _ => None,
        };
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let kind: Option<String> = transaction
            .query_row(
                "SELECT schedule_kind FROM runtime_schedules
                  WHERE schedule_id=?1 AND decision_epoch=?2 AND reconcile_trigger IS NOT NULL",
                params![
                    schedule_id,
                    sqlite_u64(decision_epoch, "schedule decision epoch")?,
                ],
                |row| row.get(0),
            )
            .optional()?;
        let Some(kind) = kind else {
            transaction.commit()?;
            return Ok(false);
        };
        match kind.as_str() {
            "gateway" if initial.is_none() && interval.is_none() => {}
            "dynamic" if initial.is_some() && interval.is_some() => {}
            _ => return Err(invalid_schedule()),
        }
        let changed = transaction.execute(
            "UPDATE runtime_schedules
                SET desired_state=?3, owner_user_id=?4,
                    initial_delay_ms=?5, interval_ms=?6, next_fire_at=?7,
                    pending_due_at=CASE WHEN ?3='stopped' THEN NULL ELSE pending_due_at END,
                    reconcile_trigger=NULL, reconcile_requested_state=NULL,
                    reconcile_owner_user_id=NULL, reconcile_job_id=NULL, updated_at=?8
              WHERE schedule_id=?1 AND decision_epoch=?2",
            params![
                schedule_id,
                sqlite_u64(decision_epoch, "schedule decision epoch")?,
                desired_state.as_str(),
                owner,
                initial,
                interval,
                next,
                now,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(schedule_id.into()));
        }
        transaction.commit()?;
        Ok(true)
    }

    /// Clears only the still-current failed reconciliation attempt. The
    /// previously applied desired state remains authoritative; a later startup
    /// or explicit request mints a strictly newer decision epoch.
    pub fn fail_runtime_schedule_reconciliation(
        &self,
        schedule_id: &str,
        decision_epoch: u64,
        job_id: &str,
        now_ms: u64,
    ) -> Result<bool, StoreError> {
        validate_identifier("scheduleId", schedule_id)?;
        validate_identifier("jobId", job_id)?;
        let changed = self
            .connection
            .lock()
            .expect("job store mutex poisoned")
            .execute(
                "UPDATE runtime_schedules
                    SET reconcile_trigger=NULL, reconcile_requested_state=NULL,
                        reconcile_owner_user_id=NULL, reconcile_job_id=NULL,
                        updated_at=?4
                  WHERE schedule_id=?1 AND decision_epoch=?2
                    AND reconcile_job_id=?3",
                params![
                    schedule_id,
                    sqlite_u64(decision_epoch, "schedule decision epoch")?,
                    job_id,
                    sqlite_u64(now_ms, "schedule reconciliation failure time")?,
                ],
            )?;
        Ok(changed == 1)
    }

    pub fn claim_due_runtime_schedule(
        &self,
        now_ms: u64,
    ) -> Result<Option<RuntimeScheduleOccurrence>, StoreError> {
        let now = sqlite_u64(now_ms, "schedule clock")?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let due: Option<(String, Option<i64>, Option<i64>, i64)> = transaction
            .query_row(
                "SELECT schedule_id, pending_due_at, next_fire_at, interval_ms
                   FROM runtime_schedules
                  WHERE schedule_kind IN ('fixed','dynamic')
                    AND desired_state='running' AND inflight_job_id IS NULL
                    AND (pending_due_at IS NOT NULL OR next_fire_at <= ?1)
                  ORDER BY COALESCE(pending_due_at,next_fire_at), schedule_id LIMIT 1",
                params![now],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let Some((schedule_id, pending, next, interval)) = due else {
            transaction.commit()?;
            return Ok(None);
        };
        let due_at = pending
            .or(next)
            .ok_or_else(|| StoreError::CorruptState(schedule_id.clone()))?;
        if pending.is_none() {
            let next_fire = now
                .checked_add(interval)
                .ok_or_else(|| StoreError::CorruptState(schedule_id.clone()))?;
            let changed = transaction.execute(
                "UPDATE runtime_schedules
                    SET pending_due_at=?2, next_fire_at=?3, updated_at=?1
                  WHERE schedule_id=?4 AND pending_due_at IS NULL
                    AND inflight_job_id IS NULL AND next_fire_at<=?1",
                params![now, due_at, next_fire, schedule_id],
            )?;
            if changed != 1 {
                return Err(StoreError::CorruptState(schedule_id));
            }
        }
        transaction.commit()?;
        Ok(Some(RuntimeScheduleOccurrence {
            schedule_id,
            due_at_ms: u64::try_from(due_at)
                .map_err(|_| StoreError::CorruptState("runtime_schedules".into()))?,
        }))
    }

    pub fn bind_runtime_schedule_occurrence_job(
        &self,
        occurrence: &RuntimeScheduleOccurrence,
        job_id: &str,
        now_ms: u64,
    ) -> Result<(), StoreError> {
        validate_identifier("jobId", job_id)?;
        let changed = self
            .connection
            .lock()
            .expect("job store mutex poisoned")
            .execute(
                "UPDATE runtime_schedules
                    SET inflight_job_id=?3, updated_at=?4
                  WHERE schedule_id=?1 AND pending_due_at=?2
                    AND (inflight_job_id IS NULL OR inflight_job_id=?3)",
                params![
                    occurrence.schedule_id,
                    sqlite_u64(occurrence.due_at_ms, "schedule due time")?,
                    job_id,
                    sqlite_u64(now_ms, "schedule bind time")?,
                ],
            )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(occurrence.schedule_id.clone()));
        }
        Ok(())
    }

    pub fn complete_runtime_schedule_occurrence(
        &self,
        schedule_id: &str,
        job_id: &str,
        now_ms: u64,
    ) -> Result<bool, StoreError> {
        let changed = self
            .connection
            .lock()
            .expect("job store mutex poisoned")
            .execute(
                "UPDATE runtime_schedules
                    SET pending_due_at=NULL, inflight_job_id=NULL, updated_at=?3
                  WHERE schedule_id=?1 AND inflight_job_id=?2",
                params![
                    schedule_id,
                    job_id,
                    sqlite_u64(now_ms, "schedule completion time")?,
                ],
            )?;
        Ok(changed == 1)
    }

    pub fn runtime_schedule_snapshot(
        &self,
        schedule_id: &str,
    ) -> Result<Option<RuntimeScheduleSnapshot>, StoreError> {
        validate_identifier("scheduleId", schedule_id)?;
        query_schedule(
            &self.connection.lock().expect("job store mutex poisoned"),
            schedule_id,
        )
    }

    pub fn runtime_schedule_snapshots(&self) -> Result<Vec<RuntimeScheduleSnapshot>, StoreError> {
        let connection = self.connection.lock().expect("job store mutex poisoned");
        let mut statement = connection.prepare(&format!(
            "SELECT {SCHEDULE_COLUMNS} FROM runtime_schedules ORDER BY schedule_id"
        ))?;
        let snapshots = statement
            .query_map([], parse_schedule_row)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)?;
        Ok(snapshots)
    }
}

const SCHEDULE_COLUMNS: &str = "schedule_id, schedule_kind, desired_state, decision_epoch, owner_user_id, initial_delay_ms, interval_ms, next_fire_at, pending_due_at, inflight_job_id, reconcile_trigger, reconcile_requested_state, reconcile_owner_user_id, reconcile_job_id, launch_configuration_json, configuration_fingerprint";

fn query_schedule(
    connection: &rusqlite::Connection,
    schedule_id: &str,
) -> Result<Option<RuntimeScheduleSnapshot>, StoreError> {
    connection
        .query_row(
            &format!("SELECT {SCHEDULE_COLUMNS} FROM runtime_schedules WHERE schedule_id=?1"),
            params![schedule_id],
            parse_schedule_row,
        )
        .optional()
        .map_err(StoreError::from)
}

fn parse_schedule_row(row: &Row<'_>) -> rusqlite::Result<RuntimeScheduleSnapshot> {
    let kind: String = row.get(1)?;
    let desired: String = row.get(2)?;
    let trigger: Option<String> = row.get(10)?;
    let requested: Option<String> = row.get(11)?;
    let configuration_json: Option<String> = row.get(14)?;
    let convert = |value: Option<i64>| -> rusqlite::Result<Option<u64>> {
        value
            .map(|value| {
                u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, value))
            })
            .transpose()
    };
    let launch_configuration = configuration_json
        .map(|value| {
            let configuration: RuntimeRecallConfiguration =
                serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)?;
            configuration
                .validate()
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok::<RuntimeRecallConfiguration, rusqlite::Error>(configuration)
        })
        .transpose()?;
    let configuration_fingerprint: Option<String> = row.get(15)?;
    if configuration_fingerprint.as_ref().is_some_and(|value| {
        value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    }) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(RuntimeScheduleSnapshot {
        schedule_id: row.get(0)?,
        kind: RuntimeScheduleKind::parse(&kind).map_err(schedule_parse_error)?,
        desired_state: RuntimeScheduleDesiredState::parse(&desired)
            .map_err(schedule_parse_error)?,
        decision_epoch: u64::try_from(row.get::<_, i64>(3)?)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(3, -1))?,
        owner_user_id: convert(row.get(4)?)?,
        initial_delay_ms: convert(row.get(5)?)?,
        interval_ms: convert(row.get(6)?)?,
        next_fire_at_ms: convert(row.get(7)?)?,
        pending_due_at_ms: convert(row.get(8)?)?,
        inflight_job_id: row.get(9)?,
        reconcile_trigger: trigger
            .map(|value| RuntimeReconcileTrigger::parse(&value).map_err(schedule_parse_error))
            .transpose()?,
        reconcile_requested_state: requested
            .map(|value| RuntimeScheduleDesiredState::parse(&value).map_err(schedule_parse_error))
            .transpose()?,
        reconcile_owner_user_id: convert(row.get(12)?)?,
        reconcile_job_id: row.get(13)?,
        launch_configuration,
        configuration_fingerprint,
    })
}

fn schedule_parse_error(_error: StoreError) -> rusqlite::Error {
    rusqlite::Error::InvalidQuery
}

fn validate_timing(value: u64, allow_zero: bool) -> Result<(), StoreError> {
    if value > MAX_TIMEOUT_MS || (!allow_zero && value == 0) {
        return Err(invalid_schedule());
    }
    Ok(())
}

fn sqlite_u64(value: u64, field: &'static str) -> Result<i64, StoreError> {
    if value == 0 || value > MAX_JSON_SAFE_INTEGER {
        return Err(StoreError::InvalidInput(format!("{field} is out of range")));
    }
    i64::try_from(value).map_err(|_| StoreError::InvalidInput(format!("{field} is out of range")))
}

fn sqlite_positive_u64(value: u64, field: &'static str) -> Result<i64, StoreError> {
    sqlite_u64(value, field)
}

fn sqlite_nonnegative_u64(value: u64, field: &'static str) -> Result<i64, StoreError> {
    if value > MAX_JSON_SAFE_INTEGER {
        return Err(StoreError::InvalidInput(format!("{field} is out of range")));
    }
    i64::try_from(value).map_err(|_| StoreError::InvalidInput(format!("{field} is out of range")))
}

fn invalid_schedule() -> StoreError {
    StoreError::InvalidInput("runtime schedule is invalid".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, JobStore) {
        let directory = TempDir::new().unwrap();
        let store = JobStore::open_for_test(directory.path().join("runtime.sqlite")).unwrap();
        (directory, store)
    }

    #[test]
    fn decision_epochs_are_durable_monotonic_and_stale_results_are_ignored() {
        let (directory, store) = store();
        store
            .register_runtime_schedule(&RuntimeScheduleRegistration::gateway("telegram"), 100)
            .unwrap();
        let first = store
            .begin_runtime_schedule_reconciliation(
                "telegram",
                RuntimeReconcileTrigger::Startup,
                None,
                None,
                101,
            )
            .unwrap();
        drop(store);
        let store = JobStore::open_for_test(directory.path().join("runtime.sqlite")).unwrap();
        store
            .register_runtime_schedule(&RuntimeScheduleRegistration::gateway("telegram"), 101)
            .unwrap();
        let second = store
            .begin_runtime_schedule_reconciliation(
                "telegram",
                RuntimeReconcileTrigger::Explicit,
                Some(RuntimeScheduleDesiredState::Running),
                Some(7),
                102,
            )
            .unwrap();
        assert_eq!((first, second), (1, 2));
        assert!(!store
            .apply_runtime_schedule_reconciliation(
                "telegram",
                first,
                RuntimeScheduleDesiredState::Stopped,
                None,
                None,
                None,
                103,
            )
            .unwrap());
        assert!(store
            .apply_runtime_schedule_reconciliation(
                "telegram",
                second,
                RuntimeScheduleDesiredState::Running,
                Some(7),
                None,
                None,
                104,
            )
            .unwrap());
        let snapshot = store
            .runtime_schedule_snapshot("telegram")
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.decision_epoch, 2);
        assert_eq!(snapshot.owner_user_id, Some(7));
        assert_eq!(snapshot.desired_state, RuntimeScheduleDesiredState::Running);
    }

    #[test]
    fn missed_intervals_catch_up_once_and_advance_from_now() {
        let (_directory, store) = store();
        store
            .register_runtime_schedule(&RuntimeScheduleRegistration::fixed("reviews", 10, 30), 100)
            .unwrap();
        let occurrence = store.claim_due_runtime_schedule(1_000).unwrap().unwrap();
        assert_eq!(occurrence.due_at_ms, 110);
        let snapshot = store.runtime_schedule_snapshot("reviews").unwrap().unwrap();
        assert_eq!(snapshot.next_fire_at_ms, Some(1_030));
        assert_eq!(snapshot.pending_due_at_ms, Some(110));
        // A restart before submission sees the same pending occurrence, never
        // an unbounded replay for every missed interval.
        assert_eq!(
            store.claim_due_runtime_schedule(1_001).unwrap().unwrap(),
            occurrence
        );
    }

    #[test]
    fn service_intent_is_owner_bound_idempotent_and_restart_durable() {
        let (directory, store) = store();
        store
            .register_runtime_schedule(&RuntimeScheduleRegistration::service("recall"), 100)
            .unwrap();
        let first_configuration = RuntimeRecallConfiguration {
            capture_audio: true,
            excluded_windows: vec!["Private Window".into(), "Discord".into()],
        };
        let first = store
            .apply_runtime_service_intent(
                "recall",
                RuntimeScheduleDesiredState::Running,
                7,
                Some(&first_configuration),
                101,
            )
            .unwrap()
            .unwrap();
        assert_eq!(first.kind, RuntimeScheduleKind::Service);
        assert_eq!(first.decision_epoch, 1);
        assert_eq!(first.owner_user_id, Some(7));
        assert_eq!(
            first.launch_configuration,
            Some(first_configuration.clone())
        );
        assert_eq!(
            first.configuration_fingerprint.as_deref().unwrap().len(),
            64
        );

        let replay = store
            .apply_runtime_service_intent(
                "recall",
                RuntimeScheduleDesiredState::Running,
                7,
                Some(&first_configuration),
                102,
            )
            .unwrap()
            .unwrap();
        assert_eq!(replay.decision_epoch, first.decision_epoch);
        assert_eq!(
            replay.configuration_fingerprint,
            first.configuration_fingerprint
        );
        assert!(store
            .apply_runtime_service_intent(
                "recall",
                RuntimeScheduleDesiredState::Stopped,
                8,
                None,
                103,
            )
            .unwrap()
            .is_none());

        drop(store);
        let store = JobStore::open_for_test(directory.path().join("runtime.sqlite")).unwrap();
        let registered = store
            .register_runtime_schedule(&RuntimeScheduleRegistration::service("recall"), 104)
            .unwrap();
        assert_eq!(registered.decision_epoch, 1);
        assert_eq!(registered.owner_user_id, Some(7));
        assert_eq!(registered.launch_configuration, Some(first_configuration));

        let changed_configuration = RuntimeRecallConfiguration {
            capture_audio: false,
            excluded_windows: vec!["Private Window".into()],
        };
        let changed = store
            .apply_runtime_service_intent(
                "recall",
                RuntimeScheduleDesiredState::Running,
                7,
                Some(&changed_configuration),
                105,
            )
            .unwrap()
            .unwrap();
        assert_eq!(changed.decision_epoch, 2);
        assert_ne!(
            changed.configuration_fingerprint,
            registered.configuration_fingerprint
        );
        let stopped = store
            .apply_runtime_service_intent(
                "recall",
                RuntimeScheduleDesiredState::Stopped,
                7,
                None,
                106,
            )
            .unwrap()
            .unwrap();
        assert_eq!(stopped.decision_epoch, 3);
        assert_eq!(stopped.owner_user_id, Some(7));
        assert!(stopped.launch_configuration.is_none());
        assert!(stopped.configuration_fingerprint.is_none());
    }
}
