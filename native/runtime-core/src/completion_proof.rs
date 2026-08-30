use crate::paths::{PathError, RuntimePaths, TrustedFilePin};
use crate::process_owner::{AuthoritativeProcessOwner, ProcessTreeAccounting};
use crate::store::{ValidatedWorkerResult, WorkerCompletionIntent};
use crate::RuntimeGenerationScope;
use breadboard_runtime_protocol::{WorkerIdentity, WIRE_PROTOCOL_VERSION};
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fmt;
use thiserror::Error;

/// Result files carry metadata only; documents and artifacts remain path-based
/// outside this bounded envelope.
pub const MAX_DURABLE_WORKER_RESULT_BYTES: usize = 1024 * 1024;
const MAX_RESULT_NODES: usize = 16_384;
const MAX_RESULT_DEPTH: usize = 64;
const MAX_RESULT_KEY_BYTES: usize = 256;

#[derive(Debug, Error)]
pub enum CompletionProofError {
    #[error(transparent)]
    Path(#[from] PathError),
    #[error("worker completion intent did not name its exact trusted result path")]
    IntentPathMismatch,
    #[error("durable worker result is empty")]
    EmptyResult,
    #[error("durable worker result is not a valid bounded result envelope")]
    InvalidEnvelope,
    #[error("durable worker result protocol version is unsupported")]
    UnsupportedProtocol,
    #[error("durable worker result fencing identity does not match completion intent")]
    StaleIdentity,
    #[error("process-owner fencing identity does not match completion intent")]
    OwnerFenceMismatch,
    #[error("process-owner completion authority belongs to another Runtime V2 data root")]
    GenerationScopeMismatch,
    #[error("durable worker result sequence does not match completion intent")]
    StaleCompletionSequence,
    #[error("durable worker result payload exceeds structural limits")]
    InvalidResultShape,
    #[error("durable worker result changed after authoritative validation")]
    ResultChanged,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DurableWorkerResultEnvelope {
    protocol_version: u32,
    identity: WorkerIdentity,
    completion_sequence: u64,
    // Outer-agent and cinema workers call their bounded projection `run`.
    // It is the same trusted payload position as the canonical `result`; the
    // alias preserves the exact four-field envelope while allowing those
    // established workers to produce completion proof instead of being
    // downgraded after a successful zero-code exit.
    #[serde(alias = "run")]
    result: Map<String, Value>,
}

/// Opaque evidence that the authoritative process owner observed complete tree
/// exit and then reopened, fenced, structurally validated, and hashed the exact
/// durable result through `RuntimePaths`. There is deliberately no public
/// constructor and the type is neither serializable nor deserializable.
pub struct WorkerCompletionProof {
    generation_scope: RuntimeGenerationScope,
    identity: WorkerIdentity,
    completion_sequence: u64,
    result: ValidatedWorkerResult,
    result_file: CompletionResultFileAuthority,
    supervisor_pid: u32,
    root_pid: u32,
    accounting: ProcessTreeAccounting,
}

enum CompletionResultFileAuthority {
    Pinned(Box<TrustedFilePin>),
    #[cfg(test)]
    Test {
        valid: bool,
    },
}

impl AuthoritativeProcessOwner {
    /// This capability is available only after an ordinary zero-code target
    /// exit with zero resident processes and complete accounting. Result
    /// validation intentionally follows that observation, so cancellation,
    /// resource exhaustion, supervisor failure, or a live worker cannot publish
    /// success or mutate bytes after the trusted reopen. Borrowing preserves the
    /// owner capability so a validation failure can be converted back into a
    /// zero-resident release receipt instead of stranding the reservation.
    pub fn prove_completion_after_tree_exit(
        &self,
        paths: &RuntimePaths,
        intent: &WorkerCompletionIntent,
    ) -> Result<WorkerCompletionProof, CompletionProofError> {
        let generation_scope = paths.runtime_generation_scope();
        if !self.matches_generation_scope(&generation_scope) {
            return Err(CompletionProofError::GenerationScopeMismatch);
        }
        if !owner_fence_matches_intent(self.worker_identity(), intent) {
            return Err(CompletionProofError::OwnerFenceMismatch);
        }
        WorkerCompletionProof::validate_after_authoritative_tree_exit(
            paths,
            intent,
            self.supervisor_pid(),
            self.root_pid(),
            self.accounting(),
        )
    }
}

fn owner_fence_matches_intent(
    owner_identity: Option<&WorkerIdentity>,
    intent: &WorkerCompletionIntent,
) -> bool {
    owner_identity == Some(intent.identity())
}

impl fmt::Debug for WorkerCompletionProof {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WorkerCompletionProof")
            .field("identity", &self.identity)
            .field("completion_sequence", &self.completion_sequence)
            .field("result", &"<redacted trusted result>")
            .finish()
    }
}

impl WorkerCompletionProof {
    /// This boundary is crate-private so a route, renderer adapter, worker, or
    /// other downstream crate cannot turn caller-supplied metadata into proof.
    /// The core process-owner implementation may call it only after its Windows
    /// Job Object has proved zero residents. Other platforms currently fail
    /// closed before launch because no equally authoritative fallback exists.
    fn validate_after_authoritative_tree_exit(
        paths: &RuntimePaths,
        intent: &WorkerCompletionIntent,
        supervisor_pid: u32,
        root_pid: u32,
        accounting: ProcessTreeAccounting,
    ) -> Result<Self, CompletionProofError> {
        let identity = intent.identity();
        identity
            .validate()
            .map_err(|_| CompletionProofError::StaleIdentity)?;
        let expected = paths.job_paths(&identity.job_id)?;
        if normalize(intent.result_path()) != normalize(&expected.result_relative()) {
            return Err(CompletionProofError::IntentPathMismatch);
        }
        let (result, result_file) = {
            let (bytes, result_file) = paths.read_bounded_data_file_with_pin(
                expected.result(),
                MAX_DURABLE_WORKER_RESULT_BYTES,
            )?;
            if bytes.is_empty() {
                return Err(CompletionProofError::EmptyResult);
            }
            let envelope: DurableWorkerResultEnvelope = serde_json::from_slice(&bytes)
                .map_err(|_| CompletionProofError::InvalidEnvelope)?;
            if envelope.protocol_version != WIRE_PROTOCOL_VERSION {
                return Err(CompletionProofError::UnsupportedProtocol);
            }
            envelope
                .identity
                .validate()
                .map_err(|_| CompletionProofError::StaleIdentity)?;
            if &envelope.identity != identity {
                return Err(CompletionProofError::StaleIdentity);
            }
            if envelope.completion_sequence != intent.sequence() {
                return Err(CompletionProofError::StaleCompletionSequence);
            }
            validate_result_shape(&envelope.result)?;

            let digest = Sha256::digest(&bytes);
            let result = ValidatedWorkerResult::from_trusted_validation(
                expected.result_relative(),
                format!("{digest:x}"),
                bytes.len() as u64,
            )
            .map_err(|_| CompletionProofError::InvalidEnvelope)?;
            (result, result_file)
        };
        let proof = Self {
            generation_scope: paths.runtime_generation_scope(),
            identity: identity.clone(),
            completion_sequence: intent.sequence(),
            result,
            result_file: CompletionResultFileAuthority::Pinned(Box::new(result_file)),
            supervisor_pid,
            root_pid,
            accounting,
        };
        // Re-read the same opened handle after JSON validation. On Windows the
        // live pin also denies write/delete sharing until the proof is dropped;
        // on other platforms this second check detects same-inode mutation.
        proof.revalidate_result_file()?;
        Ok(proof)
    }

