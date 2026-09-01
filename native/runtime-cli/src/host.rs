use crate::bootstrap::{receive_bootstrap, start_parent_stdin_reader, BootstrapError};
use crate::control::{
    BoundControlListener, ControlAuthorities, ControlError, ControlServerConfig, RuntimeJobControl,
    RuntimeServiceControl,
};
use crate::durable_job_control::DurableRuntimeJobControl;
use crate::service_engine::ServiceEngine;
use crate::shutdown::ShutdownCoordinator;
use crate::worker_dispatcher::{WorkerDispatcher, WorkerDispatcherConfig, WorkerDispatcherError};
use breadboard_runtime_core::{
    ControlPlaneAuthority, CurrentGenerationMembership, DashboardControlEnvironment,
    GenerationGuardError, JobStore, PathError, PriorGenerationDrained, Registry, RegistryError,
    RuntimeGenerationGuard, RuntimePaths, TrustedDirectoryPin, MAX_JOB_INPUT_CLEANUP_BATCH,
};
use breadboard_runtime_protocol::{
    parse_service_manifest, parse_worker_manifest, RuntimeBootstrapMessage, RuntimeMode,
    RuntimeReadyMessage, RuntimeServiceStatus, MAX_PROTOCOL_LINE_BYTES, MAX_REQUEST_BODY_BYTES,
    RUNTIME_CONTROL_PROTOCOL_VERSION,
};
use serde::Serialize;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

const WORKER_MANIFEST_PATH: &str = "runtime-v2/manifests/workers.json";
const SERVICE_MANIFEST_PATH: &str = "runtime-v2/manifests/services.json";
const RUNTIME_DATA_DIRECTORY: &str = "runtime-v2";
const RUNTIME_DATABASE_NAME: &str = "runtime-v2.sqlite3";
const TOKEN_BYTES: usize = 32;
const GENERATION_OWNER_WAIT: Duration = Duration::from_secs(30);
const PRIOR_GENERATION_DRAIN_WAIT: Duration = Duration::from_secs(30);

struct EphemeralControlToken(Vec<u8>);

impl EphemeralControlToken {
    fn as_str(&self) -> &str {
        // `generate_control_token` emits lowercase ASCII hex exclusively.
        std::str::from_utf8(&self.0).expect("hex control token must be UTF-8")
    }
}

/// The only control-plane material exposed to a prepared service engine. It
/// is intended solely for the dashboard's server-side environment and carries
/// no lifecycle/shutdown authority.
pub(crate) struct DashboardControlEndpoint<'a> {
    base_url: &'a str,
    control_token: &'a str,
}

impl DashboardControlEndpoint<'_> {
    pub(crate) fn base_url(&self) -> &str {
        self.base_url
    }

    pub(crate) fn control_token(&self) -> &str {
        self.control_token
    }
}

impl std::fmt::Debug for DashboardControlEndpoint<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DashboardControlEndpoint")
            .field("base_url", &self.base_url)
            .field("control_token", &"[REDACTED]")
            .finish()
    }
}

struct PreparedControlPlane {
    listener: BoundControlListener,
    lifecycle_token: EphemeralControlToken,
    dashboard_token: EphemeralControlToken,
    authorities: ControlAuthorities,
}

impl PreparedControlPlane {
    fn bind() -> Result<Self, HostError> {
        let listener = BoundControlListener::bind_ephemeral_loopback()?;
        let lifecycle_token = generate_control_token()?;
        let dashboard_token = generate_control_token()?;
        if lifecycle_token.as_str() == dashboard_token.as_str() {
            return Err(HostError::TokenGeneration);
        }
        let lifecycle_authority = ControlPlaneAuthority::new(lifecycle_token.as_str())
            .map_err(|_| HostError::InvalidControlAuthority)?;
        let dashboard_authority = ControlPlaneAuthority::new(dashboard_token.as_str())
            .map_err(|_| HostError::InvalidControlAuthority)?;
        Ok(Self {
            listener,
            lifecycle_token,
            dashboard_token,
            authorities: ControlAuthorities::new(lifecycle_authority, dashboard_authority),
        })
    }

