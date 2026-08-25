use crate::admission::RegisteredJobAdmission;
use crate::store::{
    canonicalize_request_payload, compute_submission_digest, AuthenticatedJobContext, JobRecord,
    JobStore, NewJob, StoreError,
};
use crate::{RuntimePaths, TrustedFilePin};
use breadboard_runtime_protocol::{
    validate_bounded_text, JobSubmissionPayload, ServiceDefinition, ServiceManifest,
    ValidationError, WorkerDefinition, WorkerManifest, MAX_IDEMPOTENCY_KEY_BYTES,
};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error(transparent)]
    InvalidManifest(#[from] ValidationError),
    #[error("service dependency graph contains a cycle at {0}")]
    DependencyCycle(String),
    #[error("job type {job_type} is claimed by both {first} and {second}")]
    DuplicateJobType {
        job_type: String,
        first: String,
        second: String,
    },
    #[error("unknown worker kind {0}")]
    UnknownWorker(String),
    #[error("unknown job type {0}")]
    UnknownJobType(String),
    #[error("unknown service id {0}")]
    UnknownService(String),
    #[error("submitted {field} does not exactly match the authenticated scope")]
    AuthenticatedScopeMismatch { field: &'static str },
    #[error(transparent)]
    Path(#[from] crate::paths::PathError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Debug, Clone)]
pub struct Registry {
    workers: HashMap<String, WorkerDefinition>,
    workers_by_job_type: HashMap<String, String>,
    services: HashMap<String, ServiceDefinition>,
}

impl Registry {
    pub fn new(workers: WorkerManifest, services: ServiceManifest) -> Result<Self, RegistryError> {
        workers.validate()?;
        services.validate()?;
        ensure_acyclic(&services.services)?;

        let mut workers_by_job_type = HashMap::new();
        for worker in &workers.workers {
            for job_type in &worker.job_types {
                if let Some(first) =
                    workers_by_job_type.insert(job_type.clone(), worker.kind.clone())
                {
                    return Err(RegistryError::DuplicateJobType {
                        job_type: job_type.clone(),
                        first,
                        second: worker.kind.clone(),
                    });
                }
            }
        }
        Ok(Self {
            workers: workers
                .workers
                .into_iter()
                .map(|worker| (worker.kind.clone(), worker))
                .collect(),
            workers_by_job_type,
            services: services
                .services
                .into_iter()
                .map(|service| (service.id.clone(), service))
                .collect(),
        })
    }

    pub fn worker(&self, kind: &str) -> Result<&WorkerDefinition, RegistryError> {
        self.workers
            .get(kind)
            .ok_or_else(|| RegistryError::UnknownWorker(kind.to_string()))
    }

    pub fn worker_for_job_type(&self, job_type: &str) -> Result<&WorkerDefinition, RegistryError> {
        let kind = self
            .workers_by_job_type
            .get(job_type)
            .ok_or_else(|| RegistryError::UnknownJobType(job_type.to_string()))?;
        self.worker(kind)
    }

    pub fn admission_for_job_type(
        &self,
        job_type: &str,
    ) -> Result<RegisteredJobAdmission, RegistryError> {
        let worker = self.worker_for_job_type(job_type)?;
        Ok(RegisteredJobAdmission::new(
            job_type,
            &worker.kind,
            worker.resource_class,
            worker.estimated_cold_start_commit_mb,
            worker.maximum_concurrency,
        ))
    }

    pub fn service(&self, id: &str) -> Result<&ServiceDefinition, RegistryError> {
        self.services
            .get(id)
            .ok_or_else(|| RegistryError::UnknownService(id.to_string()))
    }

    pub fn pin_worker_executable_for_launch(
        &self,
        paths: &RuntimePaths,
        kind: &str,
    ) -> Result<TrustedFilePin, RegistryError> {
        let path = paths.resolve_runtime(&self.worker(kind)?.allowed_executable)?;
        Ok(paths.pin_runtime_file_for_launch(&path)?)
    }

    pub fn pin_worker_entrypoint_for_launch(
        &self,
        paths: &RuntimePaths,
        kind: &str,
    ) -> Result<TrustedFilePin, RegistryError> {
        let path = paths.resolve_app(&self.worker(kind)?.allowed_entrypoint)?;
        Ok(paths.pin_app_file_for_launch(&path)?)
    }

    pub fn pin_service_executable_for_launch(
        &self,
        paths: &RuntimePaths,
        id: &str,
    ) -> Result<TrustedFilePin, RegistryError> {
        let path = paths.resolve_runtime(&self.service(id)?.allowed_executable)?;
        Ok(paths.pin_runtime_file_for_launch(&path)?)
    }

    pub fn pin_service_entrypoint_for_launch(
        &self,
        paths: &RuntimePaths,
        id: &str,
    ) -> Result<Option<TrustedFilePin>, RegistryError> {
        let Some(entrypoint) = self.service(id)?.allowed_entrypoint.as_deref() else {
            return Ok(None);
        };
        let path = paths.resolve_app(entrypoint)?;
        Ok(Some(paths.pin_app_file_for_launch(&path)?))
    }

    pub fn submit_job(
        &self,
        store: &JobStore,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        request: &JobSubmissionPayload,
    ) -> Result<JobRecord, RegistryError> {
        request.validate()?;
        context.validate()?;
        if request.garden_id.as_deref() != context.garden_id() {
            return Err(RegistryError::AuthenticatedScopeMismatch { field: "gardenId" });
        }
        if request.conversation_id.as_deref() != context.conversation_id() {
            return Err(RegistryError::AuthenticatedScopeMismatch {
                field: "conversationId",
            });
        }
        let worker = self.worker_for_job_type(&request.job_type)?;
        let canonical_request_payload = canonicalize_request_payload(&request.request_payload)?;
        let request_digest = compute_submission_digest(
            context.owner(),
            &request.job_type,
            context.garden_id(),
            context.conversation_id(),
            &canonical_request_payload,
        )?;
        let job_id = submission_job_id(context, request, &request_digest)?;
        let layout = paths.job_paths(&job_id)?;
        // Publish the exact canonical input before making the job schedulable.
        // A later store failure may leave an inert staged file for bounded
        // reconciliation, but the inverse (a queued row without durable input)
        // is never observable. Keep the pin alive through the transaction so
        // the staged identity cannot be swapped between publication and bind.
        let _input_pin = paths.stage_job_input(&job_id, &canonical_request_payload)?;
        store
            .submit_raw(&NewJob {
                job_id,
                job_type: request.job_type.clone(),
                worker_kind: worker.kind.clone(),
                resource_class: worker.resource_class.as_str().to_string(),
                owner: context.owner().clone(),
                garden_id: context.garden_id().map(str::to_owned),
                conversation_id: context.conversation_id().map(str::to_owned),
                input_manifest_path: layout.input_manifest_relative(),
                workspace_path: layout.workspace_relative(),
                checkpoint_path: layout.checkpoint_relative(),
                result_path: layout.result_relative(),
                idempotency_key: request.idempotency_key.clone(),
                request_digest,
                canonical_request_payload,
            })
            .map_err(RegistryError::from)
    }
}

fn submission_job_id(
    context: &AuthenticatedJobContext,
    request: &JobSubmissionPayload,
    request_digest: &str,
) -> Result<String, StoreError> {
    validate_bounded_text(
        "idempotencyKey",
        &request.idempotency_key,
        MAX_IDEMPOTENCY_KEY_BYTES,
    )?;
    let mut digest = Sha256::new();
    digest.update(b"breadboard-runtime-v2/job-id\0");
    digest.update(context.owner().principal().as_bytes());
    digest.update(b"\0");
    digest.update(request.idempotency_key.as_bytes());
    digest.update(b"\0");
    digest.update(request_digest.as_bytes());
    let digest = digest.finalize();
    Ok(format!("job_{digest:x}"))
}

fn ensure_acyclic(services: &[ServiceDefinition]) -> Result<(), RegistryError> {
    let dependencies: HashMap<&str, Vec<&str>> = services
        .iter()
        .map(|service| {
            (
                service.id.as_str(),
                service.dependencies.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    let mut permanent = HashSet::new();
    let mut temporary = HashSet::new();
    for id in dependencies.keys().copied() {
        visit(id, &dependencies, &mut permanent, &mut temporary)?;
    }
    Ok(())
}

fn visit<'a>(
    id: &'a str,
    graph: &HashMap<&'a str, Vec<&'a str>>,
    permanent: &mut HashSet<&'a str>,
    temporary: &mut HashSet<&'a str>,
) -> Result<(), RegistryError> {
    if permanent.contains(id) {
        return Ok(());
    }
    if !temporary.insert(id) {
        return Err(RegistryError::DependencyCycle(id.to_string()));
    }
    for dependency in graph.get(id).into_iter().flatten().copied() {
        visit(dependency, graph, permanent, temporary)?;
    }
    temporary.remove(id);
    permanent.insert(id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use breadboard_runtime_protocol::{
        ResourceClass, WorkspacePolicy, SERVICE_MANIFEST_VERSION, WIRE_PROTOCOL_VERSION,
        WORKER_MANIFEST_VERSION,
    };
    use std::fs;
    use tempfile::tempdir;

    fn registry() -> Registry {
        Registry::new(
            WorkerManifest {
                version: WORKER_MANIFEST_VERSION,
                workers: vec![WorkerDefinition {
                    kind: "learn-node".into(),
                    job_types: vec!["learn".into()],
                    capability_ids: vec!["learn".into()],
                    allowed_executable: "node/node.exe".into(),
                    allowed_entrypoint: "workers/learn.js".into(),
                    protocol_version: WIRE_PROTOCOL_VERSION,
                    resource_class: ResourceClass::LargeGeneration,
                    estimated_cold_start_commit_mb: 128,
                    soft_commit_limit_mb: 256,
                    hard_commit_limit_mb: 512,
                    maximum_concurrency: 1,
                    workspace_policy: WorkspacePolicy::PrivatePerJob,
                    ready_timeout_ms: 10_000,
                    heartbeat_timeout_ms: 10_000,
                    graceful_cancellation_ms: 10_000,
                    maximum_runtime_ms: 60_000,
                    exit_after_job: true,
                }],
            },
            ServiceManifest {
                version: SERVICE_MANIFEST_VERSION,
                services: vec![],
            },
        )
        .unwrap()
    }

    fn request(payload: serde_json::Value) -> JobSubmissionPayload {
        JobSubmissionPayload {
            job_type: "learn".into(),
            garden_id: Some("garden-1".into()),
            conversation_id: None,
            idempotency_key: "request-1".into(),
            request_payload: payload,
        }
    }

    fn runtime_paths(directory: &tempfile::TempDir) -> RuntimePaths {
        fs::create_dir_all(directory.path().join("app")).unwrap();
        fs::create_dir_all(directory.path().join("runtime-root")).unwrap();
        RuntimePaths::new(
            directory.path(),
            directory.path().join("app"),
            directory.path().join("runtime-root"),
        )
        .unwrap()
    }

    #[test]
    fn submission_derives_worker_resource_and_paths_from_trusted_sources() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let job = registry()
            .submit_job(
                &store,
                &paths,
                &context,
                &request(serde_json::json!({"x": 1})),
            )
            .unwrap();
        assert_eq!(job.worker_kind, "learn-node");
        assert_eq!(job.resource_class, "large-generation");
        assert_eq!(job.user_id, Some(1));
        assert_eq!(job.garden_id.as_deref(), context.garden_id());
        assert_eq!(job.conversation_id.as_deref(), context.conversation_id());
        assert!(job.job_id.starts_with("job_"));
        assert_eq!(
            job.input_manifest_path,
            format!("runtime/jobs/{}/input.json", job.job_id)
        );
        assert_eq!(
            job.result_path,
            format!("runtime/jobs/{}/result.json", job.job_id)
        );
        assert_eq!(
            fs::read(directory.path().join(&job.input_manifest_path)).unwrap(),
            br#"{"x":1}"#
        );
    }

    #[test]
    fn admission_limits_are_derived_from_the_validated_worker_registry() {
        let admission = registry().admission_for_job_type("learn").unwrap();
        assert_eq!(admission.job_type(), "learn");
        assert_eq!(admission.definition_key(), "learn-node");
        assert_eq!(admission.resource_class(), ResourceClass::LargeGeneration);
        assert_eq!(admission.estimated_cold_start_commit_mb(), 128);
        assert_eq!(admission.maximum_concurrency(), 1);
    }

    #[test]
    fn executable_and_entrypoint_pins_use_distinct_root_authorities() {
        let directory = tempdir().unwrap();
        let paths = runtime_paths(&directory);
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime-root");
        fs::create_dir_all(app.join("node")).unwrap();
        fs::create_dir_all(app.join("workers")).unwrap();
        fs::create_dir_all(runtime.join("node")).unwrap();
        fs::create_dir_all(runtime.join("workers")).unwrap();

        // Files in the wrong authority cannot satisfy a registry launch path.
        fs::write(app.join("node/node.exe"), b"wrong root").unwrap();
        fs::write(runtime.join("workers/learn.js"), b"wrong root").unwrap();
        let registry = registry();
        assert!(registry
            .pin_worker_executable_for_launch(&paths, "learn-node")
            .is_err());
        assert!(registry
            .pin_worker_entrypoint_for_launch(&paths, "learn-node")
            .is_err());

        fs::write(runtime.join("node/node.exe"), b"runtime executable").unwrap();
        fs::write(app.join("workers/learn.js"), b"application entrypoint").unwrap();
        registry
            .pin_worker_executable_for_launch(&paths, "learn-node")
            .unwrap()
            .revalidate()
            .unwrap();
        registry
            .pin_worker_entrypoint_for_launch(&paths, "learn-node")
            .unwrap()
            .revalidate()
            .unwrap();
    }

    #[test]
    fn request_digest_is_canonical_and_conflicts_are_detected() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let registry = registry();
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let first = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &request(serde_json::json!({"b": 2, "a": 1})),
            )
            .unwrap();
        let replay = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &request(serde_json::json!({"a": 1, "b": 2})),
            )
            .unwrap();
        assert_eq!(replay.job_id, first.job_id);
        assert_eq!(
            store
                .load_canonical_request_payload(&first.job_id)
                .unwrap()
                .as_slice(),
            br#"{"a":1,"b":2}"#
        );
        assert_eq!(
            fs::read(directory.path().join(&first.input_manifest_path)).unwrap(),
            br#"{"a":1,"b":2}"#
        );

        let conflict = registry.submit_job(
            &store,
            &paths,
            &context,
            &request(serde_json::json!({"a": 2, "b": 2})),
        );
        assert!(matches!(
            conflict,
            Err(RegistryError::Store(StoreError::IdempotencyConflict { .. }))
        ));
    }

    #[test]
    fn staged_input_conflicts_fail_before_an_existing_job_can_be_replayed() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let registry = registry();
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let request = request(serde_json::json!({"a": 1}));
        let first = registry
            .submit_job(&store, &paths, &context, &request)
            .unwrap();
        fs::write(
            directory.path().join(&first.input_manifest_path),
            br#"{"a":2}"#,
        )
        .unwrap();

        assert!(matches!(
            registry.submit_job(&store, &paths, &context, &request),
            Err(RegistryError::Path(crate::paths::PathError::AlreadyStaged(
                "job input"
            )))
        ));
        assert_eq!(
            store.get(&context, &first.job_id).unwrap().state,
            breadboard_runtime_protocol::JobState::Queued
        );
    }

    #[test]
    fn submission_owner_cannot_come_from_the_untrusted_payload() {
        let forged = br#"{
            "jobType":"learn",
            "gardenId":"garden-1",
            "conversationId":null,
            "idempotencyKey":"request-1",
            "requestPayload":{},
            "owner":{"principal":"internal:runtime"}
        }"#;
        assert!(breadboard_runtime_protocol::parse_job_submission_payload(forged).is_err());
    }

    #[test]
    fn submitted_scopes_must_exactly_match_authenticated_authority() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let mut wrong_garden = request(serde_json::json!({ "x": 1 }));
        wrong_garden.garden_id = Some("garden-2".into());
        assert!(matches!(
            registry().submit_job(&store, &paths, &context, &wrong_garden),
            Err(RegistryError::AuthenticatedScopeMismatch { field: "gardenId" })
        ));

        let scoped_conversation =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), Some("conversation-1"))
                .unwrap();
        assert!(matches!(
            registry().submit_job(
                &store,
                &paths,
                &scoped_conversation,
                &request(serde_json::json!({ "x": 1 })),
            ),
            Err(RegistryError::AuthenticatedScopeMismatch {
                field: "conversationId"
            })
        ));
    }
}