    pub(crate) fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    pub(crate) fn completion_sequence(&self) -> u64 {
        self.completion_sequence
    }

    pub(crate) fn result(&self) -> &ValidatedWorkerResult {
        &self.result
    }

    pub(crate) fn terminal_accounting(&self) -> (u32, u32, ProcessTreeAccounting) {
        (self.supervisor_pid, self.root_pid, self.accounting)
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.generation_scope == *scope
    }

    /// Revalidates the exact result handle and its content against the digest
    /// and size captured by this proof. `JobStore` calls this while its success
    /// transaction is open, immediately before the durable state transition.
    pub(crate) fn revalidate_result_file(&self) -> Result<(), CompletionProofError> {
        let bytes = match &self.result_file {
            CompletionResultFileAuthority::Pinned(pin) => {
                pin.read_bounded_revalidated(MAX_DURABLE_WORKER_RESULT_BYTES)?
            }
            #[cfg(test)]
            CompletionResultFileAuthority::Test { valid: true } => return Ok(()),
            #[cfg(test)]
            CompletionResultFileAuthority::Test { valid: false } => {
                return Err(CompletionProofError::ResultChanged)
            }
        };
        if bytes.len() as u64 != self.result.size_bytes()
            || format!("{:x}", Sha256::digest(&bytes)) != self.result.sha256()
        {
            return Err(CompletionProofError::ResultChanged);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        generation_scope: RuntimeGenerationScope,
        identity: WorkerIdentity,
        completion_sequence: u64,
        result_path: impl Into<String>,
    ) -> Self {
        Self {
            generation_scope,
            identity,
            completion_sequence,
            result: ValidatedWorkerResult::from_trusted_validation(result_path, "0".repeat(64), 1)
                .expect("test completion proof result must be valid"),
            result_file: CompletionResultFileAuthority::Test { valid: true },
            supervisor_pid: 7,
            root_pid: 42,
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1),
                complete: true,
            },
        }
    }