    fn dashboard_endpoint(&self) -> DashboardControlEndpoint<'_> {
        DashboardControlEndpoint {
            base_url: self.listener.base_url(),
            control_token: self.dashboard_token.as_str(),
        }
    }
}

impl Drop for EphemeralControlToken {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

#[derive(Debug, Error)]
pub(crate) enum HostError {
    #[error(transparent)]
    Bootstrap(#[from] BootstrapError),
    #[error("trusted Runtime V2 path operation failed: {0}")]
    TrustedPath(#[from] PathError),
    #[error("trusted worker manifest is invalid: {0}")]
    WorkerManifest(String),
    #[error("trusted service manifest is invalid: {0}")]
    ServiceManifest(String),
    #[error("trusted Runtime V2 registry is invalid: {0}")]
    Registry(#[from] RegistryError),
    #[error("opening the authoritative Runtime V2 job store failed: {0}")]
    Store(String),
    #[error(transparent)]
    GenerationGuard(#[from] GenerationGuardError),
    #[error("parent disconnected before Runtime V2 became ready")]
    ParentDisconnected,
    #[error("Runtime V2 engine failed: {0}")]
    Engine(&'static str),
    #[error("Runtime V2 engine shutdown failed: {0}")]
    EngineShutdown(String),
    #[error("generating private control authority failed")]
    TokenGeneration,
    #[error("configuring private control authority failed")]
    InvalidControlAuthority,
    #[error(transparent)]
    Control(#[from] ControlError),
    #[error("the authoritative disposable-worker dispatcher failed")]
    WorkerDispatcher(#[source] WorkerDispatcherError),
    #[error("runtime-ready record is invalid: {0}")]
    InvalidReady(String),
    #[error("runtime-ready record exceeds its protocol bound")]
    OversizedReady,
    #[error("writing the private runtime-ready record failed: {0}")]
    ReadyIo(io::Error),
}

impl HostError {
    pub(crate) fn exit_code(&self) -> i32 {
        match self {
            Self::Bootstrap(_) => 64,
            Self::ParentDisconnected => 74,
            _ => 70,
        }
    }
}

struct TrustedRuntimeContext {
    mode: RuntimeMode,
    paths: RuntimePaths,
    config_root: TrustedDirectoryPin,
    _runtime_data_directory: TrustedDirectoryPin,
    // These capabilities are deliberately retained with the host context.
    // The guard owns the process-lifetime generation boundary; membership is
    // the weaker cloneable authority future engine launchers must use.
    _generation_guard: RuntimeGenerationGuard,
    generation_membership: CurrentGenerationMembership,
}

/// A production engine may return only after the real dashboard has proved
/// readiness and every required service state is known.
trait PreparedRuntimeEngine: Sync {
    fn dashboard_url(&self) -> &str;
    /// Returns an already-sanitized in-memory snapshot. Implementations must
    /// not perform health polling, cold-start services, or block on I/O here.
    fn service_statuses(&self) -> Result<Vec<RuntimeServiceStatus>, String>;
    fn service_control(&self) -> &dyn RuntimeServiceControl;
    fn take_worker_environments(
        &self,
    ) -> Result<breadboard_runtime_core::TrustedWorkerEnvironmentSet, String>;
    fn worker_service_dependencies(&self) -> crate::service_engine::WorkerServiceDependencyControl;
    /// Records that the lifecycle bridge has received the ready envelope. The
    /// service engine opens job admission only when every required core
    /// service is ready; a later lifecycle retry can satisfy the same gate.
    fn mark_ready_published(&self) -> Result<(), String>;
    /// Must implement the architecture's bounded graceful/forced drain and
    /// full-tree exit confirmation before returning.
    fn shutdown(&mut self) -> Result<(), String>;
}

trait RuntimeEngine {
    fn prepare(
        &self,
        context: &TrustedRuntimeContext,
        registry: &Registry,
        store: &Arc<JobStore>,
        shutdown: &Arc<ShutdownCoordinator>,
        dashboard_control: DashboardControlEndpoint<'_>,
    ) -> Result<Box<dyn PreparedRuntimeEngine>, HostError>;
}

struct AuthoritativeRuntimeEngine;

impl RuntimeEngine for AuthoritativeRuntimeEngine {
    fn prepare(
        &self,
        context: &TrustedRuntimeContext,
        registry: &Registry,
        store: &Arc<JobStore>,
        shutdown: &Arc<ShutdownCoordinator>,
        dashboard_control: DashboardControlEndpoint<'_>,
    ) -> Result<Box<dyn PreparedRuntimeEngine>, HostError> {
        let dashboard_control = DashboardControlEnvironment::new(
            dashboard_control.base_url(),
            dashboard_control.control_token(),
        )
        .map_err(|_| HostError::Engine("dashboard control environment was rejected"))?;
        let engine = ServiceEngine::prepare(
            context.mode,
            registry,
            store,
            &context.paths,
            &context.config_root,
            context.generation_membership.clone(),
            dashboard_control,
            Arc::clone(shutdown),
        )
        .map_err(|error| {
            eprintln!("breadboard-runtime: service engine preparation detail: {error}");
            HostError::Engine("service engine preparation failed")
        })?;
        Ok(Box::new(engine))
    }
}

impl PreparedRuntimeEngine for ServiceEngine {
    fn dashboard_url(&self) -> &str {
        ServiceEngine::dashboard_url(self)
    }

    fn service_statuses(&self) -> Result<Vec<RuntimeServiceStatus>, String> {
        Ok(ServiceEngine::service_statuses(self))
    }

    fn service_control(&self) -> &dyn RuntimeServiceControl {
        self
    }

    fn take_worker_environments(
        &self,
    ) -> Result<breadboard_runtime_core::TrustedWorkerEnvironmentSet, String> {
        ServiceEngine::take_worker_environments(self).map_err(|error| error.to_string())
    }

    fn worker_service_dependencies(&self) -> crate::service_engine::WorkerServiceDependencyControl {
        ServiceEngine::worker_service_dependencies(self)
    }

    fn mark_ready_published(&self) -> Result<(), String> {
        ServiceEngine::mark_ready_published(self).map_err(|error| error.to_string())
    }

    fn shutdown(&mut self) -> Result<(), String> {
        ServiceEngine::shutdown(self)
    }
}

pub(crate) fn run_authoritative_host() -> Result<(), HostError> {
    let shutdown = Arc::new(ShutdownCoordinator::default());
    let (bootstrap_receiver, _parent_watch) = start_parent_stdin_reader(Arc::clone(&shutdown))?;
    let bootstrap = receive_bootstrap(bootstrap_receiver)?;
    run_after_bootstrap(bootstrap, shutdown, &AuthoritativeRuntimeEngine)
}

fn run_after_bootstrap(
    bootstrap: RuntimeBootstrapMessage,
    shutdown: Arc<ShutdownCoordinator>,
    engine: &dyn RuntimeEngine,
) -> Result<(), HostError> {
    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }
    let RuntimeBootstrapMessage::RuntimeBootstrap {
        mode,
        app_root,
        runtime_root,
        data_root,
        config_root,
        ..
    } = bootstrap;
    let paths = RuntimePaths::new(
        PathBuf::from(data_root),
        PathBuf::from(app_root),
        PathBuf::from(runtime_root),
    )?;
    let generation_scope = paths.runtime_generation_scope();
    let (generation_guard, prior_generation_drained) = RuntimeGenerationGuard::acquire(
        generation_scope.clone(),
        GENERATION_OWNER_WAIT,
        PRIOR_GENERATION_DRAIN_WAIT,
    )?;
    let generation_membership = generation_guard.membership();
    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }
    let config_root =
        TrustedDirectoryPin::pin_existing("configuration", PathBuf::from(config_root))?;

    let workers_path = paths.resolve_runtime(WORKER_MANIFEST_PATH)?;
    let services_path = paths.resolve_runtime(SERVICE_MANIFEST_PATH)?;
    let workers_bytes = paths.read_bounded_runtime_file(&workers_path, MAX_REQUEST_BODY_BYTES)?;
    let services_bytes = paths.read_bounded_runtime_file(&services_path, MAX_REQUEST_BODY_BYTES)?;
    let workers = parse_worker_manifest(&workers_bytes)
        .map_err(|error| HostError::WorkerManifest(error.to_string()))?;
    let services = parse_service_manifest(&services_bytes)
        .map_err(|error| HostError::ServiceManifest(error.to_string()))?;
    let registry = Registry::new(workers, services, mode)?;

    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }
    let runtime_data = paths.prepare_data_directory(RUNTIME_DATA_DIRECTORY)?;
    let database_path =
        paths.resolve_data(&format!("{RUNTIME_DATA_DIRECTORY}/{RUNTIME_DATABASE_NAME}"))?;
    let database_pin = paths.pin_data_file_for_update(&database_path)?;
    let store = Arc::new(
        JobStore::open_authoritative(database_pin, generation_scope)
            .map_err(|error| HostError::Store(error.to_string()))?,
    );
    let context = TrustedRuntimeContext {
        mode,
        paths,
        config_root,
        _runtime_data_directory: runtime_data,
        _generation_guard: generation_guard,
        generation_membership,
    };
    shutdown.attach_store(&store);
    inspect_completion_intents_then_reconcile(&store, &context.paths, prior_generation_drained)?;
    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }

    context.config_root.revalidate()?;
    // The endpoint and both scoped authorities must exist before the service
    // engine launches the dashboard. Only its restricted server-side bearer
    // is handed to the engine; the Electron lifecycle bearer remains here.
    let control = PreparedControlPlane::bind()?;
    let mut prepared = match engine.prepare(
        &context,
        &registry,
        &store,
        &shutdown,
        control.dashboard_endpoint(),
    ) {
        Ok(prepared) => prepared,
        Err(error) => {
            shutdown.request_shutdown();
            return Err(error);
        }
    };
    let worker_environments = prepared
        .take_worker_environments()
        .map_err(|_| HostError::Engine("worker environment authority was unavailable"))?;
    let worker_service_dependencies = prepared.worker_service_dependencies();
    // The dispatcher starts while durable admission is still closed. The
    // service engine has already minted its sealed environment profiles, but
    // no finite job can launch until the ready/admission boundary below.
    let mut dispatcher = match WorkerDispatcher::start(WorkerDispatcherConfig {
        mode: context.mode,
        registry: registry.clone(),
        store: Arc::clone(&store),
        paths: context.paths.clone(),
        generation: context.generation_membership.clone(),
        environments: worker_environments,
        service_dependencies: worker_service_dependencies,
        shutdown: Arc::clone(&shutdown),
    }) {
        Ok(dispatcher) => dispatcher,
        Err(error) => {
            shutdown.request_shutdown();
            let _ = prepared.shutdown();
            return Err(HostError::WorkerDispatcher(error));
        }
    };
    let job_control =
        DurableRuntimeJobControl::new(registry, Arc::clone(&store), context.paths.clone());
    let serve_result = run_prepared_runtime(
        &mut *prepared,
        &shutdown,
        &job_control,
        control,
        context.mode,
    );
    shutdown.request_shutdown();
    let dispatcher_result = dispatcher.shutdown().map_err(HostError::WorkerDispatcher);
    let engine_result = prepared.shutdown().map_err(HostError::EngineShutdown);
    dispatcher_result?;
    serve_result?;
    engine_result
}

/// Performs the read-only completion-intent inspection before the one-shot
/// restart transaction. The previous generation is already drained, so no
/// surviving `AuthoritativeProcessOwner` can mint a completion proof. Merely
/// finding a result path is therefore insufficient: each unvalidated intent
/// is deliberately left for reconciliation to classify as `uncertain`, never
/// confirmed or retried here.
fn inspect_completion_intents_then_reconcile(
    store: &JobStore,
    paths: &RuntimePaths,
    prior_generation_drained: PriorGenerationDrained,
) -> Result<(), HostError> {
    let unvalidated_intents = store
        .pending_worker_completion_intents_for_recovery()
        .map_err(|error| HostError::Store(error.to_string()))?;
    for intent in unvalidated_intents {
        let _inspected_fence = (intent.identity(), intent.sequence(), intent.result_path());
    }
    let (_reconciled_jobs, input_cleanup_authority) = store
        .reconcile_after_runtime_restart(prior_generation_drained)
        .map_err(|error| HostError::Store(error.to_string()))?;
    loop {
        let processed = store
            .reconcile_job_input_uploads_after_restart(
                paths,
                &input_cleanup_authority,
                MAX_JOB_INPUT_CLEANUP_BATCH,
            )
            .map_err(|error| HostError::Store(error.to_string()))?;
        if processed < MAX_JOB_INPUT_CLEANUP_BATCH {
            break;
        }
    }
    Ok(())
}

/// Keeps a successfully prepared engine under one cleanup epilogue. Every
/// error after preparation returns through `run_after_bootstrap`, which closes
/// admission and invokes the engine's bounded shutdown implementation.
fn run_prepared_runtime(
    prepared: &mut dyn PreparedRuntimeEngine,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
    control: PreparedControlPlane,
    mode: RuntimeMode,
) -> Result<(), HostError> {
    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }
    let PreparedControlPlane {
        listener,
        lifecycle_token,
        dashboard_token,
        authorities,
    } = control;
    let services = prepared
        .service_statuses()
        .map_err(|_| HostError::Engine("service status could not be read"))?;
    let dashboard_url = prepared.dashboard_url().to_owned();
    reject_token_exposure(
        lifecycle_token.as_str(),
        dashboard_token.as_str(),
        &dashboard_url,
        &services,
    )?;
    let ready = RuntimeReadyMessage::RuntimeReady {
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        runtime_pid: std::process::id(),
        control_base_url: listener.base_url().to_string(),
        control_token: lifecycle_token.as_str().to_owned(),
        dashboard_url,
        services,
    };

    if let Err(error) = emit_private_ready(ready) {
        shutdown.request_shutdown();
        return Err(error);
    }
    // Retain the bootstrap copies for the serving lifetime so every fresh
    // status snapshot can be checked against both secrets. All copies are
    // erased by their zero-on-drop owners during the common shutdown path.
    prepared
        .mark_ready_published()
        .map_err(|_| HostError::Engine("runtime ready publication could not update admission"))?;

    let prepared_ref: &dyn PreparedRuntimeEngine = prepared;
    listener
        .serve_with_jobs(
            ControlServerConfig {
                authorities: &authorities,
                mode,
                runtime_pid: std::process::id(),
                shutdown,
                job_control,
                service_control: prepared_ref.service_control(),
            },
            || {
                let services = prepared_ref
                    .service_statuses()
                    .map_err(|_| "runtime service status unavailable".to_owned())?;
                reject_token_exposure(
                    lifecycle_token.as_str(),
                    dashboard_token.as_str(),
                    "",
                    &services,
                )
                .map_err(|_| "runtime service status rejected".to_owned())?;
                Ok(services)
            },
        )
        .map_err(HostError::from)
}

fn generate_control_token() -> Result<EphemeralControlToken, HostError> {
    let mut random = [0_u8; TOKEN_BYTES];
    if getrandom::getrandom(&mut random).is_err() {
        random.fill(0);
        return Err(HostError::TokenGeneration);
    }
    let mut token = Vec::with_capacity(TOKEN_BYTES * 2);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for &byte in &random {
        token.push(HEX[usize::from(byte >> 4)]);
        token.push(HEX[usize::from(byte & 0x0f)]);
    }
    random.fill(0);
    Ok(EphemeralControlToken(token))
}

fn reject_token_exposure(
    lifecycle_token: &str,
    dashboard_token: &str,
    dashboard_url: &str,
    services: &[RuntimeServiceStatus],
) -> Result<(), HostError> {
    let exposes_token =
        |value: &str| value.contains(lifecycle_token) || value.contains(dashboard_token);
    if exposes_token(dashboard_url)
        || services.iter().any(|service| {
            exposes_token(&service.id)
                || exposes_token(&service.display_name)
                || service.last_error.as_deref().is_some_and(&exposes_token)
        })
    {
        return Err(HostError::InvalidReady(
            "control authority leaked into public runtime status".into(),
        ));
    }
    Ok(())
}

fn emit_private_ready(value: RuntimeReadyMessage) -> Result<(), HostError> {
    let result = value
        .validate()
        .map_err(|error| HostError::InvalidReady(error.to_string()))
        .and_then(|_| write_private_ready(&value));
    let RuntimeReadyMessage::RuntimeReady { control_token, .. } = value;
    // The long-lived authority keeps its own redacted, zero-on-drop copy. The
    // temporary serialization value is erased immediately after the one ready
    // record for which the contract requires it.
    let mut control_token = control_token.into_bytes();
    control_token.fill(0);
    result
}

fn write_private_ready(value: &impl Serialize) -> Result<(), HostError> {
    let mut line =
        serde_json::to_vec(value).map_err(|error| HostError::InvalidReady(error.to_string()))?;
    line.push(b'\n');
    let result = if line.len() > MAX_PROTOCOL_LINE_BYTES {
        Err(HostError::OversizedReady)
    } else {
        let stdout = io::stdout();
        let mut output = stdout.lock();
        output
            .write_all(&line)
            .and_then(|_| output.flush())
            .map_err(HostError::ReadyIo)
    };
    line.fill(0);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_control_tokens_have_256_bits_encoded_as_ascii_hex() {
        let token = generate_control_token().unwrap();
        assert_eq!(token.as_str().len(), TOKEN_BYTES * 2);
        assert!(token.as_str().bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn dashboard_endpoint_diagnostics_redact_its_restricted_bearer() {
        let endpoint = DashboardControlEndpoint {
            base_url: "http://127.0.0.1:43121",
            control_token: "fedcba9876543210fedcba9876543210",
        };
        let diagnostic = format!("{endpoint:?}");
        assert!(diagnostic.contains("http://127.0.0.1:43121"));
        assert!(diagnostic.contains("[REDACTED]"));
        assert!(!diagnostic.contains(endpoint.control_token()));
    }

    #[test]
    fn public_ready_fields_may_contain_neither_private_bearer() {
        let lifecycle = "0123456789abcdef0123456789abcdef";
        let dashboard = "fedcba9876543210fedcba9876543210";
        assert!(
            reject_token_exposure(lifecycle, dashboard, "http://127.0.0.1:43121", &[],).is_ok()
        );
        assert!(reject_token_exposure(
            lifecycle,
            dashboard,
            &format!("http://127.0.0.1:43121/{lifecycle}"),
            &[],
        )
        .is_err());
        assert!(reject_token_exposure(
            lifecycle,
            dashboard,
            &format!("http://127.0.0.1:43121/{dashboard}"),
            &[],
        )
        .is_err());
        for bearer in [lifecycle, dashboard] {
            let services = vec![RuntimeServiceStatus {
                id: "dashboard".into(),
                display_name: "Dashboard".into(),
                required: true,
                startup_policy: breadboard_runtime_protocol::ServiceStartupPolicy::Eager,
                state: breadboard_runtime_protocol::RuntimeServiceState::Failed,
                last_error: Some(format!("child failure included {bearer}")),
                restarts: 0,
                adopted: false,
            }];
            assert!(reject_token_exposure(lifecycle, dashboard, "", &services).is_err());
        }
    }
}
