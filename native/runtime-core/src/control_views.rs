use crate::store::{JobEventRecord, JobRecord, StoreError};
use breadboard_runtime_protocol::{
    JobState, ResourceClass, RuntimeJobEventPayload, RuntimeJobEventRecord, RuntimeJobEventType,
    RuntimeJobEventsResponse, RuntimeJobResponse, RuntimeJobStatus, RuntimePublicArtifactKind,
    RuntimePublicFailureCode, RuntimePublicStage, RuntimeResourceExhaustion, WorkerEvent,
    MAX_JOB_EVENT_REPLAY_RECORDS, MAX_PROTOCOL_LINE_BYTES, RUNTIME_CONTROL_PROTOCOL_VERSION,
    SANITIZED_RUNTIME_FAILURE_MESSAGE,
};

const EVENT_REPLAY_ENVELOPE_RESERVE_BYTES: usize = 4 * 1024;

/// Converts private worker/durable stage tokens into the complete public stage
/// vocabulary. Matching is deliberately exact: an unknown value (including a
/// path, credential-shaped string, or provider detail) is never inspected or
/// echoed and instead becomes the fixed `working` fallback.
fn public_stage(internal_stage: Option<&str>) -> Option<RuntimePublicStage> {
    internal_stage.map(|stage| match stage {
        "prepare" | "preparing" => RuntimePublicStage::Preparing,
        "work" | "working" => RuntimePublicStage::Working,
        "generate" | "generating" => RuntimePublicStage::Generating,
        "provider-call" | "waiting-external" => RuntimePublicStage::WaitingExternal,
        "process" | "processing" => RuntimePublicStage::Processing,
        "checkpoint" | "checkpointing" | "persist" | "persisting" => RuntimePublicStage::Persisting,
        "finalize" | "finalizing" => RuntimePublicStage::Finalizing,
        "cancel" | "cancelling" => RuntimePublicStage::Cancelling,
        _ => RuntimePublicStage::Working,
    })
}

fn public_artifact_kind(internal_kind: &str) -> RuntimePublicArtifactKind {
    match internal_kind {
        "checkpoint" => RuntimePublicArtifactKind::Checkpoint,
        "artifact" => RuntimePublicArtifactKind::Artifact,
        "document" => RuntimePublicArtifactKind::Document,
        "image" => RuntimePublicArtifactKind::Image,
        "audio" => RuntimePublicArtifactKind::Audio,
        "video" => RuntimePublicArtifactKind::Video,
        "model" => RuntimePublicArtifactKind::Model,
        "report" => RuntimePublicArtifactKind::Report,
        "archive" => RuntimePublicArtifactKind::Archive,
        "page" => RuntimePublicArtifactKind::Page,
        _ => RuntimePublicArtifactKind::Artifact,
    }
}

fn public_failure_code(record: &JobRecord) -> Option<RuntimePublicFailureCode> {
    record.failure_code.as_ref().map(|code| match record.state {
        JobState::ResourceExhausted => RuntimePublicFailureCode::ResourceExhausted,
        JobState::Interrupted => RuntimePublicFailureCode::Interrupted,
        JobState::Uncertain => RuntimePublicFailureCode::Uncertain,
        // The durable dependency verdict is closed and runtime-owned and names
        // no service, so it can cross the boundary as its own public class and
        // let the dashboard point the user at the agent's service setup rather
        // than at a worker that never existed.
        JobState::Failed if code.as_str() == "SERVICE_DEPENDENCY_UNAVAILABLE" => {
            RuntimePublicFailureCode::ServiceDependencyUnavailable
        }
        _ => RuntimePublicFailureCode::RuntimeJobFailed,
    })
}

