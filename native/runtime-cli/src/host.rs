use crate::bootstrap::{receive_bootstrap, start_parent_stdin_reader, BootstrapError};
use crate::control::{BoundControlListener, ControlError, RuntimeJobControl};
use crate::durable_job_control::DurableRuntimeJobControl;
use crate::shutdown::ShutdownCoordinator;
use crate::worker_dispatcher::{WorkerDispatcher, WorkerDispatcherError};
use breadboard_runtime_core::{
    ControlPlaneAuthority, CurrentGenerationMembership, GenerationGuardError, JobStore, PathError,
    PriorGenerationDrained, Registry, RegistryError, RuntimeGenerationGuard, RuntimePaths,
    TrustedDirectoryPin, TrustedFilePin,
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
    #[error("Runtime V2 cannot become ready: {0}")]
    EngineUnavailable(&'static str),
    #[error("Runtime V2 engine failed: {0}")]
    Engine(&'static str),
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
            Self::EngineUnavailable(_) => 78,
            _ => 70,
        }
    }
}

struct TrustedRuntimeContext {
    mode: RuntimeMode,
    paths: RuntimePaths,
    config_root: TrustedDirectoryPin,
    _runtime_data_directory: TrustedDirectoryPin,
    _database_pin: TrustedFilePin,
    // These capabilities are deliberately retained with the host context.
    // The guard owns the process-lifetime generation boundary; membership is
    // the weaker cloneable authority future engine launchers must use.
    _generation_guard: RuntimeGenerationGuard,
    generation_membership: CurrentGenerationMembership,
}

/// A production engine may return only after the real dashboard has proved
/// readiness and every required service state is known. The scaffold has no
/// such implementation, so its production engine always fails before ready.
trait PreparedRuntimeEngine {
    fn dashboard_url(&self) -> &str;
    /// Returns an already-sanitized in-memory snapshot. Implementations must
    /// not perform health polling, cold-start services, or block on I/O here.
    fn service_statuses(&self) -> Result<Vec<RuntimeServiceStatus>, String>;
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
    ) -> Result<Box<dyn PreparedRuntimeEngine>, HostError>;
}

struct UnavailableRuntimeEngine;

impl RuntimeEngine for UnavailableRuntimeEngine {
    fn prepare(
        &self,
        context: &TrustedRuntimeContext,
        _registry: &Registry,
        _store: &Arc<JobStore>,
        _shutdown: &Arc<ShutdownCoordinator>,
    ) -> Result<Box<dyn PreparedRuntimeEngine>, HostError> {
        let _ = (
            &context.mode,
            context.paths.app_root(),
            context.paths.runtime_root(),
            context.config_root.absolute(),
            &context.generation_membership,
        );
        Err(HostError::EngineUnavailable(
            "the real dashboard and service engine are not wired",
        ))
    }
}