    #[cfg(test)]
    pub(crate) fn invalidate_result_file_for_test(&mut self) {
        self.result_file = CompletionResultFileAuthority::Test { valid: false };
    }
}

fn validate_result_shape(result: &Map<String, Value>) -> Result<(), CompletionProofError> {
    let mut remaining = MAX_RESULT_NODES;
    validate_object(result, 0, &mut remaining)
}

fn validate_object(
    object: &Map<String, Value>,
    depth: usize,
    remaining: &mut usize,
) -> Result<(), CompletionProofError> {
    if depth > MAX_RESULT_DEPTH {
        return Err(CompletionProofError::InvalidResultShape);
    }
    for (key, value) in object {
        if key.is_empty() || key.len() > MAX_RESULT_KEY_BYTES || key.chars().any(char::is_control) {
            return Err(CompletionProofError::InvalidResultShape);
        }
        validate_value(value, depth + 1, remaining)?;
    }
    Ok(())
}

fn validate_value(
    value: &Value,
    depth: usize,
    remaining: &mut usize,
) -> Result<(), CompletionProofError> {
    if depth > MAX_RESULT_DEPTH || *remaining == 0 {
        return Err(CompletionProofError::InvalidResultShape);
    }
    *remaining -= 1;
    match value {
        Value::Array(values) => {
            for value in values {
                validate_value(value, depth + 1, remaining)?;
            }
        }
        Value::Object(object) => validate_object(object, depth, remaining)?,
        _ => {}
    }
    Ok(())
}

