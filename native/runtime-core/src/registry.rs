use crate::admission::RegisteredJobAdmission;
use crate::process_owner::{ProcessOwnerSystemCommitGuard, DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB};
use crate::service_store::DurableServiceAdmissionProfile;
use crate::store::{
    canonicalize_request_payload, compute_submission_digest, AuthenticatedJobContext, JobRecord,
    JobStore, NewJob, StoreError, WorkerServiceDependencyAdmission,
};
use crate::{
    DurableServiceRegistration, DurableServiceStoreError, ProcessOwnerError, ProcessOwnerLimits,
    RuntimePaths, RuntimeSchedulerAuthority, ServiceLaunchRequest, ServiceLeaseError,
    ServiceLeaseLimits, ServiceLeaseRegistration, TrustedFilePin, TrustedServiceEnvironment,
    TrustedServiceEnvironmentProfile, TrustedWorkerEnvironment, WorkerLaunchRequest,
    MAX_PROCESS_OWNER_GRACEFUL_SHUTDOWN, MIN_PROCESS_OWNER_GRACEFUL_SHUTDOWN,
};
use breadboard_runtime_protocol::{
    validate_bounded_text, JobSubmissionPayload, RuntimeMode, RuntimeRecallConfiguration,
    ServiceDefinition, ServiceExecutableAuthority, ServiceInstallProbeAuthority,
    ServiceLaunchArgument, ServiceLaunchProfile, ServiceManifest, ServiceRequirement,
    ServiceRuntimeArgumentList, ServiceRuntimeValue, ServiceWorkingDirectoryPolicy,
    TrustedServiceEnvironmentSource, ValidationError, WorkerDefinition, WorkerManifest,
    WorkerServiceDependencyCondition, WorkerSubmissionAuthority, MAX_IDEMPOTENCY_KEY_BYTES,
};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::time::Duration;
use thiserror::Error;