pub(crate) fn run_authoritative_host() -> Result<(), HostError> {
    let shutdown = Arc::new(ShutdownCoordinator::default());
    let (bootstrap_receiver, _parent_watch) = start_parent_stdin_reader(Arc::clone(&shutdown))?;
    let bootstrap = receive_bootstrap(bootstrap_receiver)?;
    run_after_bootstrap(bootstrap, shutdown, &UnavailableRuntimeEngine)
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
    let registry = Registry::new(workers, services)?;

    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }
    let runtime_data = paths.prepare_data_directory(RUNTIME_DATA_DIRECTORY)?;
    let database_path =
        paths.resolve_data(&format!("{RUNTIME_DATA_DIRECTORY}/{RUNTIME_DATABASE_NAME}"))?;
    let database_pin = paths.pin_data_file_for_update(&database_path)?;
    let context = TrustedRuntimeContext {
        mode,
        paths,
        config_root,
        _runtime_data_directory: runtime_data,
        _database_pin: database_pin,
        _generation_guard: generation_guard,
        generation_membership,
    };
    let store = Arc::new(
        JobStore::open_authoritative(context._database_pin.absolute(), generation_scope)
            .map_err(|error| HostError::Store(error.to_string()))?,
    );
    shutdown.attach_store(&store);
    inspect_completion_intents_then_reconcile(&store, prior_generation_drained)?;
    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }

    context.config_root.revalidate()?;
    // The dispatcher starts while durable admission is still closed. It can
    // therefore establish its sole ownership thread before readiness without
    // starting user work. `run_prepared_runtime` opens the shared gate only
    // after the real dashboard and required service state have been emitted.
    let mut dispatcher = WorkerDispatcher::start(
        registry.clone(),
        Arc::clone(&store),
        context.paths.clone(),
        context.generation_membership.clone(),
        Arc::clone(&shutdown),
    )
    .map_err(HostError::WorkerDispatcher)?;
    let mut prepared = match engine.prepare(&context, &registry, &store, &shutdown) {
        Ok(prepared) => prepared,
        Err(error) => {
            shutdown.request_shutdown();
            // Admission has never opened on this path. Joining is still
            // mandatory; even if an authority-bearing dispatcher error were
            // returned, the engine error below commits main to process exit
            // and cannot resume this generation.
            let _ = dispatcher.shutdown();
            return Err(error);
        }
    };
    let job_control =
        DurableRuntimeJobControl::new(registry, Arc::clone(&store), context.paths.clone());
    let serve_result = run_prepared_runtime(&mut *prepared, &shutdown, &job_control);
    shutdown.request_shutdown();
    let dispatcher_result = dispatcher.shutdown().map_err(HostError::WorkerDispatcher);
    let engine_result = prepared
        .shutdown()
        .map_err(|_| HostError::Engine("bounded shutdown did not complete"));
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
    prior_generation_drained: PriorGenerationDrained,
) -> Result<(), HostError> {
    let unvalidated_intents = store
        .pending_worker_completion_intents_for_recovery()
        .map_err(|error| HostError::Store(error.to_string()))?;
    for intent in unvalidated_intents {
        let _inspected_fence = (intent.identity(), intent.sequence(), intent.result_path());
    }
    store
        .reconcile_after_runtime_restart(prior_generation_drained)
        .map_err(|error| HostError::Store(error.to_string()))?;
    Ok(())
}

/// Keeps a successfully prepared engine under one cleanup epilogue. Every
/// error after preparation returns through `run_after_bootstrap`, which closes
/// admission and invokes the engine's bounded shutdown implementation.
fn run_prepared_runtime(
    prepared: &mut dyn PreparedRuntimeEngine,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
) -> Result<(), HostError> {
    if shutdown.is_requested() {
        return Err(HostError::ParentDisconnected);
    }
    let listener = BoundControlListener::bind_ephemeral_loopback()?;
    let token = generate_control_token()?;
    let authority = ControlPlaneAuthority::new(token.as_str())
        .map_err(|_| HostError::InvalidControlAuthority)?;
    let services = prepared
        .service_statuses()
        .map_err(|_| HostError::Engine("service status could not be read"))?;
    let dashboard_url = prepared.dashboard_url().to_owned();
    reject_token_exposure(token.as_str(), &dashboard_url, &services)?;
    let ready = RuntimeReadyMessage::RuntimeReady {
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        runtime_pid: std::process::id(),
        control_base_url: listener.base_url().to_string(),
        control_token: token.as_str().to_owned(),
        dashboard_url,
        services,
    };

    if let Err(error) = emit_private_ready(ready) {
        shutdown.request_shutdown();
        return Err(error);
    }
    shutdown
        .open_admission()
        .map_err(|_| HostError::ParentDisconnected)?;

    listener
        .serve_with_jobs(
            &authority,
            std::process::id(),
            shutdown,
            || prepared.service_statuses(),
            job_control,
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
    for byte in random {
        token.push(HEX[usize::from(byte >> 4)]);
        token.push(HEX[usize::from(byte & 0x0f)]);
    }
    random.fill(0);
    Ok(EphemeralControlToken(token))
}

fn reject_token_exposure(
    token: &str,
    dashboard_url: &str,
    services: &[RuntimeServiceStatus],
) -> Result<(), HostError> {
    if dashboard_url.contains(token)
        || services.iter().any(|service| {
            service.id.contains(token)
                || service.display_name.contains(token)
                || service
                    .last_error
                    .as_deref()
                    .is_some_and(|error| error.contains(token))
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
    fn production_engine_fails_closed_instead_of_inventing_dashboard_readiness() {
        assert_eq!(
            HostError::EngineUnavailable("the real dashboard and service engine are not wired")
                .exit_code(),
            78
        );
    }
}