fn normalize(value: &str) -> String {
    value.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn authority() -> (tempfile::TempDir, RuntimePaths) {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("data")).unwrap();
        fs::create_dir_all(directory.path().join("app")).unwrap();
        fs::create_dir_all(directory.path().join("runtime-root")).unwrap();
        let paths = RuntimePaths::new(
            directory.path().join("data"),
            directory.path().join("app"),
            directory.path().join("runtime-root"),
        )
        .unwrap();
        (directory, paths)
    }

    fn intent() -> WorkerCompletionIntent {
        WorkerCompletionIntent {
            identity: WorkerIdentity {
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: "worker_1".into(),
            },
            sequence: 3,
            result_path: "runtime/jobs/job_1/result.json".into(),
        }
    }

    fn write_result(paths: &RuntimePaths, identity: &WorkerIdentity, sequence: u64) {
        let result = paths.job_paths(&identity.job_id).unwrap();
        fs::create_dir_all(result.result().absolute().parent().unwrap()).unwrap();
        let value = serde_json::json!({
            "protocolVersion": WIRE_PROTOCOL_VERSION,
            "identity": identity,
            "completionSequence": sequence,
            "result": { "artifactCount": 1 }
        });
        File::create(result.result().absolute())
            .unwrap()
            .write_all(serde_json::to_string(&value).unwrap().as_bytes())
            .unwrap();
    }

    #[test]
    fn post_exit_result_validation_binds_handle_read_to_fence_sequence_and_digest() {
        let (_directory, paths) = authority();
        let intent = intent();
        write_result(&paths, intent.identity(), intent.sequence());
        let proof = WorkerCompletionProof::validate_after_authoritative_tree_exit(
            &paths,
            &intent,
            7,
            42,
            ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1024),
                complete: true,
            },
        )
        .unwrap();
        assert_eq!(proof.identity(), intent.identity());
        assert_eq!(proof.completion_sequence(), 3);
        assert_eq!(proof.result().sha256().len(), 64);
        assert!(proof.matches_generation_scope(&paths.runtime_generation_scope()));
        assert_eq!(
            proof.terminal_accounting(),
            (
                7,
                42,
                ProcessTreeAccounting {
                    peak_private_commit_bytes: Some(1024),
                    complete: true,
                }
            )
        );
    }

    #[test]
    fn outer_agent_run_projection_is_a_valid_completion_payload_alias() {
        let (_directory, paths) = authority();
        let intent = intent();
        let result = paths.job_paths(&intent.identity().job_id).unwrap();
        fs::create_dir_all(result.result().absolute().parent().unwrap()).unwrap();
        let value = serde_json::json!({
            "protocolVersion": WIRE_PROTOCOL_VERSION,
            "identity": intent.identity(),
            "completionSequence": intent.sequence(),
            "run": {
                "adapterId": "max-research",
                "status": "completed",
                "events": []
            }
        });
        File::create(result.result().absolute())
            .unwrap()
            .write_all(serde_json::to_string(&value).unwrap().as_bytes())
            .unwrap();

        WorkerCompletionProof::validate_after_authoritative_tree_exit(
            &paths,
            &intent,
            7,
            42,
            ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1024),
                complete: true,
            },
        )
        .unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn completion_proof_pins_result_against_mutation_and_delete_until_drop() {
        let (_directory, paths) = authority();
        let intent = intent();
        write_result(&paths, intent.identity(), intent.sequence());
        let result_path = paths
            .job_paths(&intent.identity().job_id)
            .unwrap()
            .result()
            .absolute()
            .to_path_buf();
        let proof = WorkerCompletionProof::validate_after_authoritative_tree_exit(
            &paths,
            &intent,
            7,
            42,
            ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1024),
                complete: true,
            },
        )
        .unwrap();

        assert!(fs::write(&result_path, b"mutated after proof").is_err());
        assert!(fs::remove_file(&result_path).is_err());
        proof.revalidate_result_file().unwrap();

        drop(proof);
        fs::write(&result_path, b"pin released after durable decision").unwrap();
    }

    #[cfg(not(windows))]
    #[test]
    fn completion_proof_revalidation_detects_same_inode_mutation() {
        let (_directory, paths) = authority();
        let intent = intent();
        write_result(&paths, intent.identity(), intent.sequence());
        let result_path = paths
            .job_paths(&intent.identity().job_id)
            .unwrap()
            .result()
            .absolute()
            .to_path_buf();
        let proof = WorkerCompletionProof::validate_after_authoritative_tree_exit(
            &paths,
            &intent,
            7,
            42,
            ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1024),
                complete: true,
            },
        )
        .unwrap();

        fs::write(&result_path, b"mutated after proof").unwrap();
        assert!(matches!(
            proof.revalidate_result_file(),
            Err(CompletionProofError::ResultChanged)
        ));
    }

    #[test]
    fn stale_result_envelope_cannot_become_completion_proof() {
        let (_directory, paths) = authority();
        let intent = intent();
        write_result(&paths, intent.identity(), intent.sequence() - 1);
        assert!(matches!(
            WorkerCompletionProof::validate_after_authoritative_tree_exit(
                &paths,
                &intent,
                7,
                42,
                ProcessTreeAccounting {
                    peak_private_commit_bytes: Some(1024),
                    complete: true,
                },
            ),
            Err(CompletionProofError::StaleCompletionSequence)
        ));
    }

    #[test]
    fn tree_exit_authority_is_bound_to_the_exact_worker_attempt() {
        let intent = intent();
        assert!(owner_fence_matches_intent(Some(intent.identity()), &intent));
        let stale = WorkerIdentity {
            job_id: intent.identity().job_id.clone(),
            attempt: intent.identity().attempt + 1,
            worker_instance_id: intent.identity().worker_instance_id.clone(),
        };
        assert!(!owner_fence_matches_intent(Some(&stale), &intent));
        assert!(!owner_fence_matches_intent(None, &intent));
    }

    #[test]
    fn completion_owner_refuses_runtime_paths_from_another_data_root() {
        let (_owner_directory, owner_paths) = authority();
        let (_foreign_directory, foreign_paths) = authority();
        assert_ne!(
            owner_paths.runtime_generation_scope(),
            foreign_paths.runtime_generation_scope()
        );
        let intent = intent();
        let owner = AuthoritativeProcessOwner::worker_for_test(
            owner_paths.runtime_generation_scope(),
            intent.identity().clone(),
        );

        assert!(matches!(
            owner.prove_completion_after_tree_exit(&foreign_paths, &intent),
            Err(CompletionProofError::GenerationScopeMismatch)
        ));
        assert!(!foreign_paths
            .data_root()
            .join("runtime/jobs/job_1")
            .exists());
    }
}