fn public_resource_exhaustion(
    record: &JobRecord,
) -> Result<Option<RuntimeResourceExhaustion>, StoreError> {
    match (
        record.resource_exhaustion_resource.as_deref(),
        record.resource_exhaustion_required_headroom_mb,
        record.resource_exhaustion_available_headroom_mb,
    ) {
        (None, None, None) => Ok(None),
        (Some(_), Some(required_headroom_mb), Some(available_headroom_mb))
            if record.state == JobState::ResourceExhausted =>
        {
            let evidence = RuntimeResourceExhaustion {
                resource: "windows_commit".into(),
                required_headroom_mb,
                available_headroom_mb,
                retryable: false,
            };
            evidence
                .validate()
                .map_err(|_| StoreError::CorruptState(record.job_id.clone()))?;
            Ok(Some(evidence))
        }
        _ => Err(StoreError::CorruptState(record.job_id.clone())),
    }
}

/// Projects the durable authority row into the deliberately narrower private
/// control-plane schema. This is the only projection used by the host, so
/// filesystem paths, request payloads, owner principals, and idempotency
/// material cannot be serialized accidentally through `JobRecord`.
pub fn runtime_job_response(record: &JobRecord) -> Result<RuntimeJobResponse, StoreError> {
    let status = RuntimeJobStatus {
        job_id: record.job_id.clone(),
        job_type: record.job_type.clone(),
        worker_kind: record.worker_kind.clone(),
        resource_class: parse_resource_class(record)?,
        state: record.state,
        stage: public_stage(record.stage.as_deref()),
        attempt: record.attempt,
        worker_instance_id: record.worker_instance_id.clone(),
        garden_id: record.garden_id.clone(),
        conversation_id: record.conversation_id.clone(),
        created_at: record.created_at,
        started_at: record.started_at,
        updated_at: record.updated_at,
        finished_at: record.finished_at,
        last_heartbeat_at: record.last_heartbeat_at,
        last_worker_sequence: record.last_worker_sequence,
        progress_current: record.progress_current,
        progress_total: record.progress_total,
        failure_code: public_failure_code(record),
        failure_message: record
            .failure_message
            .as_ref()
            .map(|_| SANITIZED_RUNTIME_FAILURE_MESSAGE.to_string()),
        resource_exhaustion: public_resource_exhaustion(record)?,
        cancellation_requested: record.cancellation_requested,
    };
    status.validate()?;
    let response = RuntimeJobResponse::RuntimeJob {
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        job: status,
    };
    response.validate()?;
    Ok(response)
}

/// Builds one byte-bounded replay page from a `limit + 1` store query. The
/// extra record proves whether another page exists. Raw durable payloads are
/// never copied onto the control wire; each record is projected into the fixed,
/// path-free `RuntimeJobEventPayload` schema first. The explicit stream seal
/// must come from the same store snapshot as the job and source events.
pub fn runtime_job_events_response(
    record: &JobRecord,
    public_event_stream_sealed: bool,
    after: u64,
    requested_limit: usize,
    events: &[JobEventRecord],
) -> Result<RuntimeJobEventsResponse, StoreError> {
    if public_event_stream_sealed && !record.state.is_terminal() {
        return Err(StoreError::CorruptState(record.job_id.clone()));
    }
    build_runtime_job_events_response(
        &record.job_id,
        public_event_stream_sealed,
        after,
        requested_limit,
        events,
    )
}