const MEBIBYTE_BYTES: u64 = 1024 * 1024;
const WORKER_SUPERVISOR_EXIT_TIMEOUT: Duration = Duration::from_secs(10);
const SERVICE_SUPERVISOR_EXIT_TIMEOUT: Duration = Duration::from_secs(10);
const RUNTIME_SUPERVISOR_RELATIVE_PATH: &str = "bin/runtime-supervisor.exe";

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
    #[error("job type {0} is not available to this submission authority")]
    WorkerSubmissionAuthorityMismatch(String),
    #[error("unknown service id {0}")]
    UnknownService(String),
    #[error("worker {worker_kind} references unknown service dependency {service_id}")]
    UnknownWorkerServiceDependency {
        worker_kind: String,
        service_id: String,
    },
    #[error("worker {0} uses a service-dependency predicate outside its sealed request contract")]
    InvalidWorkerServiceDependencyCondition(String),
    #[error("service {0} received an invalid runtime-owned loopback port")]
    InvalidServicePort(String),
    #[error("service {service_id} cannot consume the {actual:?} environment profile")]
    ServiceEnvironmentProfileMismatch {
        service_id: String,
        actual: TrustedServiceEnvironmentProfile,
    },
    #[error("service {service_id} cannot consume an environment prepared for mode {actual:?}")]
    ServiceEnvironmentModeMismatch {
        service_id: String,
        actual: RuntimeMode,
    },
    #[error("service {service_id} requires environment source {expected:?}, not {actual:?}")]
    ServiceEnvironmentSourceMismatch {
        service_id: String,
        expected: TrustedServiceEnvironmentSource,
        actual: TrustedServiceEnvironmentSource,
    },
    #[error("worker {0} has a graceful cancellation policy outside process-owner bounds")]
    InvalidWorkerProcessLimits(String),
    #[error("service {0} has process limits outside process-owner bounds")]
    InvalidServiceProcessLimits(String),
    #[error(transparent)]
    ProcessOwner(#[from] ProcessOwnerError),
    #[error(transparent)]
    ServiceLease(#[from] ServiceLeaseError),
    #[error(transparent)]
    DurableService(#[from] DurableServiceStoreError),
    #[error("submitted {field} does not exactly match the authenticated scope")]
    AuthenticatedScopeMismatch { field: &'static str },
    #[error(transparent)]
    Path(#[from] crate::paths::PathError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Debug, Clone)]
pub struct Registry {
    mode: RuntimeMode,
    workers: HashMap<String, WorkerDefinition>,
    workers_by_job_type: HashMap<String, String>,
    services: HashMap<String, ServiceDefinition>,
    service_dependency_order: Vec<String>,
}

impl Registry {
    pub fn new(
        workers: WorkerManifest,
        services: ServiceManifest,
        mode: RuntimeMode,
    ) -> Result<Self, RegistryError> {
        workers.validate()?;
        services.validate()?;
        ensure_acyclic(&services.services)?;
        let service_dependency_order = stable_service_dependency_order(&services.services);
        let service_ids = services
            .services
            .iter()
            .map(|service| service.id.as_str())
            .collect::<HashSet<_>>();

        for worker in &workers.workers {
            worker_process_owner_limits(worker, mode)?;
            for dependency in &worker.service_dependencies {
                if !service_ids.contains(dependency.service_id.as_str()) {
                    return Err(RegistryError::UnknownWorkerServiceDependency {
                        worker_kind: worker.kind.clone(),
                        service_id: dependency.service_id.clone(),
                    });
                }
                if !worker_dependency_condition_is_valid(worker, dependency.condition) {
                    return Err(RegistryError::InvalidWorkerServiceDependencyCondition(
                        worker.kind.clone(),
                    ));
                }
            }
        }
        for service in &services.services {
            let profile = service
                .launch_profile(mode)
                .expect("validated services cover every runtime mode exactly once");
            service_process_owner_limits(service, profile, mode)?;
        }

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
            mode,
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
            service_dependency_order,
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

    /// Evaluates only closed, manifest-declared predicates against the exact
    /// canonical request bound to this durable job. Each returned opaque value
    /// binds that result to the exact job, worker definition, and service. It
    /// still requires same-transaction durable owner validation before it can
    /// narrow service admission.
    pub fn required_service_dependency_admissions_for_job(
        &self,
        store: &JobStore,
        job_id: &str,
        worker_kind: &str,
    ) -> Result<Vec<WorkerServiceDependencyAdmission>, RegistryError> {
        let worker = self.worker(worker_kind)?;
        if worker.service_dependencies.is_empty() {
            return Ok(Vec::new());
        }
        let request = store.load_canonical_request_payload(job_id)?;
        let request: serde_json::Value = serde_json::from_slice(&request)
            .map_err(|_| RegistryError::Store(StoreError::CorruptState(job_id.to_owned())))?;
        let mut required = Vec::with_capacity(worker.service_dependencies.len());
        for dependency in &worker.service_dependencies {
            let enabled =
                worker_dependency_condition_matches_request(dependency.condition, &request);
            if enabled {
                required.push(WorkerServiceDependencyAdmission::from_registry(
                    job_id,
                    &worker.kind,
                    worker.resource_class,
                    worker.estimated_cold_start_commit_mb,
                    &dependency.service_id,
                ));
            }
        }
        Ok(required)
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

    /// Returns immutable service IDs in stable dependency order. Only IDs are
    /// exposed: callers must return through Registry's typed methods to obtain
    /// registration, admission, environment, or launch material.
    pub fn service_ids_in_dependency_order(
        &self,
    ) -> impl DoubleEndedIterator<Item = &str> + ExactSizeIterator + '_ {
        self.service_dependency_order.iter().map(String::as_str)
    }

    /// Produces the opaque, mode-invariant durable registration for one
    /// validated service. Selected-mode admission data is intentionally minted
    /// separately for each runtime generation.
    pub fn durable_service_registration(
        &self,
        id: &str,
    ) -> Result<DurableServiceRegistration, RegistryError> {
        let service = self.service(id)?;
        let maximum_restarts = service
            .restart_bounds
            .as_ref()
            .map_or(0, |bounds| bounds.maximum_restarts);
        let limits = ServiceLeaseLimits::new(
            service.maximum_concurrent_leases,
            service.maximum_lease_ms,
            maximum_restarts,
        )?;
        let lease = ServiceLeaseRegistration::from_definition(
            service,
            service.requirement == ServiceRequirement::Required,
            limits,
        )?;
        Ok(DurableServiceRegistration::new(
            lease,
            service.resource_class,
            service.restart_bounds.clone(),
        )?)
    }

    /// Produces the opaque admission profile selected for this Registry's exact
    /// runtime mode. Durable service acquire/eager-start APIs require it beside
    /// the matching mode-invariant registration.
    pub fn durable_service_admission_profile(
        &self,
        id: &str,
    ) -> Result<DurableServiceAdmissionProfile, RegistryError> {
        let service = self.service(id)?;
        let profile = service
            .launch_profile(self.mode)
            .expect("validated services cover this registry mode");
        Ok(DurableServiceAdmissionProfile::new(
            service.id.clone(),
            self.mode,
            profile.resource_limits.estimated_cold_start_commit_mb,
        )?)
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

    /// Produces the only public worker-launch material accepted by the process
    /// owner. Every executable, entrypoint, and limit is derived from this
    /// validated registry entry. Callers choose only a known worker kind; the
    /// privileged native supervisor path is fixed inside this trusted module.
    pub fn prepare_worker_launch(
        &self,
        paths: &RuntimePaths,
        kind: &str,
        environment: TrustedWorkerEnvironment,
    ) -> Result<WorkerLaunchRequest, RegistryError> {
        let worker = self.worker(kind)?;
        if environment.mode() != self.mode || environment.source() != worker.environment_source {
            return Err(RegistryError::InvalidManifest(
                ValidationError::InvalidRange {
                    field: "worker.environmentSource",
                },
            ));
        }
        let supervisor = paths.pin_runtime_file_for_launch(
            &paths.resolve_runtime(RUNTIME_SUPERVISOR_RELATIVE_PATH)?,
        )?;
        let executable = paths
            .pin_runtime_file_for_launch(&paths.resolve_runtime(&worker.allowed_executable)?)?;
        let entrypoint =
            paths.pin_app_file_for_launch(&paths.resolve_app(&worker.allowed_entrypoint)?)?;
        let limits = worker_process_owner_limits(worker, self.mode)?;
        Ok(WorkerLaunchRequest::from_registry(
            worker.kind.clone(),
            paths.clone(),
            supervisor,
            executable,
            Some(entrypoint),
            environment,
            limits,
        ))
    }

    /// Produces fully pinned service launch material for this Registry's one
    /// bootstrap-selected runtime mode. Callers choose only a known service
    /// and a runtime-owned loopback port; argv, executable, cwd, install
    /// probes, and process limits all come from the validated profile.
    pub fn prepare_service_launch(
        &self,
        paths: &RuntimePaths,
        authority: &RuntimeSchedulerAuthority,
        id: &str,
        service_port: u16,
        environment: TrustedServiceEnvironment,
        recall_configuration: Option<&RuntimeRecallConfiguration>,
    ) -> Result<ServiceLaunchRequest, RegistryError> {
        let service = self.service(id)?;
        if !authority.matches_scope(&paths.runtime_generation_scope()) {
            return Err(RegistryError::InvalidManifest(
                ValidationError::InvalidRange {
                    field: "service runtime argument authority",
                },
            ));
        }
        if (service.id == "recall") != recall_configuration.is_some() {
            return Err(RegistryError::InvalidManifest(
                ValidationError::InvalidRange {
                    field: "service runtime arguments",
                },
            ));
        }
        if let Some(configuration) = recall_configuration {
            configuration.validate()?;
        }
        if service_port == 0 {
            return Err(RegistryError::InvalidServicePort(service.id.clone()));
        }
        let profile = service
            .launch_profile(self.mode)
            .expect("validated services cover this registry mode");
        if environment.profile().service_id() != service.id {
            return Err(RegistryError::ServiceEnvironmentProfileMismatch {
                service_id: service.id.clone(),
                actual: environment.profile(),
            });
        }
        if environment.mode() != self.mode {
            return Err(RegistryError::ServiceEnvironmentModeMismatch {
                service_id: service.id.clone(),
                actual: environment.mode(),
            });
        }
        if environment.source() != profile.environment_source {
            return Err(RegistryError::ServiceEnvironmentSourceMismatch {
                service_id: service.id.clone(),
                expected: profile.environment_source,
                actual: environment.source(),
            });
        }
        let supervisor = paths.pin_runtime_file_for_launch(
            &paths.resolve_runtime(RUNTIME_SUPERVISOR_RELATIVE_PATH)?,
        )?;
        let executable = match profile.executable_authority {
            ServiceExecutableAuthority::RuntimeRoot => paths.pin_runtime_file_for_launch(
                &paths.resolve_runtime(&profile.allowed_executable)?,
            )?,
            ServiceExecutableAuthority::DataRoot => {
                paths.pin_data_file_for_launch(&paths.resolve_data(&profile.allowed_executable)?)?
            }
        };
        let mut launch_files = Vec::with_capacity(profile.install_probe.files().len());
        for probe in profile.install_probe.files() {
            let executable_probe = match profile.executable_authority {
                ServiceExecutableAuthority::RuntimeRoot => {
                    probe.authority == ServiceInstallProbeAuthority::RuntimeRoot
                }
                ServiceExecutableAuthority::DataRoot => {
                    probe.authority == ServiceInstallProbeAuthority::DataRoot
                }
            };
            if executable_probe && probe.path == profile.allowed_executable {
                // The separately retained executable pin is this exact probe.
                continue;
            }
            let pin = match probe.authority {
                ServiceInstallProbeAuthority::RuntimeRoot => {
                    paths.pin_runtime_file_for_launch(&paths.resolve_runtime(&probe.path)?)?
                }
                ServiceInstallProbeAuthority::AppRoot => {
                    paths.pin_app_file_for_launch(&paths.resolve_app(&probe.path)?)?
                }
                ServiceInstallProbeAuthority::DataRoot => {
                    paths.pin_data_file_for_launch(&paths.resolve_data(&probe.path)?)?
                }
            };
            launch_files.push(pin);
        }
        let mut arguments = Vec::with_capacity(profile.arguments.len());
        for argument in &profile.arguments {
            match argument {
                ServiceLaunchArgument::Literal { value } => {
                    arguments.push(OsString::from(value));
                }
                ServiceLaunchArgument::AppPath { path } => {
                    arguments.push(paths.resolve_app(path)?.child_argv_path()?.into_os_string());
                }
                ServiceLaunchArgument::DataPath { path } => {
                    arguments.push(
                        paths
                            .resolve_data(path)?
                            .child_argv_path()?
                            .into_os_string(),
                    );
                }
                ServiceLaunchArgument::RuntimeValue {
                    value: ServiceRuntimeValue::ServicePort,
                } => arguments.push(OsString::from(service_port.to_string())),
                ServiceLaunchArgument::RuntimeArguments {
                    value: ServiceRuntimeArgumentList::RecallCapture,
                } => {
                    let configuration = recall_configuration.ok_or_else(|| {
                        RegistryError::InvalidManifest(ValidationError::InvalidRange {
                            field: "service runtime arguments",
                        })
                    })?;
                    if !configuration.capture_audio {
                        arguments.push(OsString::from("--disable-audio"));
                    }
                    for window in &configuration.excluded_windows {
                        arguments.push(OsString::from("--ignored-windows"));
                        arguments.push(OsString::from(window));
                    }
                }
            }
        }
        let working_directory = match &profile.working_directory {
            ServiceWorkingDirectoryPolicy::AppRoot => paths.pin_app_root_launch_directory()?,
            ServiceWorkingDirectoryPolicy::AppSubdirectory { path } => {
                paths.pin_app_launch_directory(path)?
            }
            ServiceWorkingDirectoryPolicy::DataSubdirectory { path } => {
                paths.pin_data_launch_directory(path)?
            }
            ServiceWorkingDirectoryPolicy::HotDevelopmentWorkspace {
                app_path,
                isolated_data_path,
            } => {
                if self.mode != RuntimeMode::Hot {
                    return Err(RegistryError::InvalidManifest(
                        ValidationError::InvalidRange {
                            field: "service hot workspace mode",
                        },
                    ));
                }
                if paths.has_distinct_data_root() {
                    paths.pin_data_launch_directory(isolated_data_path)?
                } else {
                    paths.pin_app_launch_directory(app_path)?
                }
            }
        };
        ServiceLaunchRequest::from_registry(
            service.id.clone(),
            service_port,
            service.readiness.clone(),
            paths.runtime_generation_scope(),
            paths.clone(),
            supervisor,
            executable,
            launch_files,
            working_directory,
            arguments,
            environment,
            service_process_owner_limits(service, profile, self.mode)?,
        )
        .map_err(RegistryError::from)
    }

    pub fn submit_job(
        &self,
        store: &JobStore,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        request: &JobSubmissionPayload,
    ) -> Result<JobRecord, RegistryError> {
        self.submit_job_with_authority(
            store,
            paths,
            context,
            request,
            WorkerSubmissionAuthority::User,
        )
    }

    pub fn submit_runtime_job(
        &self,
        store: &JobStore,
        paths: &RuntimePaths,
        authority: &RuntimeSchedulerAuthority,
        context: &AuthenticatedJobContext,
        request: &JobSubmissionPayload,
    ) -> Result<JobRecord, RegistryError> {
        if !authority.matches_scope(&paths.runtime_generation_scope()) {
            return Err(RegistryError::WorkerSubmissionAuthorityMismatch(
                request.job_type.clone(),
            ));
        }
        self.submit_job_with_authority(
            store,
            paths,
            context,
            request,
            WorkerSubmissionAuthority::Runtime,
        )
    }

    pub fn read_runtime_job_result(
        &self,
        paths: &RuntimePaths,
        authority: &RuntimeSchedulerAuthority,
        context: &AuthenticatedJobContext,
        job: &JobRecord,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, RegistryError> {
        if !authority.matches_scope(&paths.runtime_generation_scope())
            || !job.is_owned_by(context)
            || !job.state.is_terminal()
        {
            return Err(RegistryError::AuthenticatedScopeMismatch { field: "jobId" });
        }
        let worker = self.worker_for_job_type(&job.job_type)?;
        if worker.submission_authority != WorkerSubmissionAuthority::Runtime
            || maximum_bytes == 0
            || maximum_bytes > crate::MAX_OWNED_JOB_RESULT_BYTES
        {
            return Err(RegistryError::WorkerSubmissionAuthorityMismatch(
                job.job_type.clone(),
            ));
        }
        paths
            .read_bounded_job_result(&job.job_id, maximum_bytes)
            .map_err(RegistryError::from)
    }

    fn submit_job_with_authority(
        &self,
        store: &JobStore,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        request: &JobSubmissionPayload,
        submission_authority: WorkerSubmissionAuthority,
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
        if worker.submission_authority != submission_authority {
            return Err(RegistryError::WorkerSubmissionAuthorityMismatch(
                request.job_type.clone(),
            ));
        }
        if worker.kind == "recall-install" {
            let valid_scope = context.user_id().is_some_and(|value| value > 0)
                && context.garden_id().is_none()
                && context.conversation_id().is_none();
            let valid_request = request.request_payload.as_object().is_some_and(|object| {
                object.len() == 2
                    && object
                        .get("protocolVersion")
                        .and_then(serde_json::Value::as_u64)
                        == Some(1)
                    && object.get("action").and_then(serde_json::Value::as_str) == Some("install")
            });
            if !valid_scope || !valid_request {
                return Err(RegistryError::Store(StoreError::InvalidInput(
                    "recall-install requires its exact user-global request contract".into(),
                )));
            }
        }
        let input_count = request.input_uploads.len() as u32;
        if input_count < worker.minimum_input_blobs || input_count > worker.maximum_input_blobs {
            return Err(RegistryError::Store(StoreError::InvalidInput(format!(
                "job type {} requires between {} and {} input blobs",
                request.job_type, worker.minimum_input_blobs, worker.maximum_input_blobs
            ))));
        }
        let canonical_request_payload = canonicalize_request_payload(&request.request_payload)?;
        let resolved_inputs =
            store.resolve_job_input_uploads(paths, context, &request.input_uploads)?;
        let digest_inputs = resolved_inputs
            .iter()
            .map(crate::input_uploads::ResolvedJobInputUpload::digest_binding)
            .collect::<Vec<_>>();
        let request_digest = compute_submission_digest(
            context.owner(),
            &request.job_type,
            context.garden_id(),
            context.conversation_id(),
            &canonical_request_payload,
            &digest_inputs,
        )?;
        let job_id = submission_job_id(context, request, &request_digest)?;
        let layout = paths.job_paths(&job_id)?;
        let input_blobs = resolved_inputs
            .iter()
            .map(|input| input.binding_for_job(&job_id))
            .collect::<Vec<_>>();
        let submission = NewJob {
            job_id: job_id.clone(),
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
            input_blobs,
        };
        let replay = match store.replay_raw(&submission) {
            Ok(replay) => replay,
            Err(error @ StoreError::CancelledBeforeSubmission(_)) => {
                store.abandon_cancelled_resolved_job_inputs(paths, context, resolved_inputs)?;
                return Err(RegistryError::Store(error));
            }
            Err(error) => return Err(RegistryError::Store(error)),
        };
        if let Some(job) = replay {
            store.settle_replayed_resolved_job_inputs(
                paths,
                context,
                &job.job_id,
                resolved_inputs,
            )?;
            return Ok(job);
        }
        // Publish the exact canonical input before making the job schedulable.
        // A later store failure may leave an inert staged file for bounded
        // reconciliation, but the inverse (a queued row without durable input)
        // is never observable. Keep the pin alive through the transaction so
        // the staged identity cannot be swapped between publication and bind.
        let _input_pin = paths.stage_job_input(&job_id, &submission.canonical_request_payload)?;
        let prepared_inputs = store.prepare_job_input_adoptions(paths, &job_id, resolved_inputs)?;
        let prepared_bindings = prepared_inputs
            .iter()
            .map(|prepared| prepared.binding.clone())
            .collect::<Vec<_>>();
        if prepared_bindings != submission.input_blobs {
            store.cleanup_unsubmitted_job_input_adoptions(paths, &job_id, prepared_inputs)?;
            return Err(RegistryError::Store(StoreError::CorruptState(job_id)));
        }
        match store.submit_raw(&submission) {
            Ok(job) => {
                store.settle_submitted_job_input_adoptions(
                    paths,
                    context,
                    &job.job_id,
                    prepared_inputs,
                )?;
                if job.state.is_terminal() && job.attempt == 0 {
                    store.cleanup_unstarted_terminal_job_inputs(paths, &job.job_id)?;
                }
                Ok(job)
            }
            Err(error @ StoreError::CancelledBeforeSubmission(_)) => {
                store.abandon_cancelled_job_input_adoptions(
                    paths,
                    context,
                    &job_id,
                    prepared_inputs,
                )?;
                Err(RegistryError::Store(error))
            }
            Err(error) => {
                store.cleanup_unsubmitted_job_input_adoptions(paths, &job_id, prepared_inputs)?;
                Err(RegistryError::Store(error))
            }
        }
    }
}

fn worker_dependency_condition_matches_request(
    condition: WorkerServiceDependencyCondition,
    request: &serde_json::Value,
) -> bool {
    let root = request.as_object();
    let engine = root
        .and_then(|object| object.get("engine"))
        .and_then(serde_json::Value::as_str);
    let source_kind = root
        .and_then(|object| object.get("source"))
        .and_then(serde_json::Value::as_object)
        .and_then(|source| source.get("kind"))
        .and_then(serde_json::Value::as_str);
    let transcript_only = root
        .and_then(|object| object.get("request"))
        .and_then(serde_json::Value::as_object)
        .and_then(|meeting_request| meeting_request.get("transcriptOnly"))
        .and_then(serde_json::Value::as_bool);
    match condition {
        WorkerServiceDependencyCondition::DocumentIngestionParseWithVlm => {
            root.and_then(|object| object.get("parseWithVlm"))
                == Some(&serde_json::Value::Bool(true))
        }
        WorkerServiceDependencyCondition::GbrainSyncAlways
        | WorkerServiceDependencyCondition::Always
        | WorkerServiceDependencyCondition::ScriberrGardenTranscriptionAlways => true,
        WorkerServiceDependencyCondition::MeetingNotesEngineScriberr => {
            engine == Some("scriberr") && source_kind == Some("audio")
        }
        WorkerServiceDependencyCondition::MeetingNotesEngineVoicebox => {
            engine == Some("voicebox") && source_kind == Some("audio")
        }
        WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock => {
            transcript_only == Some(false)
                && source_kind != Some("error")
                && !(source_kind == Some("audio") && engine == Some("none"))
        }
    }
}

fn worker_dependency_condition_is_valid(
    worker: &WorkerDefinition,
    condition: WorkerServiceDependencyCondition,
) -> bool {
    match condition {
        WorkerServiceDependencyCondition::DocumentIngestionParseWithVlm => {
            worker.kind == "document-ingestion-node"
                && worker
                    .job_types
                    .iter()
                    .any(|job_type| job_type == "document-ingestion")
        }
        WorkerServiceDependencyCondition::GbrainSyncAlways => {
            worker.kind == "gbrain-sync-node"
                && worker
                    .job_types
                    .iter()
                    .any(|job_type| job_type == "gbrain-sync")
        }
        WorkerServiceDependencyCondition::Always => true,
        WorkerServiceDependencyCondition::ScriberrGardenTranscriptionAlways => {
            worker.kind == "scriberr-garden-transcription-node"
                && worker
                    .job_types
                    .iter()
                    .any(|job_type| job_type == "scriberr-garden-transcription")
        }
        WorkerServiceDependencyCondition::MeetingNotesEngineScriberr
        | WorkerServiceDependencyCondition::MeetingNotesEngineVoicebox
        | WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock => {
            worker.kind == "outer-meeting-notes-node"
                && worker
                    .job_types
                    .iter()
                    .any(|job_type| job_type == "meeting-notes-run")
        }
    }
}

fn worker_process_owner_limits(
    worker: &WorkerDefinition,
    mode: RuntimeMode,
) -> Result<ProcessOwnerLimits, RegistryError> {
    let invalid = || RegistryError::InvalidWorkerProcessLimits(worker.kind.clone());
    let graceful_shutdown = Duration::from_millis(worker.graceful_cancellation_ms);
    if !(MIN_PROCESS_OWNER_GRACEFUL_SHUTDOWN..=MAX_PROCESS_OWNER_GRACEFUL_SHUTDOWN)
        .contains(&graceful_shutdown)
    {
        return Err(invalid());
    }
    let system_commit_guard = if mode == RuntimeMode::Packaged {
        None
    } else {
        let expected_commit_bytes = worker
            .estimated_cold_start_commit_mb
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?;
        let trusted_reserve_bytes = DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?;
        Some(
            ProcessOwnerSystemCommitGuard::development(
                expected_commit_bytes,
                trusted_reserve_bytes,
            )
            .map_err(|_| invalid())?,
        )
    };
    let limits = ProcessOwnerLimits {
        soft_commit_bytes: worker
            .soft_commit_limit_mb
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?,
        hard_commit_bytes: worker
            .hard_commit_limit_mb
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?,
        graceful_shutdown,
        supervisor_exit_timeout: WORKER_SUPERVISOR_EXIT_TIMEOUT,
        system_commit_guard,
    };
    limits.validate().map_err(|_| invalid())
}

fn service_process_owner_limits(
    service: &ServiceDefinition,
    profile: &ServiceLaunchProfile,
    mode: RuntimeMode,
) -> Result<ProcessOwnerLimits, RegistryError> {
    let invalid = || RegistryError::InvalidServiceProcessLimits(service.id.clone());
    let system_commit_guard = if mode != RuntimeMode::Packaged {
        let expected_commit_bytes = profile
            .resource_limits
            .estimated_cold_start_commit_mb
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?;
        let trusted_reserve_bytes = DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?;
        Some(
            ProcessOwnerSystemCommitGuard::development(
                expected_commit_bytes,
                trusted_reserve_bytes,
            )
            .map_err(|_| invalid())?,
        )
    } else {
        None
    };
    let limits = ProcessOwnerLimits {
        soft_commit_bytes: profile
            .resource_limits
            .soft_commit_limit_mb
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?,
        hard_commit_bytes: profile
            .resource_limits
            .hard_commit_limit_mb
            .checked_mul(MEBIBYTE_BYTES)
            .ok_or_else(&invalid)?,
        graceful_shutdown: Duration::from_millis(service.graceful_shutdown_ms),
        supervisor_exit_timeout: SERVICE_SUPERVISOR_EXIT_TIMEOUT,
        system_commit_guard,
    };
    limits.validate().map_err(|_| invalid())
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

/// Produces a stable topological order after `ensure_acyclic` has accepted the
/// same manifest. At each step the first manifest entry whose dependencies are
/// satisfied wins, retaining manifest order for independent services and for
/// peers whenever dependency constraints permit it.
fn stable_service_dependency_order(services: &[ServiceDefinition]) -> Vec<String> {
    let manifest_index = services
        .iter()
        .enumerate()
        .map(|(index, service)| (service.id.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut emitted = vec![false; services.len()];
    let mut order = Vec::with_capacity(services.len());
    while order.len() < services.len() {
        let next = services.iter().enumerate().find_map(|(index, service)| {
            (!emitted[index]
                && service.dependencies.iter().all(|dependency| {
                    emitted[*manifest_index
                        .get(dependency.as_str())
                        .expect("validated dependency must exist")]
                }))
            .then_some(index)
        });
        let index = next.expect("acyclic validated service graph must have an eligible node");
        emitted[index] = true;
        order.push(services[index].id.clone());
    }
    order
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
    use crate::{
        DashboardControlEnvironment, ServiceEndpointMap, TrustedDirectoryPin, TrustedOsEnvironment,
        TrustedServiceEnvironmentSet,
    };
    use breadboard_runtime_protocol::{
        ResourceClass, RestartPolicy, RuntimeJobInputReservationRequest,
        RuntimeJobInputUploadReference, RuntimeMode, ServiceExecutableAuthority,
        ServiceHttpReadiness, ServiceInstallProbe, ServiceInstallProbeAuthority,
        ServiceInstallProbeFile, ServiceLaunchArgument, ServiceLaunchProfile, ServiceRequirement,
        ServiceResourceLimits, ServiceRestartBounds, ServiceStartupPolicy,
        ServiceWorkingDirectoryPolicy, TrustedServiceEnvironmentSource, WorkspacePolicy,
        SERVICE_MANIFEST_VERSION, WIRE_PROTOCOL_VERSION, WORKER_MANIFEST_VERSION,
    };
    use std::fs;
    use std::io::Write;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    const TEST_NEXT_AUTH_SECRET: &str = "next-auth-secret-0123456789-abcdef";
    const TEST_GBRAIN_ADAPTER_SECRET: &str = "gbrain-adapter-secret-0123456789-ab";
    const TEST_HERMES_SESSION_TOKEN: &str = "hermes-session-token-0123456789-ab";
    const TEST_HERMES_TOOL_SECRET: &str = "hermes-tool-secret-0123456789-abcd";
    const TEST_HERMES_CAPABILITY_SECRET: &str = "hermes-capability-secret-0123456789";
    const TEST_CONTROL_TOKEN: &str = "control-token-0123456789-abcdefgh";

    fn service_launch_profiles(
        executable: &str,
        entrypoint: Option<&str>,
    ) -> Vec<ServiceLaunchProfile> {
        let mut files = vec![ServiceInstallProbeFile {
            authority: ServiceInstallProbeAuthority::RuntimeRoot,
            path: executable.into(),
        }];
        let arguments = entrypoint.map_or_else(Vec::new, |path| {
            files.push(ServiceInstallProbeFile {
                authority: ServiceInstallProbeAuthority::AppRoot,
                path: path.into(),
            });
            vec![ServiceLaunchArgument::AppPath { path: path.into() }]
        });
        vec![ServiceLaunchProfile {
            modes: vec![RuntimeMode::Lean, RuntimeMode::Hot, RuntimeMode::Packaged],
            executable_authority: ServiceExecutableAuthority::RuntimeRoot,
            allowed_executable: executable.into(),
            arguments,
            environment_source: TrustedServiceEnvironmentSource::Dashboard,
            working_directory: ServiceWorkingDirectoryPolicy::AppRoot,
            install_probe: ServiceInstallProbe::FilesPresent { files },
            resource_limits: ServiceResourceLimits {
                estimated_cold_start_commit_mb: 64,
                soft_commit_limit_mb: 128,
                hard_commit_limit_mb: 256,
            },
        }]
    }

    fn service_readiness() -> ServiceHttpReadiness {
        ServiceHttpReadiness {
            path: "/health".into(),
            expected_body_contains: None,
            request_timeout_ms: 100,
            poll_interval_ms: 100,
            startup_timeout_ms: 1_000,
        }
    }

    fn service_definition(id: &str, dependencies: &[&str]) -> ServiceDefinition {
        ServiceDefinition {
            id: id.into(),
            display_name: id.into(),
            capability_ids: vec![format!("capability:{id}")],
            requirement: ServiceRequirement::Required,
            launch_profiles: service_launch_profiles("services/search.exe", None),
            readiness: service_readiness(),
            startup_policy: ServiceStartupPolicy::OnDemand,
            resource_class: ResourceClass::Core,
            dependencies: dependencies
                .iter()
                .map(|dependency| (*dependency).into())
                .collect(),
            maximum_concurrent_leases: 4,
            maximum_lease_ms: 60_000,
            idle_ttl_ms: Some(60_000),
            graceful_shutdown_ms: 2_000,
            restart_policy: RestartPolicy::OnFailure,
            restart_bounds: Some(ServiceRestartBounds {
                maximum_restarts: 2,
                window_ms: 60_000,
                initial_backoff_ms: 100,
                maximum_backoff_ms: 1_000,
            }),
        }
    }

    fn registry_with_services(services: Vec<ServiceDefinition>) -> Result<Registry, RegistryError> {
        Registry::new(
            WorkerManifest {
                version: WORKER_MANIFEST_VERSION,
                workers: Vec::new(),
            },
            ServiceManifest {
                version: SERVICE_MANIFEST_VERSION,
                services,
            },
            RuntimeMode::Lean,
        )
    }

    fn registry() -> Registry {
        Registry::new(
            WorkerManifest {
                version: WORKER_MANIFEST_VERSION,
                workers: vec![
                    WorkerDefinition {
                        kind: "learn-node".into(),
                        job_types: vec!["learn".into()],
                        capability_ids: vec!["learn".into()],
                        submission_authority: WorkerSubmissionAuthority::User,
                        environment_source:
                            breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Minimal,
                        service_dependencies: Vec::new(),
                        allowed_executable: "node/node.exe".into(),
                        allowed_entrypoint: "workers/learn.js".into(),
                        protocol_version: WIRE_PROTOCOL_VERSION,
                        resource_class: ResourceClass::LargeGeneration,
                        estimated_cold_start_commit_mb: 128,
                        soft_commit_limit_mb: 256,
                        hard_commit_limit_mb: 512,
                        maximum_concurrency: 1,
                        minimum_input_blobs: 0,
                        maximum_input_blobs: 0,
                        workspace_policy: WorkspacePolicy::PrivatePerJob,
                        ready_timeout_ms: 10_000,
                        heartbeat_timeout_ms: 10_000,
                        graceful_cancellation_ms: 10_000,
                        maximum_runtime_ms: 60_000,
                        exit_after_job: true,
                    },
                    WorkerDefinition {
                        kind: "document-ingestion-node".into(),
                        job_types: vec!["document-ingestion".into()],
                        capability_ids: vec!["document-ingestion".into()],
                        submission_authority: WorkerSubmissionAuthority::User,
                        environment_source:
                            breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Minimal,
                        service_dependencies: Vec::new(),
                        allowed_executable: "node/node.exe".into(),
                        allowed_entrypoint: "workers/document-ingestion.js".into(),
                        protocol_version: WIRE_PROTOCOL_VERSION,
                        resource_class: ResourceClass::DocumentProcessing,
                        estimated_cold_start_commit_mb: 128,
                        soft_commit_limit_mb: 256,
                        hard_commit_limit_mb: 512,
                        maximum_concurrency: 1,
                        minimum_input_blobs: 1,
                        maximum_input_blobs: 1,
                        workspace_policy: WorkspacePolicy::PrivatePerJob,
                        ready_timeout_ms: 10_000,
                        heartbeat_timeout_ms: 10_000,
                        graceful_cancellation_ms: 10_000,
                        maximum_runtime_ms: 60_000,
                        exit_after_job: true,
                    },
                ],
            },
            ServiceManifest {
                version: SERVICE_MANIFEST_VERSION,
                services: vec![ServiceDefinition {
                    id: "dashboard".into(),
                    display_name: "Dashboard".into(),
                    capability_ids: vec!["search".into()],
                    requirement: ServiceRequirement::Required,
                    launch_profiles: service_launch_profiles(
                        "services/search.exe",
                        Some("services/search.mjs"),
                    ),
                    readiness: service_readiness(),
                    startup_policy: ServiceStartupPolicy::OnDemand,
                    resource_class: ResourceClass::Core,
                    dependencies: vec![],
                    maximum_concurrent_leases: 4,
                    maximum_lease_ms: 60_000,
                    idle_ttl_ms: Some(60_000),
                    graceful_shutdown_ms: 2_000,
                    restart_policy: RestartPolicy::OnFailure,
                    restart_bounds: Some(ServiceRestartBounds {
                        maximum_restarts: 2,
                        window_ms: 60_000,
                        initial_backoff_ms: 100,
                        maximum_backoff_ms: 1_000,
                    }),
                }],
            },
            RuntimeMode::Lean,
        )
        .unwrap()
    }

    fn request(payload: serde_json::Value) -> JobSubmissionPayload {
        JobSubmissionPayload {
            job_type: "learn".into(),
            garden_id: Some("garden-1".into()),
            conversation_id: None,
            idempotency_key: "request-1".into(),
            input_uploads: Vec::new(),
            request_payload: payload,
        }
    }

    fn seal_document_input(
        store: &JobStore,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        bytes: &[u8],
    ) -> String {
        let reservation = store
            .reserve_job_input_upload(
                context,
                &RuntimeJobInputReservationRequest {
                    garden_id: context.garden_id().map(str::to_owned),
                    conversation_id: context.conversation_id().map(str::to_owned),
                    display_name: "document.txt".into(),
                    media_type: Some("text/plain".into()),
                    declared_size_bytes: bytes.len() as u64,
                },
                bytes.len() as u64,
            )
            .unwrap();
        let mut lease = store
            .begin_job_input_upload(paths, context, &reservation.upload_id)
            .unwrap();
        lease.write_all(bytes).unwrap();
        lease.seal().unwrap();
        reservation.upload_id
    }

    fn document_request(idempotency_key: &str, upload_id: &str) -> JobSubmissionPayload {
        JobSubmissionPayload {
            job_type: "document-ingestion".into(),
            garden_id: Some("garden-1".into()),
            conversation_id: None,
            idempotency_key: idempotency_key.into(),
            input_uploads: vec![RuntimeJobInputUploadReference {
                upload_id: upload_id.into(),
            }],
            request_payload: serde_json::json!({"source": "upload"}),
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

    fn trusted_environment_source(
        directory: &tempfile::TempDir,
        paths: &RuntimePaths,
        mode: RuntimeMode,
    ) -> TrustedServiceEnvironmentSet {
        let config_root = directory.path().join("config");
        let system_root = directory.path().join("windows");
        fs::create_dir_all(&config_root).unwrap();
        fs::create_dir_all(&system_root).unwrap();
        fs::write(
            config_root.join("desktop-config.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "nextAuthSecret": TEST_NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": TEST_GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": TEST_HERMES_SESSION_TOKEN,
                "hermesToolSecret": TEST_HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": TEST_HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789"
            }))
            .unwrap(),
        )
        .unwrap();
        let config_root = TrustedDirectoryPin::pin_existing("configuration", config_root).unwrap();
        let os_environment = TrustedOsEnvironment::for_test(system_root.into_os_string());
        TrustedServiceEnvironmentSet::load(
            mode,
            paths,
            &config_root,
            &ServiceEndpointMap::new(
                [
                    43_120, 43_123, 43_121, 43_124, 43_122, 43_125, 43_126, 43_127, 43_128, 43_129,
                    43_130, 43_131, 43_132, 43_133, 43_134, 43_135, 43_136, 43_137, 43_138, 43_139,
                    43_140, 43_141, 43_142, 43_143, 43_144, 43_145, 43_146, 43_147, 43_148, 43_149,
                    43_150, 43_151,
                ],
                [43_152, 43_153, 43_154, 43_155, 43_156],
            )
            .unwrap(),
            DashboardControlEnvironment::new("http://127.0.0.1:43123", TEST_CONTROL_TOKEN).unwrap(),
            &os_environment,
        )
        .unwrap()
    }

    fn launch_environment(
        source: &TrustedServiceEnvironmentSet,
        profile: TrustedServiceEnvironmentProfile,
    ) -> TrustedServiceEnvironment {
        let mut launch_profile =
            service_launch_profiles("services/search.exe", Some("services/search.mjs")).remove(0);
        launch_profile.environment_source = profile.source();
        source
            .prepare_for_launch_profile(profile.service_id(), &launch_profile)
            .unwrap()
    }

    fn scheduler_authority(paths: &RuntimePaths) -> RuntimeSchedulerAuthority {
        RuntimeSchedulerAuthority::for_test(paths.runtime_generation_scope())
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
    fn service_registration_is_mode_invariant_and_admission_profile_is_exact() {
        let mut service = registry().service("dashboard").unwrap().clone();
        let base_profile = service.launch_profiles[0].clone();
        service.launch_profiles = [
            (RuntimeMode::Lean, 64),
            (RuntimeMode::Hot, 128),
            (RuntimeMode::Packaged, 192),
        ]
        .into_iter()
        .map(|(mode, estimate)| {
            let mut profile = base_profile.clone();
            profile.modes = vec![mode];
            profile.resource_limits.estimated_cold_start_commit_mb = estimate;
            profile
        })
        .collect();
        let registry_for_mode = |mode| {
            Registry::new(
                WorkerManifest {
                    version: WORKER_MANIFEST_VERSION,
                    workers: vec![],
                },
                ServiceManifest {
                    version: SERVICE_MANIFEST_VERSION,
                    services: vec![service.clone()],
                },
                mode,
            )
            .unwrap()
        };
        let lean = registry_for_mode(RuntimeMode::Lean);
        let hot = registry_for_mode(RuntimeMode::Hot);
        let packaged = registry_for_mode(RuntimeMode::Packaged);

        let registration = lean.durable_service_registration("dashboard").unwrap();
        assert_eq!(
            registration,
            hot.durable_service_registration("dashboard").unwrap()
        );
        assert_eq!(
            registration,
            packaged.durable_service_registration("dashboard").unwrap()
        );
        for (registry, mode, estimate) in [
            (&lean, RuntimeMode::Lean, 64),
            (&hot, RuntimeMode::Hot, 128),
            (&packaged, RuntimeMode::Packaged, 192),
        ] {
            let profile = registry
                .durable_service_admission_profile("dashboard")
                .unwrap();
            assert_eq!(profile.service_id(), "dashboard");
            assert_eq!(profile.mode(), mode);
            assert_eq!(profile.estimated_cold_start_commit_mb(), estimate);
        }
    }

    #[test]
    fn only_development_workers_and_services_receive_the_native_system_commit_guard() {
        let mut dashboard = registry().service("dashboard").unwrap().clone();
        let mut hot_profile = dashboard.launch_profiles[0].clone();
        hot_profile.modes = vec![RuntimeMode::Hot];
        hot_profile.resource_limits = ServiceResourceLimits {
            estimated_cold_start_commit_mb: 3_072,
            soft_commit_limit_mb: 6_144,
            hard_commit_limit_mb: 8_192,
        };
        dashboard.launch_profiles = vec![hot_profile.clone()];

        let hot_limits =
            service_process_owner_limits(&dashboard, &hot_profile, RuntimeMode::Hot).unwrap();
        assert_eq!(hot_limits.hard_commit_bytes, 8_192 * MEBIBYTE_BYTES);
        assert_eq!(
            hot_limits.system_commit_guard,
            Some(
                ProcessOwnerSystemCommitGuard::development(
                    3_072 * MEBIBYTE_BYTES,
                    DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB * MEBIBYTE_BYTES,
                )
                .unwrap()
            )
        );

        let lean_limits =
            service_process_owner_limits(&dashboard, &hot_profile, RuntimeMode::Lean).unwrap();
        assert_eq!(
            lean_limits.system_commit_guard,
            hot_limits.system_commit_guard
        );

        let mut other = dashboard.clone();
        other.id = "not-dashboard".into();
        let other_hot_limits =
            service_process_owner_limits(&other, &hot_profile, RuntimeMode::Hot).unwrap();
        assert_eq!(
            other_hot_limits.system_commit_guard,
            hot_limits.system_commit_guard
        );

        let packaged_limits =
            service_process_owner_limits(&dashboard, &hot_profile, RuntimeMode::Packaged).unwrap();
        assert_eq!(packaged_limits.system_commit_guard, None);

        let worker_registry = registry();
        let worker = worker_registry.worker("learn-node").unwrap();
        let lean_worker = worker_process_owner_limits(worker, RuntimeMode::Lean).unwrap();
        let hot_worker = worker_process_owner_limits(worker, RuntimeMode::Hot).unwrap();
        assert_eq!(
            lean_worker.system_commit_guard,
            hot_worker.system_commit_guard
        );
        assert_eq!(
            hot_worker.system_commit_guard,
            Some(
                ProcessOwnerSystemCommitGuard::development(
                    128 * MEBIBYTE_BYTES,
                    DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB * MEBIBYTE_BYTES,
                )
                .unwrap()
            )
        );
        assert_eq!(
            worker_process_owner_limits(worker, RuntimeMode::Packaged)
                .unwrap()
                .system_commit_guard,
            None
        );
    }

    #[test]
    fn service_dependency_order_is_stable_complete_and_dependency_first() {
        let services = vec![
            service_definition("consumer", &["dependency"]),
            service_definition("independent-a", &[]),
            service_definition("dependency", &[]),
            service_definition("independent-b", &[]),
            service_definition("tail", &["consumer"]),
        ];
        let expected = vec![
            "independent-a",
            "dependency",
            "consumer",
            "independent-b",
            "tail",
        ];

        for _ in 0..8 {
            let registry = registry_with_services(services.clone()).unwrap();
            let actual = registry
                .service_ids_in_dependency_order()
                .collect::<Vec<_>>();
            assert_eq!(actual, expected);
            assert_eq!(actual.len(), services.len());
            assert_eq!(
                actual.iter().copied().collect::<HashSet<_>>().len(),
                services.len()
            );
        }
    }

    #[test]
    fn already_valid_manifest_order_is_retained_exactly() {
        let manifest_order = vec!["foundation", "dashboard", "metrics", "hermes"];
        let registry = registry_with_services(vec![
            service_definition("foundation", &[]),
            service_definition("dashboard", &["foundation"]),
            service_definition("metrics", &[]),
            service_definition("hermes", &["foundation", "dashboard"]),
        ])
        .unwrap();

        assert_eq!(
            registry
                .service_ids_in_dependency_order()
                .collect::<Vec<_>>(),
            manifest_order
        );
    }

    #[test]
    fn dependency_order_reuses_cycle_rejection() {
        assert!(matches!(
            registry_with_services(vec![
                service_definition("service-a", &["service-b"]),
                service_definition("service-b", &["service-a"]),
            ]),
            Err(RegistryError::DependencyCycle(_))
        ));
    }

    #[test]
    fn registry_rejects_worker_cancellation_outside_process_owner_bounds() {
        let worker = registry().worker("learn-node").unwrap().clone();
        for graceful_cancellation_ms in [99, 300_001] {
            let mut invalid = worker.clone();
            invalid.graceful_cancellation_ms = graceful_cancellation_ms;
            assert!(matches!(
                Registry::new(
                    WorkerManifest {
                        version: WORKER_MANIFEST_VERSION,
                        workers: vec![invalid],
                    },
                    ServiceManifest {
                        version: SERVICE_MANIFEST_VERSION,
                        services: vec![],
                    },
                    RuntimeMode::Lean,
                ),
                Err(RegistryError::InvalidWorkerProcessLimits(kind)) if kind == "learn-node"
            ));
        }
    }

    #[test]
    fn registry_rejects_service_shutdown_outside_process_owner_bounds() {
        let service = registry().service("dashboard").unwrap().clone();
        for graceful_shutdown_ms in [99, 300_001] {
            let mut invalid = service.clone();
            invalid.graceful_shutdown_ms = graceful_shutdown_ms;
            assert!(matches!(
                Registry::new(
                    WorkerManifest {
                        version: WORKER_MANIFEST_VERSION,
                        workers: vec![],
                    },
                    ServiceManifest {
                        version: SERVICE_MANIFEST_VERSION,
                        services: vec![invalid],
                    },
                    RuntimeMode::Lean,
                ),
                Err(RegistryError::InvalidServiceProcessLimits(id)) if id == "dashboard"
            ));
        }
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
    fn opaque_worker_launch_material_is_registry_and_data_root_bound() {
        let directory = tempdir().unwrap();
        let paths = runtime_paths(&directory);
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime-root");
        fs::create_dir_all(app.join("workers")).unwrap();
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::create_dir_all(runtime.join("node")).unwrap();
        fs::write(
            runtime.join("bin/runtime-supervisor.exe"),
            b"trusted supervisor",
        )
        .unwrap();
        fs::write(runtime.join("node/node.exe"), b"trusted executable").unwrap();
        fs::write(app.join("workers/learn.js"), b"trusted entrypoint").unwrap();

        let request = registry()
            .prepare_worker_launch(
                &paths,
                "learn-node",
                crate::TrustedWorkerEnvironment::minimal_for_test(),
            )
            .unwrap();
        assert_eq!(request.worker_kind(), "learn-node");
        assert_eq!(request.generation_scope(), paths.runtime_generation_scope());
        assert_eq!(
            request.limits_for_test(),
            ProcessOwnerLimits {
                soft_commit_bytes: 256 * MEBIBYTE_BYTES,
                hard_commit_bytes: 512 * MEBIBYTE_BYTES,
                graceful_shutdown: Duration::from_secs(10),
                supervisor_exit_timeout: WORKER_SUPERVISOR_EXIT_TIMEOUT,
                system_commit_guard: Some(
                    ProcessOwnerSystemCommitGuard::development(
                        128 * MEBIBYTE_BYTES,
                        DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB * MEBIBYTE_BYTES,
                    )
                    .unwrap(),
                ),
            }
        );
        assert!(matches!(
            registry().prepare_worker_launch(
                &paths,
                "caller-selected-worker",
                crate::TrustedWorkerEnvironment::minimal_for_test(),
            ),
            Err(RegistryError::UnknownWorker(kind)) if kind == "caller-selected-worker"
        ));
    }

    #[test]
    fn service_launch_material_is_mode_selected_pinned_and_registry_scoped() {
        let directory = tempdir().unwrap();
        let paths = runtime_paths(&directory);
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime-root");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::create_dir_all(runtime.join("services")).unwrap();
        fs::create_dir_all(app.join("services")).unwrap();
        fs::write(runtime.join("bin/runtime-supervisor.exe"), b"supervisor").unwrap();
        fs::write(runtime.join("services/search.exe"), b"service executable").unwrap();
        fs::write(app.join("services/search.mjs"), b"service entrypoint").unwrap();
        let registry = registry();
        let environments = trusted_environment_source(&directory, &paths, RuntimeMode::Lean);
        let request = registry
            .prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "dashboard",
                43_121,
                launch_environment(&environments, TrustedServiceEnvironmentProfile::Dashboard),
                None,
            )
            .unwrap();

        assert_eq!(request.service_id_for_test(), "dashboard");
        assert_eq!(request.generation_scope(), paths.runtime_generation_scope());
        let expected_entrypoint = paths
            .resolve_app("services/search.mjs")
            .unwrap()
            .child_argv_path()
            .unwrap();
        assert_eq!(
            request.arguments_for_test(),
            &[expected_entrypoint.into_os_string()]
        );
        #[cfg(windows)]
        assert!(!request.arguments_for_test()[0]
            .to_string_lossy()
            .starts_with(r"\\?\"));
        let debug = format!("{request:?}");
        assert!(!debug.contains("dashboard"));
        assert!(!debug.contains("search.mjs"));
        assert!(!debug.contains("43121"));
        assert!(!debug.contains(TEST_NEXT_AUTH_SECRET));
        assert_eq!(
            request.limits_for_test(),
            ProcessOwnerLimits {
                soft_commit_bytes: 128 * MEBIBYTE_BYTES,
                hard_commit_bytes: 256 * MEBIBYTE_BYTES,
                graceful_shutdown: Duration::from_secs(2),
                supervisor_exit_timeout: SERVICE_SUPERVISOR_EXIT_TIMEOUT,
                system_commit_guard: Some(
                    ProcessOwnerSystemCommitGuard::development(
                        64 * MEBIBYTE_BYTES,
                        DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB * MEBIBYTE_BYTES,
                    )
                    .unwrap(),
                ),
            }
        );
        assert!(
            !paths.data_root().join("runtime/services").exists(),
            "request construction must not prepare mutable service state"
        );
        assert!(matches!(
            registry.prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "learn-node",
                43_121,
                launch_environment(&environments, TrustedServiceEnvironmentProfile::Dashboard),
                None,
            ),
            Err(RegistryError::UnknownService(id)) if id == "learn-node"
        ));
        assert!(matches!(
            registry.prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "dashboard",
                0,
                launch_environment(&environments, TrustedServiceEnvironmentProfile::Dashboard),
                None,
            ),
            Err(RegistryError::InvalidServicePort(id)) if id == "dashboard"
        ));
        assert!(matches!(
            registry.prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "dashboard",
                43_121,
                launch_environment(&environments, TrustedServiceEnvironmentProfile::Hermes),
                None,
            ),
            Err(RegistryError::ServiceEnvironmentProfileMismatch {
                service_id,
                actual: TrustedServiceEnvironmentProfile::Hermes,
            }) if service_id == "dashboard"
        ));
        let hot_environments = trusted_environment_source(&directory, &paths, RuntimeMode::Hot);
        assert!(matches!(
            registry.prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "dashboard",
                43_121,
                launch_environment(
                    &hot_environments,
                    TrustedServiceEnvironmentProfile::Dashboard,
                ),
                None,
            ),
            Err(RegistryError::ServiceEnvironmentModeMismatch {
                service_id,
                actual: RuntimeMode::Hot,
            }) if service_id == "dashboard"
        ));

        let mut wrong_source_service = registry.service("dashboard").unwrap().clone();
        wrong_source_service.launch_profiles[0].environment_source =
            TrustedServiceEnvironmentSource::Hermes;
        let wrong_source_registry = Registry::new(
            WorkerManifest {
                version: WORKER_MANIFEST_VERSION,
                workers: vec![],
            },
            ServiceManifest {
                version: SERVICE_MANIFEST_VERSION,
                services: vec![wrong_source_service],
            },
            RuntimeMode::Lean,
        )
        .unwrap();
        assert!(matches!(
            wrong_source_registry.prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "dashboard",
                43_121,
                launch_environment(&environments, TrustedServiceEnvironmentProfile::Dashboard),
                None,
            ),
            Err(RegistryError::ServiceEnvironmentSourceMismatch {
                service_id,
                expected: TrustedServiceEnvironmentSource::Hermes,
                actual: TrustedServiceEnvironmentSource::Dashboard,
            }) if service_id == "dashboard"
        ));
    }

    #[test]
    fn hot_workspace_uses_app_source_normally_and_isolated_data_only_for_distinct_roots() {
        for (isolated, isolated_workspace_present) in [(false, false), (true, true), (true, false)]
        {
            let directory = tempdir().unwrap();
            let app = directory.path().join("app");
            let data = if isolated {
                directory.path().join("data")
            } else {
                app.clone()
            };
            let runtime = directory.path().join("runtime-root");
            fs::create_dir_all(app.join("services")).unwrap();
            fs::create_dir_all(app.join("dashboard")).unwrap();
            fs::create_dir_all(&data).unwrap();
            if isolated_workspace_present {
                fs::create_dir_all(data.join("dashboard-workspace")).unwrap();
            }
            fs::create_dir_all(runtime.join("bin")).unwrap();
            fs::create_dir_all(runtime.join("services")).unwrap();
            fs::write(runtime.join("bin/runtime-supervisor.exe"), b"supervisor").unwrap();
            fs::write(runtime.join("services/search.exe"), b"service executable").unwrap();
            fs::write(app.join("services/search.mjs"), b"service entrypoint").unwrap();

            let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
            assert_eq!(paths.has_distinct_data_root(), isolated);
            let mut service = service_definition("dashboard", &[]);
            let mut ordinary = service.launch_profiles.remove(0);
            ordinary.modes = vec![RuntimeMode::Lean, RuntimeMode::Packaged];
            let mut hot = ordinary.clone();
            hot.modes = vec![RuntimeMode::Hot];
            hot.working_directory = ServiceWorkingDirectoryPolicy::HotDevelopmentWorkspace {
                app_path: "dashboard".into(),
                isolated_data_path: "dashboard-workspace".into(),
            };
            service.launch_profiles = vec![ordinary, hot];
            let registry = Registry::new(
                WorkerManifest {
                    version: WORKER_MANIFEST_VERSION,
                    workers: Vec::new(),
                },
                ServiceManifest {
                    version: SERVICE_MANIFEST_VERSION,
                    services: vec![service],
                },
                RuntimeMode::Hot,
            )
            .unwrap();
            let environments = trusted_environment_source(&directory, &paths, RuntimeMode::Hot);
            let request = registry.prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "dashboard",
                43_121,
                launch_environment(&environments, TrustedServiceEnvironmentProfile::Dashboard),
                None,
            );
            if isolated && !isolated_workspace_present {
                assert!(matches!(request, Err(RegistryError::Path(_))));
                continue;
            }
            let request = request.unwrap();
            let expected = if isolated {
                paths.data_root().join("dashboard-workspace")
            } else {
                paths.app_root().join("dashboard")
            };
            assert_eq!(request.working_directory_for_test(), expected);
        }
    }

    #[test]
    fn service_launch_accepts_only_the_fixed_pinned_data_root_executable_profile() {
        let directory = tempdir().unwrap();
        let paths = runtime_paths(&directory);
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime-root");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::create_dir_all(app.join("comfyui")).unwrap();
        fs::create_dir_all(directory.path().join("runtime/comfyui-venv/Scripts")).unwrap();
        fs::create_dir_all(directory.path().join("comfyui")).unwrap();
        fs::write(runtime.join("bin/runtime-supervisor.exe"), b"supervisor").unwrap();
        fs::write(app.join("comfyui/main.py"), b"entrypoint").unwrap();
        fs::write(
            directory
                .path()
                .join("runtime/comfyui-venv/Scripts/python.exe"),
            b"interpreter",
        )
        .unwrap();

        let mut service = service_definition("comfyui", &[]);
        service.launch_profiles = vec![ServiceLaunchProfile {
            modes: vec![RuntimeMode::Lean, RuntimeMode::Hot, RuntimeMode::Packaged],
            executable_authority: ServiceExecutableAuthority::DataRoot,
            allowed_executable: "runtime/comfyui-venv/Scripts/python.exe".into(),
            arguments: vec![
                ServiceLaunchArgument::AppPath {
                    path: "comfyui/main.py".into(),
                },
                ServiceLaunchArgument::DataPath {
                    path: "comfyui".into(),
                },
                ServiceLaunchArgument::Literal {
                    value: r"\\?\C:\must-remain-literal".into(),
                },
            ],
            environment_source: TrustedServiceEnvironmentSource::Comfyui,
            working_directory: ServiceWorkingDirectoryPolicy::AppRoot,
            install_probe: ServiceInstallProbe::FilesPresent {
                files: vec![
                    ServiceInstallProbeFile {
                        authority: ServiceInstallProbeAuthority::DataRoot,
                        path: "runtime/comfyui-venv/Scripts/python.exe".into(),
                    },
                    ServiceInstallProbeFile {
                        authority: ServiceInstallProbeAuthority::AppRoot,
                        path: "comfyui/main.py".into(),
                    },
                ],
            },
            resource_limits: ServiceResourceLimits {
                estimated_cold_start_commit_mb: 64,
                soft_commit_limit_mb: 128,
                hard_commit_limit_mb: 256,
            },
        }];
        let registry = registry_with_services(vec![service]).unwrap();
        let environments = trusted_environment_source(&directory, &paths, RuntimeMode::Lean);
        let environment = environments
            .prepare_for_launch_profile(
                "comfyui",
                registry
                    .service("comfyui")
                    .unwrap()
                    .launch_profile(RuntimeMode::Lean)
                    .unwrap(),
            )
            .unwrap();
        let request = registry
            .prepare_service_launch(
                &paths,
                &scheduler_authority(&paths),
                "comfyui",
                43_123,
                environment,
                None,
            )
            .unwrap();
        let expected_app_path = paths
            .resolve_app("comfyui/main.py")
            .unwrap()
            .child_argv_path()
            .unwrap()
            .into_os_string();
        let expected_data_path = paths
            .resolve_data("comfyui")
            .unwrap()
            .child_argv_path()
            .unwrap()
            .into_os_string();
        assert_eq!(
            request.arguments_for_test(),
            &[
                expected_app_path,
                expected_data_path,
                OsString::from(r"\\?\C:\must-remain-literal"),
            ]
        );
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
    fn tombstoned_document_submission_is_never_queued_and_cleans_every_input_copy() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let registry = registry();
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let bytes = b"cancelled before submission";
        let upload_id = seal_document_input(&store, &paths, &context, bytes);
        store
            .cancel_job_by_idempotency_key(&context, "document-cancelled")
            .unwrap();

        let cancelled = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &document_request("document-cancelled", &upload_id),
            )
            .unwrap();
        assert_eq!(
            cancelled.state,
            breadboard_runtime_protocol::JobState::Cancelled
        );
        assert_eq!(cancelled.attempt, 0);
        assert!(store.queued_admission_candidates(1).unwrap().is_empty());
        assert!(!paths
            .data_root()
            .join(format!("runtime/uploads/{upload_id}/payload"))
            .exists());
        let blob_id = format!("blob_0_{:x}", Sha256::digest(bytes));
        assert!(!paths
            .data_root()
            .join(format!(
                "runtime/jobs/{}/inputs/{blob_id}/payload",
                cancelled.job_id
            ))
            .exists());

        let redundant_upload = seal_document_input(&store, &paths, &context, bytes);
        let replay = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &document_request("document-cancelled", &redundant_upload),
            )
            .unwrap();
        assert_eq!(replay, cancelled);
        assert!(!paths
            .data_root()
            .join(format!("runtime/uploads/{redundant_upload}/payload"))
            .exists());
    }

    #[test]
    fn scoped_tombstone_closes_owner_key_collision_without_touching_sibling_job_or_input() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let registry = registry();
        let sibling_context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-2"), None).unwrap();
        let sibling_request = JobSubmissionPayload {
            job_type: "learn".into(),
            garden_id: Some("garden-2".into()),
            conversation_id: None,
            idempotency_key: "scoped-collision".into(),
            input_uploads: Vec::new(),
            request_payload: serde_json::json!({"source": "sibling"}),
        };
        let sibling = registry
            .submit_job(&store, &paths, &sibling_context, &sibling_request)
            .unwrap();

        let target_context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        store
            .cancel_job_by_idempotency_key(&target_context, "scoped-collision")
            .unwrap();
        let upload_id =
            seal_document_input(&store, &paths, &target_context, b"scope collision payload");
        assert!(matches!(
            registry.submit_job(
                &store,
                &paths,
                &target_context,
                &document_request("scoped-collision", &upload_id),
            ),
            Err(RegistryError::Store(StoreError::CancelledBeforeSubmission(key)))
                if key == "scoped-collision"
        ));
        assert_eq!(
            store.get(&sibling_context, &sibling.job_id).unwrap().state,
            breadboard_runtime_protocol::JobState::Queued
        );
        assert!(!paths
            .data_root()
            .join(format!("runtime/uploads/{upload_id}/payload"))
            .exists());
    }

    #[test]
    fn equivalent_fresh_upload_replays_and_cleans_only_the_redundant_ticket() {
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let registry = registry();
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let bytes = b"semantic document bytes";
        let first_upload = seal_document_input(&store, &paths, &context, bytes);
        let first = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &document_request("document-replay", &first_upload),
            )
            .unwrap();
        let redundant_upload = seal_document_input(&store, &paths, &context, bytes);
        let replay = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &document_request("document-replay", &redundant_upload),
            )
            .unwrap();
        assert_eq!(replay.job_id, first.job_id);
        assert!(paths
            .data_root()
            .join(format!("runtime/uploads/{first_upload}/payload"))
            .exists());
        assert!(!paths
            .data_root()
            .join(format!("runtime/uploads/{redundant_upload}/payload"))
            .exists());
        assert!(store
            .resolve_job_input_uploads(
                &paths,
                &context,
                &[RuntimeJobInputUploadReference {
                    upload_id: first_upload.clone(),
                }],
            )
            .is_ok());
        assert!(matches!(
            store.resolve_job_input_uploads(
                &paths,
                &context,
                &[RuntimeJobInputUploadReference {
                    upload_id: redundant_upload,
                }],
            ),
            Err(StoreError::InputUploadState { state, .. }) if state == "abandoned"
        ));
        let blob_id = format!("blob_0_{:x}", Sha256::digest(bytes));
        assert!(paths
            .data_root()
            .join(format!(
                "runtime/jobs/{}/inputs/{blob_id}/payload",
                first.job_id
            ))
            .exists());

        let different_upload = seal_document_input(&store, &paths, &context, b"different bytes");
        assert!(matches!(
            registry.submit_job(
                &store,
                &paths,
                &context,
                &document_request("document-replay", &different_upload),
            ),
            Err(RegistryError::Store(StoreError::IdempotencyConflict { .. }))
        ));
    }

    #[test]
    fn concurrent_equivalent_fresh_uploads_commit_once_and_clean_the_loser() {
        let directory = tempdir().unwrap();
        let store = Arc::new(JobStore::open(directory.path().join("runtime.sqlite3")).unwrap());
        let paths = Arc::new(runtime_paths(&directory));
        let registry = Arc::new(registry());
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let bytes = b"concurrent semantic bytes";
        let uploads = [
            seal_document_input(&store, &paths, &context, bytes),
            seal_document_input(&store, &paths, &context, bytes),
        ];
        let barrier = Arc::new(Barrier::new(2));
        let handles = uploads
            .iter()
            .cloned()
            .map(|upload_id| {
                let store = Arc::clone(&store);
                let paths = Arc::clone(&paths);
                let registry = Arc::clone(&registry);
                let context = context.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    registry.submit_job(
                        &store,
                        &paths,
                        &context,
                        &document_request("document-concurrent", &upload_id),
                    )
                })
            })
            .collect::<Vec<_>>();
        let jobs = handles
            .into_iter()
            .map(|handle| handle.join().unwrap().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(jobs[0].job_id, jobs[1].job_id);
        let surviving_uploads = uploads
            .iter()
            .filter(|upload_id| {
                paths
                    .data_root()
                    .join(format!("runtime/uploads/{upload_id}/payload"))
                    .exists()
            })
            .count();
        assert_eq!(surviving_uploads, 1);
        let blob_id = format!("blob_0_{:x}", Sha256::digest(bytes));
        let input_root = paths
            .data_root()
            .join(format!("runtime/jobs/{}/inputs", jobs[0].job_id));
        assert_eq!(fs::read_dir(&input_root).unwrap().count(), 1);
        assert_eq!(
            fs::read(input_root.join(blob_id).join("payload")).unwrap(),
            bytes
        );
    }

    #[test]
    fn idempotent_replay_does_not_require_restaging_an_existing_job_input() {
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

        let replay = registry
            .submit_job(&store, &paths, &context, &request)
            .unwrap();
        assert_eq!(replay.job_id, first.job_id);
        assert_eq!(
            fs::read(directory.path().join(&first.input_manifest_path)).unwrap(),
            br#"{"a":2}"#
        );
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

    #[test]
    fn gbrain_sync_always_holds_its_manifest_declared_service_dependency() {
        let workers = breadboard_runtime_protocol::parse_worker_manifest(include_bytes!(
            "../../../desktop/runtime-v2/manifests/workers.json"
        ))
        .unwrap();
        let services = breadboard_runtime_protocol::parse_service_manifest(include_bytes!(
            "../../../desktop/runtime-v2/manifests/services.json"
        ))
        .unwrap();
        let registry = Registry::new(workers, services, RuntimeMode::Lean).unwrap();
        let directory = tempdir().unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        let paths = runtime_paths(&directory);
        let context =
            AuthenticatedJobContext::for_verified_user(7, Some("garden-one"), None).unwrap();
        let job = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &JobSubmissionPayload {
                    job_type: "gbrain-sync".into(),
                    garden_id: Some("garden-one".into()),
                    conversation_id: None,
                    idempotency_key: "gbrain-sync-v2:queue:44".into(),
                    input_uploads: Vec::new(),
                    request_payload: serde_json::json!({
                        "protocolVersion": 1,
                        "operation": "sync-garden",
                        "clusterId": 12,
                        "queueJobId": 44
                    }),
                },
            )
            .unwrap();

        let gbrain_dependencies = registry
            .required_service_dependency_admissions_for_job(&store, &job.job_id, "gbrain-sync-node")
            .unwrap();
        assert_eq!(gbrain_dependencies.len(), 1);
        assert_eq!(gbrain_dependencies[0].job_id(), job.job_id);
        assert_eq!(gbrain_dependencies[0].service_id(), "gbrain");
        let debug = format!("{:?}", gbrain_dependencies[0]);
        assert!(!debug.contains(&job.job_id));
        assert!(!debug.contains("gbrain-sync-node"));
        assert!(!debug.contains("service_id"));

        let user_context = AuthenticatedJobContext::for_verified_user(7, None, None).unwrap();
        let hyperframes = registry
            .submit_job(
                &store,
                &paths,
                &user_context,
                &JobSubmissionPayload {
                    job_type: "hyperframes-run".into(),
                    garden_id: None,
                    conversation_id: None,
                    idempotency_key: "outer-hyperframes-v2:test".into(),
                    input_uploads: Vec::new(),
                    request_payload: serde_json::json!({"protocolVersion": 1}),
                },
            )
            .unwrap();
        let hyperframes_dependencies = registry
            .required_service_dependency_admissions_for_job(
                &store,
                &hyperframes.job_id,
                "outer-hyperframes-node",
            )
            .unwrap();
        assert_eq!(hyperframes_dependencies.len(), 1);
        assert_eq!(hyperframes_dependencies[0].job_id(), hyperframes.job_id);
        assert_eq!(hyperframes_dependencies[0].service_id(), "chatmock");
    }

    #[test]
    fn meeting_notes_dependencies_are_derived_only_from_the_closed_request_shape() {
        let request = |engine: &str, source_kind: &str, transcript_only: bool| {
            serde_json::json!({
                "engine": engine,
                "source": { "kind": source_kind },
                "request": { "transcriptOnly": transcript_only }
            })
        };
        let scriberr = request("scriberr", "audio", false);
        assert!(worker_dependency_condition_matches_request(
            WorkerServiceDependencyCondition::MeetingNotesEngineScriberr,
            &scriberr,
        ));
        assert!(!worker_dependency_condition_matches_request(
            WorkerServiceDependencyCondition::MeetingNotesEngineVoicebox,
            &scriberr,
        ));
        assert!(worker_dependency_condition_matches_request(
            WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock,
            &scriberr,
        ));

        let voicebox_transcript_only = request("voicebox", "audio", true);
        assert!(worker_dependency_condition_matches_request(
            WorkerServiceDependencyCondition::MeetingNotesEngineVoicebox,
            &voicebox_transcript_only,
        ));
        assert!(!worker_dependency_condition_matches_request(
            WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock,
            &voicebox_transcript_only,
        ));

        for no_model in [
            request("none", "audio", false),
            request("none", "error", false),
        ] {
            assert!(!worker_dependency_condition_matches_request(
                WorkerServiceDependencyCondition::MeetingNotesEngineScriberr,
                &no_model,
            ));
            assert!(!worker_dependency_condition_matches_request(
                WorkerServiceDependencyCondition::MeetingNotesEngineVoicebox,
                &no_model,
            ));
            assert!(!worker_dependency_condition_matches_request(
                WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock,
                &no_model,
            ));
        }
        assert!(worker_dependency_condition_matches_request(
            WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock,
            &request("none", "transcript", false),
        ));
    }
}