fn build_runtime_job_events_response(
    job_id: &str,
    public_event_stream_sealed: bool,
    after: u64,
    requested_limit: usize,
    events: &[JobEventRecord],
) -> Result<RuntimeJobEventsResponse, StoreError> {
    if requested_limit == 0 || requested_limit > MAX_JOB_EVENT_REPLAY_RECORDS {
        return Err(StoreError::InvalidInput(
            "runtime event replay limit is outside the protocol bound".into(),
        ));
    }
    let maximum_source_records = requested_limit
        .checked_add(1)
        .ok_or_else(|| StoreError::InvalidInput("runtime event replay limit overflowed".into()))?;
    if events.len() > maximum_source_records {
        return Err(StoreError::InvalidInput(
            "runtime event replay source was not queried with limit plus one".into(),
        ));
    }

    let event_byte_budget = MAX_PROTOCOL_LINE_BYTES
        .checked_sub(EVENT_REPLAY_ENVELOPE_RESERVE_BYTES)
        .ok_or_else(|| {
            StoreError::InvalidInput("runtime event envelope reserve is invalid".into())
        })?;
    let mut projected = Vec::with_capacity(events.len().min(requested_limit));
    let mut projected_bytes = 0_usize;
    for event in events.iter().take(requested_limit) {
        let item = project_event(event)?;
        let item_bytes = serde_json::to_vec(&item)
            .map_err(|error| StoreError::InvalidInput(error.to_string()))?
            .len();
        let candidate_bytes = projected_bytes
            .checked_add(item_bytes)
            .and_then(|value| value.checked_add(usize::from(!projected.is_empty())))
            .ok_or_else(|| StoreError::InvalidInput("runtime event page size overflowed".into()))?;
        if candidate_bytes > event_byte_budget {
            break;
        }
        projected.push(item);
        projected_bytes = candidate_bytes;
    }
    if projected.is_empty() && !events.is_empty() {
        return Err(StoreError::InvalidInput(
            "one sanitized runtime event cannot fit the bounded response".into(),
        ));
    }

    let has_more = projected.len() < events.len();
    let next_after = projected.last().map_or(after, |event| event.sequence);
    let response = RuntimeJobEventsResponse::RuntimeJobEvents {
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        job_id: job_id.to_string(),
        after,
        next_after,
        terminal: public_event_stream_sealed,
        has_more,
        events: projected,
    };
    response.validate()?;
    let encoded = serde_json::to_vec(&response)
        .map_err(|error| StoreError::InvalidInput(error.to_string()))?;
    if encoded.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(StoreError::InvalidInput(
            "runtime event replay exceeded its response envelope".into(),
        ));
    }
    Ok(response)
}

fn project_event(event: &JobEventRecord) -> Result<RuntimeJobEventRecord, StoreError> {
    let sequence = u64::try_from(event.sequence)
        .map_err(|_| StoreError::CorruptState(event.job_id.clone()))?;
    let (event_type, payload) = if event.worker_sequence.is_some() {
        project_worker_event(event)?
    } else {
        project_runtime_event(event)?
    };
    let item = RuntimeJobEventRecord {
        sequence,
        job_id: event.job_id.clone(),
        attempt: event.attempt,
        worker_instance_id: event.worker_instance_id.clone(),
        worker_sequence: event.worker_sequence,
        event_type,
        payload,
        created_at: event.created_at,
    };
    item.validate()?;
    Ok(item)
}

fn project_worker_event(
    record: &JobEventRecord,
) -> Result<(RuntimeJobEventType, RuntimeJobEventPayload), StoreError> {
    let event: WorkerEvent = serde_json::from_value(record.payload.clone())
        .map_err(|_| StoreError::CorruptState(record.job_id.clone()))?;
    event
        .validate()
        .map_err(|_| StoreError::CorruptState(record.job_id.clone()))?;
    let identity = event.identity();
    if identity.job_id.as_str() != record.job_id.as_str()
        || identity.attempt != record.attempt
        || record.worker_instance_id.as_deref() != Some(identity.worker_instance_id.as_str())
        || record.worker_sequence != Some(event.sequence())
    {
        return Err(StoreError::CorruptState(record.job_id.clone()));
    }

    let (internal_type, event_type, payload) = match event {
        WorkerEvent::Ready { .. } if record.event_type == "ready-after-cancellation" => (
            "ready-after-cancellation",
            RuntimeJobEventType::WorkerReady,
            RuntimeJobEventPayload {
                state: Some(JobState::Cancelling),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Ready { .. } => (
            "ready",
            RuntimeJobEventType::WorkerReady,
            RuntimeJobEventPayload {
                state: Some(JobState::Running),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Heartbeat { stage, .. } => (
            "heartbeat",
            RuntimeJobEventType::WorkerHeartbeat,
            RuntimeJobEventPayload {
                stage: public_stage(Some(stage.as_str())),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Progress {
            stage,
            current,
            total,
            ..
        } => (
            "progress",
            RuntimeJobEventType::WorkerProgress,
            RuntimeJobEventPayload {
                stage: public_stage(Some(stage.as_str())),
                progress_current: Some(current),
                progress_total: Some(total),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Checkpoint { kind, .. } => (
            "checkpoint",
            RuntimeJobEventType::WorkerCheckpoint,
            RuntimeJobEventPayload {
                artifact_kind: Some(public_artifact_kind(&kind)),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Artifact { kind, .. } => (
            "artifact",
            RuntimeJobEventType::WorkerArtifact,
            RuntimeJobEventPayload {
                artifact_kind: Some(public_artifact_kind(&kind)),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Complete { .. } => (
            "complete",
            RuntimeJobEventType::WorkerComplete,
            RuntimeJobEventPayload::default(),
        ),
        WorkerEvent::Failed { .. } if record.event_type == "failed-after-cancellation" => (
            "failed-after-cancellation",
            RuntimeJobEventType::WorkerFailed,
            RuntimeJobEventPayload {
                state: Some(JobState::Cancelling),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::Failed { .. } => (
            "failed",
            RuntimeJobEventType::WorkerFailed,
            RuntimeJobEventPayload {
                state: Some(JobState::Failed),
                failure_code: Some(RuntimePublicFailureCode::WorkerFailed),
                failure_message: Some(SANITIZED_RUNTIME_FAILURE_MESSAGE.to_string()),
                ..RuntimeJobEventPayload::default()
            },
        ),
        WorkerEvent::CancellationAcknowledged { .. } => (
            "cancellation-acknowledged",
            RuntimeJobEventType::WorkerCancellationAcknowledged,
            RuntimeJobEventPayload {
                state: Some(JobState::Cancelling),
                ..RuntimeJobEventPayload::default()
            },
        ),
    };
    if record.event_type != internal_type {
        return Err(StoreError::CorruptState(record.job_id.clone()));
    }
    Ok((event_type, payload))
}

fn project_runtime_event(
    event: &JobEventRecord,
) -> Result<(RuntimeJobEventType, RuntimeJobEventPayload), StoreError> {
    let (event_type, state) = match event.event_type.as_str() {
        "queued" => (RuntimeJobEventType::Queued, Some(JobState::Queued)),
        "admitted" => (RuntimeJobEventType::Admitted, Some(JobState::Admitted)),
        "worker-assigned" => (
            RuntimeJobEventType::WorkerAssigned,
            Some(JobState::Starting),
        ),
        "reservation-settled" => (RuntimeJobEventType::ReservationSettled, None),
        "reservation-released" => (RuntimeJobEventType::ReservationReleased, None),
        "cancellation-requested" => (
            RuntimeJobEventType::CancellationRequested,
            Some(JobState::Cancelling),
        ),
        "completion-confirmed" => (
            RuntimeJobEventType::CompletionConfirmed,
            Some(JobState::Succeeded),
        ),
        "starting" => (RuntimeJobEventType::JobStarting, Some(JobState::Starting)),
        "running" => (RuntimeJobEventType::JobRunning, Some(JobState::Running)),
        "checkpointing" => (
            RuntimeJobEventType::JobCheckpointing,
            Some(JobState::Checkpointing),
        ),
        "cancelling" => (
            RuntimeJobEventType::JobCancelling,
            Some(JobState::Cancelling),
        ),
        "cancelled" => (RuntimeJobEventType::JobCancelled, Some(JobState::Cancelled)),
        "succeeded" => (RuntimeJobEventType::JobSucceeded, Some(JobState::Succeeded)),
        "failed" => (RuntimeJobEventType::JobFailed, Some(JobState::Failed)),
        "resource_exhausted" => (
            RuntimeJobEventType::JobResourceExhausted,
            Some(JobState::ResourceExhausted),
        ),
        "interrupted" => (
            RuntimeJobEventType::JobInterrupted,
            Some(JobState::Interrupted),
        ),
        "uncertain" => (RuntimeJobEventType::JobUncertain, Some(JobState::Uncertain)),
        _ => return Err(StoreError::CorruptState(event.job_id.clone())),
    };
    let resource_exhaustion = if event_type == RuntimeJobEventType::JobResourceExhausted {
        public_resource_exhaustion_event(event)?
    } else {
        None
    };
    Ok((
        event_type,
        RuntimeJobEventPayload {
            state,
            resource_exhaustion,
            ..RuntimeJobEventPayload::default()
        },
    ))
}

fn public_resource_exhaustion_event(
    event: &JobEventRecord,
) -> Result<Option<RuntimeResourceExhaustion>, StoreError> {
    let Some(denial) = event.payload.get("admissionDenial") else {
        return Ok(None);
    };
    let resource = denial.get("resource").and_then(serde_json::Value::as_str);
    let required_headroom_mb = denial
        .get("requiredHeadroomMb")
        .and_then(serde_json::Value::as_u64);
    let available_headroom_mb = denial
        .get("availableHeadroomMb")
        .and_then(serde_json::Value::as_u64);
    let retryable = denial.get("retryable").and_then(serde_json::Value::as_bool);
    if !resource.is_some_and(|value| {
        matches!(
            value,
            "windows_commit_critical"
                | "heavyweight_concurrency"
                | "windows_commit"
                | "worker_concurrency"
        )
    }) || retryable != Some(false)
    {
        return Err(StoreError::CorruptState(event.job_id.clone()));
    }
    let evidence = RuntimeResourceExhaustion {
        resource: "windows_commit".into(),
        required_headroom_mb: required_headroom_mb
            .ok_or_else(|| StoreError::CorruptState(event.job_id.clone()))?,
        available_headroom_mb: available_headroom_mb
            .ok_or_else(|| StoreError::CorruptState(event.job_id.clone()))?,
        retryable: false,
    };
    evidence
        .validate()
        .map_err(|_| StoreError::CorruptState(event.job_id.clone()))?;
    Ok(Some(evidence))
}

fn parse_resource_class(record: &JobRecord) -> Result<ResourceClass, StoreError> {
    match record.resource_class.as_str() {
        "core" => Ok(ResourceClass::Core),
        "large-generation" => Ok(ResourceClass::LargeGeneration),
        "document-processing" => Ok(ResourceClass::DocumentProcessing),
        "document-model" => Ok(ResourceClass::DocumentModel),
        "media-processing" => Ok(ResourceClass::MediaProcessing),
        "browser-automation" => Ok(ResourceClass::BrowserAutomation),
        "local-model" => Ok(ResourceClass::LocalModel),
        "docker-stack" => Ok(ResourceClass::DockerStack),
        _ => Err(StoreError::CorruptState(record.job_id.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use breadboard_runtime_protocol::WorkerIdentity;
    use serde_json::json;

    #[test]
    fn public_stage_projection_is_closed_and_defaults_unknown_values_to_working() {
        for (internal, expected) in [
            ("prepare", RuntimePublicStage::Preparing),
            ("working", RuntimePublicStage::Working),
            ("generate", RuntimePublicStage::Generating),
            ("provider-call", RuntimePublicStage::WaitingExternal),
            ("processing", RuntimePublicStage::Processing),
            ("checkpoint", RuntimePublicStage::Persisting),
            ("finalize", RuntimePublicStage::Finalizing),
            ("cancelling", RuntimePublicStage::Cancelling),
        ] {
            assert_eq!(public_stage(Some(internal)), Some(expected));
        }
        for private_stage in [
            r"C:\private\runtime\job.json",
            "/srv/runtime/jobs/job_1/workspace",
            "provider-secret=do-not-publish",
            "unregistered-worker-detail",
        ] {
            assert_eq!(
                public_stage(Some(private_stage)),
                Some(RuntimePublicStage::Working)
            );
        }
        assert_eq!(public_stage(None), None);
    }

    #[test]
    fn heartbeat_and_progress_projection_never_echo_private_stage_text() {
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        let cases = [
            (
                "heartbeat",
                RuntimeJobEventType::WorkerHeartbeat,
                WorkerEvent::Heartbeat {
                    identity: identity.clone(),
                    sequence: 1,
                    stage: r"C:\private\runtime\job.json".into(),
                },
            ),
            (
                "progress",
                RuntimeJobEventType::WorkerProgress,
                WorkerEvent::Progress {
                    identity: identity.clone(),
                    sequence: 2,
                    stage: "provider-secret=do-not-publish".into(),
                    current: 1,
                    total: 2,
                },
            ),
        ];

        for (internal_type, public_type, raw) in cases {
            let worker_sequence = raw.sequence();
            let projected = project_event(&JobEventRecord {
                sequence: i64::try_from(worker_sequence).unwrap(),
                job_id: identity.job_id.clone(),
                attempt: identity.attempt,
                worker_instance_id: Some(identity.worker_instance_id.clone()),
                worker_sequence: Some(worker_sequence),
                event_type: internal_type.into(),
                payload: serde_json::to_value(raw).unwrap(),
                created_at: 100,
            })
            .unwrap();
            let encoded = serde_json::to_string(&projected).unwrap();
            assert_eq!(projected.event_type, public_type);
            assert_eq!(projected.payload.stage, Some(RuntimePublicStage::Working));
            assert!(!encoded.contains("private"));
            assert!(!encoded.contains("provider-secret"));
        }
    }

    #[test]
    fn worker_artifact_projection_never_republishes_paths_or_identity_payloads() {
        let raw = WorkerEvent::Artifact {
            identity: WorkerIdentity {
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: "worker_1".into(),
            },
            sequence: 4,
            kind: "document".into(),
            path: "runtime/jobs/job_1/workspace/private-output.pdf".into(),
        };
        let projected = project_event(&JobEventRecord {
            sequence: 9,
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: Some("worker_1".into()),
            worker_sequence: Some(4),
            event_type: "artifact".into(),
            payload: serde_json::to_value(raw).unwrap(),
            created_at: 100,
        })
        .unwrap();
        let encoded = serde_json::to_string(&projected).unwrap();
        assert_eq!(projected.event_type, RuntimeJobEventType::WorkerArtifact);
        assert_eq!(
            projected.payload.artifact_kind,
            Some(RuntimePublicArtifactKind::Document)
        );
        assert!(!encoded.contains("private-output.pdf"));
        assert!(!encoded.contains("identity"));
        assert!(!encoded.contains("path"));
    }

    #[test]
    fn worker_failure_and_unknown_artifact_labels_are_runtime_owned() {
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        let cases = [
            (
                "artifact",
                5,
                WorkerEvent::Artifact {
                    identity: identity.clone(),
                    sequence: 5,
                    kind: "provider-private-kind".into(),
                    path: "runtime/jobs/job_1/workspace/private.bin".into(),
                },
                RuntimeJobEventType::WorkerArtifact,
                Some(RuntimePublicArtifactKind::Artifact),
                None,
            ),
            (
                "failed",
                6,
                WorkerEvent::Failed {
                    identity: identity.clone(),
                    sequence: 6,
                    code: "VENDOR_PRIVATE_FAILURE".into(),
                    message: "provider account and secret detail".into(),
                },
                RuntimeJobEventType::WorkerFailed,
                None,
                Some(RuntimePublicFailureCode::WorkerFailed),
            ),
        ];

        for (internal_type, sequence, raw, public_type, artifact_kind, failure_code) in cases {
            let projected = project_event(&JobEventRecord {
                sequence,
                job_id: identity.job_id.clone(),
                attempt: identity.attempt,
                worker_instance_id: Some(identity.worker_instance_id.clone()),
                worker_sequence: Some(u64::try_from(sequence).unwrap()),
                event_type: internal_type.into(),
                payload: serde_json::to_value(raw).unwrap(),
                created_at: 100,
            })
            .unwrap();
            let encoded = serde_json::to_string(&projected).unwrap();
            assert_eq!(projected.event_type, public_type);
            assert_eq!(projected.payload.artifact_kind, artifact_kind);
            assert_eq!(projected.payload.failure_code, failure_code);
            assert!(!encoded.contains("provider-private-kind"));
            assert!(!encoded.contains("VENDOR_PRIVATE_FAILURE"));
            assert!(!encoded.contains("provider account"));
            assert!(!encoded.contains("private.bin"));
        }
    }

    #[test]
    fn late_ready_and_failed_projection_preserves_cancelling_state() {
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        let cases = [
            (
                "ready-after-cancellation",
                WorkerEvent::Ready {
                    identity: identity.clone(),
                    sequence: 1,
                    protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
                },
                RuntimeJobEventType::WorkerReady,
            ),
            (
                "failed-after-cancellation",
                WorkerEvent::Failed {
                    identity: identity.clone(),
                    sequence: 2,
                    code: "PRIVATE_FAILURE".into(),
                    message: "private failure detail".into(),
                },
                RuntimeJobEventType::WorkerFailed,
            ),
        ];

        for (internal_type, raw, public_type) in cases {
            let worker_sequence = raw.sequence();
            let projected = project_event(&JobEventRecord {
                sequence: i64::try_from(worker_sequence).unwrap(),
                job_id: identity.job_id.clone(),
                attempt: identity.attempt,
                worker_instance_id: Some(identity.worker_instance_id.clone()),
                worker_sequence: Some(worker_sequence),
                event_type: internal_type.into(),
                payload: serde_json::to_value(raw).unwrap(),
                created_at: 100,
            })
            .unwrap();
            assert_eq!(projected.event_type, public_type);
            assert_eq!(projected.payload.state, Some(JobState::Cancelling));
            assert_eq!(projected.payload.failure_code, None);
            assert_eq!(projected.payload.failure_message, None);
            assert!(projected.validate().is_ok());
        }
    }

    #[test]
    fn replay_page_is_byte_bounded_and_explicitly_reports_more_records() {
        let job_id = "j".repeat(128);
        let events = (1_i64..=257)
            .map(|sequence| JobEventRecord {
                sequence,
                job_id: job_id.clone(),
                attempt: 0,
                worker_instance_id: None,
                worker_sequence: None,
                event_type: "queued".into(),
                payload: json!({
                    "path": "this raw durable field must never reach the control response"
                }),
                created_at: 100 + sequence,
            })
            .collect::<Vec<_>>();
        let response = build_runtime_job_events_response(
            &job_id,
            true,
            0,
            MAX_JOB_EVENT_REPLAY_RECORDS,
            &events,
        )
        .unwrap();
        let RuntimeJobEventsResponse::RuntimeJobEvents {
            terminal,
            has_more,
            events,
            ..
        } = &response;
        assert!(*terminal);
        assert!(*has_more);
        assert!(!events.is_empty());
        assert!(events.len() < MAX_JOB_EVENT_REPLAY_RECORDS);
        let encoded = serde_json::to_vec(&response).unwrap();
        assert!(encoded.len() <= MAX_PROTOCOL_LINE_BYTES);
        assert!(!encoded.windows(4).any(|window| window == b"path"));
    }

    #[test]
    fn replay_terminal_bit_is_the_explicit_public_stream_seal() {
        for (sealed, expected_terminal) in [(false, false), (true, true)] {
            let response = build_runtime_job_events_response("job_1", sealed, 0, 1, &[]).unwrap();
            let RuntimeJobEventsResponse::RuntimeJobEvents { terminal, .. } = response;
            assert_eq!(terminal, expected_terminal);
        }
    }
}
