use crate::{
    AuthenticatedJobContext, InputUploadQuotaScope, JobInputBlobStaging, JobStore, PathError,
    PriorGenerationJobsReconciled, ProcessTreeExit, RuntimePaths, SealedJobInputBlob, StoreError,
    WorkerLaunchNotCreatedCleanup,
};
use breadboard_runtime_protocol::{
    RuntimeJobInputReservationRequest, RuntimeJobInputReservationResponse,
    RuntimeJobInputUploadReference, WorkerInputBlob, MAX_JOB_INPUT_UPLOADS,
    MAX_JOB_INPUT_UPLOAD_BYTES,
};
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use std::io::{self, Write};
use std::time::{SystemTime, UNIX_EPOCH};

pub const JOB_INPUT_UPLOAD_TTL_MS: i64 = 60 * 60 * 1_000;
pub const MAX_JOB_INPUT_CLEANUP_BATCH: usize = 64;
pub const MAX_OWNED_JOB_RESULT_BYTES: usize = 1024 * 1024;
pub const MAX_OWNED_JOB_CHECKPOINT_BYTES: usize = 1024 * 1024;
pub const MAX_UNCLEANED_JOB_INPUT_UPLOADS_PER_OWNER: u64 = 16;
pub const MAX_UNCLEANED_JOB_INPUT_BYTES_PER_OWNER: u64 = 4 * 1024 * 1024 * 1024;
pub const MAX_UNCLEANED_JOB_INPUT_UPLOADS_GLOBAL: u64 = 256;
pub const MAX_UNCLEANED_JOB_INPUT_BYTES_GLOBAL: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedRuntimeJobInputUpload {
    upload_id: String,
    size_bytes: u64,
    sha256: String,
}

impl SealedRuntimeJobInputUpload {
    pub fn upload_id(&self) -> &str {
        &self.upload_id
    }

    pub fn size_bytes(&self) -> u64 {
        self.size_bytes
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// One active, ownership-fenced upload stream. Dropping it before `seal`
/// removes its exact unpublished file and durably abandons only this ticket.
pub struct RuntimeJobInputUploadLease<'a> {
    store: &'a JobStore,
    paths: RuntimePaths,
    context: AuthenticatedJobContext,
    upload_id: String,
    staging: Option<JobInputBlobStaging>,
    terminal: bool,
}

impl std::fmt::Debug for RuntimeJobInputUploadLease<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeJobInputUploadLease")
            .field("authority", &"<opaque ownership-scoped upload>")
            .finish()
    }
}

impl Write for RuntimeJobInputUploadLease<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.staging
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "upload lease is closed"))?
            .write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.staging
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "upload lease is closed"))?
            .flush()
    }
}

impl RuntimeJobInputUploadLease<'_> {
    pub fn upload_id(&self) -> &str {
        &self.upload_id
    }

    pub fn seal(self) -> Result<SealedRuntimeJobInputUpload, StoreError> {
        self.seal_with_post_commit_hook(|| {})
    }

    fn seal_with_post_commit_hook<F>(
        mut self,
        post_commit: F,
    ) -> Result<SealedRuntimeJobInputUpload, StoreError>
    where
        F: FnOnce(),
    {
        let staging = self
            .staging
            .take()
            .ok_or_else(|| StoreError::InputUploadState {
                upload_id: self.upload_id.clone(),
                state: "closed".into(),
            })?;
        let sealed = staging.seal()?;
        let size_bytes = sealed.size();
        let sha256 = sealed.sha256().to_owned();
        let receipt = self.store.finish_job_input_upload_seal(
            &self.context,
            &self.upload_id,
            size_bytes,
            &sha256,
        );
        match receipt {
            Ok(receipt) => {
                post_commit();
                sealed.revalidate()?;
                // Release the Windows no-share-delete pin before checking
                // whether a concurrent abandon won after the durable seal.
                drop(sealed);
                let abandoned = self.store.cleanup_quiesced_job_input_upload(
                    &self.paths,
                    &self.context,
                    &self.upload_id,
                    Some((size_bytes, sha256.as_str())),
                )?;
                self.terminal = true;
                if abandoned {
                    Err(StoreError::InputUploadState {
                        upload_id: self.upload_id.clone(),
                        state: "abandoned".into(),
                    })
                } else {
                    Ok(receipt)
                }
            }
            Err(error) => {
                // Publication preceded the durable compare-and-set. Drop the
                // pin, fence this lease, and remove only the exact bytes this
                // Rust stream just computed. A concurrent abandon therefore
                // cannot leave payload behind after claiming cleanup.
                drop(sealed);
                let _ = self
                    .store
                    .mark_job_input_upload_abandoned(&self.context, &self.upload_id);
                let _ = self.store.cleanup_quiesced_job_input_upload(
                    &self.paths,
                    &self.context,
                    &self.upload_id,
                    Some((size_bytes, sha256.as_str())),
                );
                self.terminal = true;
                Err(error)
            }
        }
    }
}

impl Drop for RuntimeJobInputUploadLease<'_> {
    fn drop(&mut self) {
        if self.terminal {
            return;
        }
        // Drop the writer first so its exact pending handle performs identity-
        // checked cleanup before the durable ticket becomes abandoned.
        drop(self.staging.take());
        let _ = self
            .store
            .mark_job_input_upload_abandoned(&self.context, &self.upload_id);
        let _ = self.store.cleanup_quiesced_job_input_upload(
            &self.paths,
            &self.context,
            &self.upload_id,
            None,
        );
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JobInputBlobBinding {
    pub(crate) ordinal: u32,
    pub(crate) blob_id: String,
    pub(crate) upload_id: String,
    pub(crate) relative_path: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) display_name: String,
    pub(crate) media_type: Option<String>,
}

impl JobInputBlobBinding {
    pub(crate) fn worker_blob(&self) -> WorkerInputBlob {
        WorkerInputBlob {
            blob_id: self.blob_id.clone(),
            relative_path: self.relative_path.clone(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            display_name: self.display_name.clone(),
            media_type: self.media_type.clone(),
        }
    }

    pub(crate) fn semantically_eq(&self, other: &Self) -> bool {
        self.ordinal == other.ordinal
            && self.size_bytes == other.size_bytes
            && self.sha256 == other.sha256
            && self.display_name == other.display_name
            && self.media_type == other.media_type
    }
}

pub(crate) struct ResolvedJobInputUpload {
    binding: JobInputBlobBinding,
    source: Option<SealedJobInputBlob>,
}

impl ResolvedJobInputUpload {
    pub(crate) fn digest_binding(&self) -> JobInputBlobBinding {
        self.binding.clone()
    }

    pub(crate) fn binding_for_job(&self, job_id: &str) -> JobInputBlobBinding {
        let mut binding = self.binding.clone();
        binding.relative_path = format!("runtime/jobs/{job_id}/inputs/{}/payload", binding.blob_id);
        binding
    }
}

pub(crate) struct PreparedJobInputAdoption {
    pub(crate) binding: JobInputBlobBinding,
    _source: SealedJobInputBlob,
    _job_blob: SealedJobInputBlob,
}

impl JobStore {
    pub fn reserve_job_input_upload(
        &self,
        context: &AuthenticatedJobContext,
        request: &RuntimeJobInputReservationRequest,
        maximum_bytes: u64,
    ) -> Result<RuntimeJobInputReservationResponse, StoreError> {
        context.validate()?;
        request.validate()?;
        let admission_gate = self
            .admission_open
            .lock()
            .expect("job admission gate mutex poisoned");
        if self
            .generation_shutdown
            .load(std::sync::atomic::Ordering::Acquire)
            || !*admission_gate
        {
            return Err(StoreError::AdmissionClosed);
        }
        if request.garden_id.as_deref() != context.garden_id() {
            return Err(StoreError::InvalidInput(
                "input upload garden scope did not match authenticated authority".into(),
            ));
        }
        if request.conversation_id.as_deref() != context.conversation_id() {
            return Err(StoreError::InvalidInput(
                "input upload conversation scope did not match authenticated authority".into(),
            ));
        }
        if maximum_bytes == 0
            || maximum_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
            || request.declared_size_bytes > maximum_bytes
        {
            return Err(StoreError::InvalidInput(
                "input upload exceeded the trusted route limit".into(),
            ));
        }
        let now = upload_now_ms();
        let expires_at = now
            .checked_add(JOB_INPUT_UPLOAD_TTL_MS)
            .ok_or_else(|| StoreError::InvalidInput("upload expiry overflowed".into()))?;
        let upload_id = mint_upload_id()?;
        let relative_path = format!("runtime/uploads/{upload_id}/payload");
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let owner_principal = context.owner().principal();
        let (owner_count, owner_bytes): (u64, u64) = transaction.query_row(
            "SELECT COUNT(*), COALESCE(SUM(declared_size_bytes), 0)
             FROM runtime_job_input_uploads
             WHERE owner_principal=?1 AND cleaned_at IS NULL",
            params![owner_principal],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let (global_count, global_bytes): (u64, u64) = transaction.query_row(
            "SELECT COUNT(*), COALESCE(SUM(declared_size_bytes), 0)
             FROM runtime_job_input_uploads WHERE cleaned_at IS NULL",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let owner_quota_exceeded = owner_count
            .checked_add(1)
            .is_none_or(|count| count > MAX_UNCLEANED_JOB_INPUT_UPLOADS_PER_OWNER)
            || owner_bytes
                .checked_add(request.declared_size_bytes)
                .is_none_or(|bytes| bytes > MAX_UNCLEANED_JOB_INPUT_BYTES_PER_OWNER);
        if owner_quota_exceeded {
            return Err(StoreError::InputUploadQuotaExceeded {
                scope: InputUploadQuotaScope::Owner,
            });
        }
        let global_quota_exceeded = global_count
            .checked_add(1)
            .is_none_or(|count| count > MAX_UNCLEANED_JOB_INPUT_UPLOADS_GLOBAL)
            || global_bytes
                .checked_add(request.declared_size_bytes)
                .is_none_or(|bytes| bytes > MAX_UNCLEANED_JOB_INPUT_BYTES_GLOBAL);
        if global_quota_exceeded {
            return Err(StoreError::InputUploadQuotaExceeded {
                scope: InputUploadQuotaScope::Global,
            });
        }
        transaction.execute(
            "INSERT INTO runtime_job_input_uploads (
                upload_id, owner_principal, user_id, garden_id, conversation_id,
                lifecycle_state, display_name, media_type, declared_size_bytes,
                maximum_bytes, relative_path, expires_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![
                upload_id,
                owner_principal,
                context.owner().user_id(),
                context.garden_id(),
                context.conversation_id(),
                request.display_name,
                request.media_type,
                request.declared_size_bytes,
                maximum_bytes,
                relative_path,
                expires_at,
                now,
            ],
        )?;
        transaction.commit()?;
        drop(admission_gate);
        let response = RuntimeJobInputReservationResponse {
            upload_id,
            expires_at,
            maximum_bytes,
        };
        response.validate()?;
        Ok(response)
    }

    pub fn begin_job_input_upload<'a>(
        &'a self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        upload_id: &str,
    ) -> Result<RuntimeJobInputUploadLease<'a>, StoreError> {
        context.validate()?;
        breadboard_runtime_protocol::validate_identifier("uploadId", upload_id)?;
        let (declared_size, maximum_bytes) = {
            let now = upload_now_ms();
            let mut connection = self.connection.lock().expect("job store mutex poisoned");
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let row = query_owned_upload(&transaction, context, upload_id)?;
            if row.expires_at <= now {
                transaction.execute(
                    "UPDATE runtime_job_input_uploads
                     SET lifecycle_state='expired', updated_at=?2, abandoned_at=?2
                     WHERE upload_id=?1 AND lifecycle_state='pending'",
                    params![upload_id, now],
                )?;
                transaction.commit()?;
                return Err(StoreError::InputUploadExpired(upload_id.into()));
            }
            if row.lifecycle_state != "pending" {
                return Err(StoreError::InputUploadState {
                    upload_id: upload_id.into(),
                    state: row.lifecycle_state,
                });
            }
            let changed = transaction.execute(
                "UPDATE runtime_job_input_uploads
                 SET lifecycle_state='uploading', updated_at=?2
                 WHERE upload_id=?1 AND lifecycle_state='pending'",
                params![upload_id, now],
            )?;
            if changed != 1 {
                return Err(StoreError::InputUploadState {
                    upload_id: upload_id.into(),
                    state: "raced".into(),
                });
            }
            transaction.commit()?;
            (row.declared_size_bytes, row.maximum_bytes)
        };

        let staging = match paths.begin_runtime_job_input_upload_staging(
            upload_id,
            declared_size,
            maximum_bytes,
        ) {
            Ok(staging) => staging,
            Err(error) => {
                let _ = self.mark_job_input_upload_abandoned(context, upload_id);
                let _ = self.cleanup_quiesced_job_input_upload(paths, context, upload_id, None);
                return Err(StoreError::Path(error));
            }
        };
        Ok(RuntimeJobInputUploadLease {
            store: self,
            paths: paths.clone(),
            context: context.clone(),
            upload_id: upload_id.into(),
            staging: Some(staging),
            terminal: false,
        })
    }

    pub fn abandon_job_input_upload(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        upload_id: &str,
    ) -> Result<bool, StoreError> {
        let changed = self.mark_job_input_upload_abandoned(context, upload_id)?;
        let row = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            query_owned_upload(&connection, context, upload_id)?
        };
        if matches!(row.lifecycle_state.as_str(), "abandoned" | "expired") {
            match self.cleanup_quiesced_job_input_upload(paths, context, upload_id, None) {
                Ok(_) => {}
                // An active sealing lease can temporarily retain a Windows
                // no-share-delete pin. Durable abandonment still succeeds;
                // the losing lease or restart reconciliation performs the
                // exact cleanup and only then publishes cleaned_at.
                Err(StoreError::Path(PathError::Io(_))) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(changed)
    }

    fn mark_job_input_upload_abandoned(
        &self,
        context: &AuthenticatedJobContext,
        upload_id: &str,
    ) -> Result<bool, StoreError> {
        context.validate()?;
        breadboard_runtime_protocol::validate_identifier("uploadId", upload_id)?;
        let now = upload_now_ms();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row = query_owned_upload(&transaction, context, upload_id)?;
        if matches!(row.lifecycle_state.as_str(), "adopted" | "expired") {
            transaction.commit()?;
            return Ok(false);
        }
        if matches!(row.lifecycle_state.as_str(), "abandoning" | "abandoned") {
            transaction.commit()?;
            return Ok(false);
        }
        let changed = transaction.execute(
            "UPDATE runtime_job_input_uploads
             SET lifecycle_state=CASE lifecycle_state
                    WHEN 'uploading' THEN 'abandoning'
                    ELSE 'abandoned'
                 END,
                 updated_at=?2, abandoned_at=?2
             WHERE upload_id=?1 AND lifecycle_state IN ('pending','uploading','sealed')",
            params![upload_id, now],
        )?;
        transaction.commit()?;
        Ok(changed == 1)
    }

    /// Completes filesystem cleanup only after the stream authority is known
    /// quiescent (lease drop/seal failure), or for states that never had an
    /// active stream. `abandoning` is the durable hand-off between a racing
    /// public abandon and this exact lease/restart cleanup.
    fn cleanup_quiesced_job_input_upload(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        upload_id: &str,
        authoritative_seal: Option<(u64, &str)>,
    ) -> Result<bool, StoreError> {
        let row = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            query_owned_upload(&connection, context, upload_id)?
        };
        if !matches!(
            row.lifecycle_state.as_str(),
            "abandoning" | "abandoned" | "expired"
        ) {
            return Ok(false);
        }
        let expected_size = authoritative_seal
            .map(|(size, _)| size)
            .unwrap_or(row.declared_size_bytes);
        let expected_sha256 = authoritative_seal
            .map(|(_, digest)| digest)
            .or(row.sealed_sha256.as_deref());
        paths.cleanup_runtime_job_input_upload(upload_id, Some(expected_size), expected_sha256)?;
        let cleanup_now = upload_now_ms();
        let connection = self.connection.lock().expect("job store mutex poisoned");
        connection.execute(
            "UPDATE runtime_job_input_uploads
             SET lifecycle_state=CASE WHEN lifecycle_state='abandoning'
                    THEN 'abandoned' ELSE lifecycle_state END,
                 cleaned_at=COALESCE(cleaned_at, ?2), updated_at=?2
             WHERE upload_id=?1
               AND lifecycle_state IN ('abandoning','abandoned','expired')",
            params![upload_id, cleanup_now],
        )?;
        Ok(true)
    }

    fn finish_job_input_upload_seal(
        &self,
        context: &AuthenticatedJobContext,
        upload_id: &str,
        size_bytes: u64,
        sha256: &str,
    ) -> Result<SealedRuntimeJobInputUpload, StoreError> {
        context.validate()?;
        let now = upload_now_ms();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row = query_owned_upload(&transaction, context, upload_id)?;
        if matches!(row.lifecycle_state.as_str(), "sealed" | "adopted")
            && row.sealed_size_bytes == Some(size_bytes)
            && row.sealed_sha256.as_deref() == Some(sha256)
        {
            transaction.commit()?;
            return Ok(SealedRuntimeJobInputUpload {
                upload_id: upload_id.into(),
                size_bytes,
                sha256: sha256.into(),
            });
        }
        if row.lifecycle_state != "uploading" {
            return Err(StoreError::InputUploadState {
                upload_id: upload_id.into(),
                state: row.lifecycle_state,
            });
        }
        if size_bytes != row.declared_size_bytes || size_bytes > row.maximum_bytes {
            return Err(StoreError::InvalidInput(
                "sealed upload metadata contradicted its durable reservation".into(),
            ));
        }
        let changed = transaction.execute(
            "UPDATE runtime_job_input_uploads
             SET lifecycle_state='sealed', sealed_size_bytes=?2, sealed_sha256=?3,
                 sealed_at=?4, updated_at=?4
             WHERE upload_id=?1 AND lifecycle_state='uploading'",
            params![upload_id, size_bytes, sha256, now],
        )?;
        if changed != 1 {
            return Err(StoreError::InputUploadState {
                upload_id: upload_id.into(),
                state: "raced".into(),
            });
        }
        transaction.commit()?;
        Ok(SealedRuntimeJobInputUpload {
            upload_id: upload_id.into(),
            size_bytes,
            sha256: sha256.into(),
        })
    }

    pub(crate) fn resolve_job_input_uploads(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        references: &[RuntimeJobInputUploadReference],
    ) -> Result<Vec<ResolvedJobInputUpload>, StoreError> {
        context.validate()?;
        if references.len() > MAX_JOB_INPUT_UPLOADS {
            return Err(StoreError::InvalidInput("too many input uploads".into()));
        }
        let snapshots = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            references
                .iter()
                .enumerate()
                .map(|(ordinal, reference)| {
                    reference.validate()?;
                    let row = query_owned_upload(&connection, context, &reference.upload_id)?;
                    if row.lifecycle_state == "sealed" && row.expires_at <= upload_now_ms() {
                        return Err(StoreError::InputUploadExpired(reference.upload_id.clone()));
                    }
                    if !matches!(row.lifecycle_state.as_str(), "sealed" | "adopted") {
                        return Err(StoreError::InputUploadState {
                            upload_id: reference.upload_id.clone(),
                            state: row.lifecycle_state,
                        });
                    }
                    if row.lifecycle_state == "adopted" && row.job_id.is_none() {
                        return Err(StoreError::InputUploadState {
                            upload_id: reference.upload_id.clone(),
                            state: "corrupt-adopted".into(),
                        });
                    }
                    let size_bytes =
                        row.sealed_size_bytes
                            .ok_or_else(|| StoreError::InputUploadState {
                                upload_id: reference.upload_id.clone(),
                                state: "corrupt-sealed".into(),
                            })?;
                    let sha256 =
                        row.sealed_sha256
                            .clone()
                            .ok_or_else(|| StoreError::InputUploadState {
                                upload_id: reference.upload_id.clone(),
                                state: "corrupt-sealed".into(),
                            })?;
                    Ok((ordinal, row, size_bytes, sha256))
                })
                .collect::<Result<Vec<_>, StoreError>>()?
        };
        snapshots
            .into_iter()
            .map(|(ordinal, row, size_bytes, sha256)| {
                let source = if row.lifecycle_state == "adopted" && row.cleaned_at.is_some() {
                    None
                } else {
                    Some(paths.pin_runtime_job_input_upload(&row.upload_id, size_bytes, &sha256)?)
                };
                Ok(ResolvedJobInputUpload {
                    binding: JobInputBlobBinding {
                        ordinal: ordinal as u32,
                        blob_id: semantic_blob_id(ordinal as u32, &sha256),
                        upload_id: row.upload_id,
                        relative_path: String::new(),
                        size_bytes,
                        sha256,
                        display_name: row.display_name,
                        media_type: row.media_type,
                    },
                    source,
                })
            })
            .collect()
    }

    pub(crate) fn settle_replayed_resolved_job_inputs(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        job_id: &str,
        uploads: Vec<ResolvedJobInputUpload>,
    ) -> Result<(), StoreError> {
        let bindings = uploads
            .iter()
            .map(|upload| upload.binding.clone())
            .collect::<Vec<_>>();
        drop(uploads);
        self.settle_replayed_job_input_bindings(paths, context, job_id, bindings)
    }

    pub(crate) fn abandon_cancelled_resolved_job_inputs(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        uploads: Vec<ResolvedJobInputUpload>,
    ) -> Result<(), StoreError> {
        let upload_ids = uploads
            .iter()
            .map(|upload| upload.binding.upload_id.clone())
            .collect::<Vec<_>>();
        drop(uploads);
        for upload_id in upload_ids {
            self.abandon_job_input_upload(paths, context, &upload_id)?;
        }
        Ok(())
    }

    pub(crate) fn settle_submitted_job_input_adoptions(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        job_id: &str,
        prepared: Vec<PreparedJobInputAdoption>,
    ) -> Result<(), StoreError> {
        let bindings = prepared
            .iter()
            .map(|input| input.binding.clone())
            .collect::<Vec<_>>();
        drop(prepared);
        self.settle_replayed_job_input_bindings(paths, context, job_id, bindings)
    }

    fn settle_replayed_job_input_bindings(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        job_id: &str,
        incoming: Vec<JobInputBlobBinding>,
    ) -> Result<(), StoreError> {
        context.validate()?;
        breadboard_runtime_protocol::validate_identifier("jobId", job_id)?;
        let now = upload_now_ms();
        let redundant_uploads = {
            let mut connection = self.connection.lock().expect("job store mutex poisoned");
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let adopted = query_job_input_blob_bindings(&transaction, job_id)?;
            if adopted.len() != incoming.len()
                || !adopted
                    .iter()
                    .zip(&incoming)
                    .all(|(adopted, incoming)| adopted.semantically_eq(incoming))
            {
                return Err(StoreError::CorruptState(job_id.into()));
            }
            let mut redundant = Vec::new();
            for (adopted, incoming) in adopted.iter().zip(&incoming) {
                let row = query_owned_upload(&transaction, context, &incoming.upload_id)?;
                if adopted.upload_id == incoming.upload_id {
                    if row.lifecycle_state != "adopted" || row.job_id.as_deref() != Some(job_id) {
                        return Err(StoreError::CorruptState(job_id.into()));
                    }
                    continue;
                }
                if row.job_id.is_some()
                    || !matches!(
                        row.lifecycle_state.as_str(),
                        "sealed" | "abandoned" | "expired"
                    )
                {
                    return Err(StoreError::InputUploadState {
                        upload_id: incoming.upload_id.clone(),
                        state: row.lifecycle_state,
                    });
                }
                if row.lifecycle_state == "sealed" {
                    let changed = transaction.execute(
                        "UPDATE runtime_job_input_uploads
                         SET lifecycle_state='abandoned', updated_at=?2, abandoned_at=?2
                         WHERE upload_id=?1 AND lifecycle_state='sealed' AND job_id IS NULL",
                        params![incoming.upload_id, now],
                    )?;
                    if changed != 1 {
                        return Err(StoreError::InputUploadState {
                            upload_id: incoming.upload_id.clone(),
                            state: "replay-cleanup-raced".into(),
                        });
                    }
                }
                redundant.push(incoming.upload_id.clone());
            }
            transaction.commit()?;
            redundant
        };
        for upload_id in redundant_uploads {
            self.cleanup_quiesced_job_input_upload(paths, context, &upload_id, None)?;
        }
        Ok(())
    }

    pub(crate) fn prepare_job_input_adoptions(
        &self,
        paths: &RuntimePaths,
        job_id: &str,
        uploads: Vec<ResolvedJobInputUpload>,
    ) -> Result<Vec<PreparedJobInputAdoption>, StoreError> {
        let mut prepared: Vec<PreparedJobInputAdoption> = Vec::with_capacity(uploads.len());
        for mut upload in uploads {
            upload.binding.relative_path = format!(
                "runtime/jobs/{job_id}/inputs/{}/payload",
                upload.binding.blob_id
            );
            let source = upload
                .source
                .take()
                .ok_or_else(|| StoreError::InputUploadState {
                    upload_id: upload.binding.upload_id.clone(),
                    state: "adopted-by-another-submission".into(),
                })?;
            let job_blob = match paths.stage_adopted_job_input_blob(
                job_id,
                &upload.binding.blob_id,
                &source,
            ) {
                Ok(job_blob) => job_blob,
                Err(error) => {
                    let bindings = prepared
                        .iter()
                        .map(|item| item.binding.clone())
                        .collect::<Vec<_>>();
                    drop(prepared);
                    for binding in bindings {
                        let _ =
                            paths.cleanup_adopted_job_input_blob(&binding.worker_blob(), job_id);
                    }
                    return Err(StoreError::Path(error));
                }
            };
            prepared.push(PreparedJobInputAdoption {
                binding: upload.binding,
                _source: source,
                _job_blob: job_blob,
            });
        }
        Ok(prepared)
    }

    pub(crate) fn cleanup_unsubmitted_job_input_adoptions(
        &self,
        paths: &RuntimePaths,
        job_id: &str,
        prepared: Vec<PreparedJobInputAdoption>,
    ) -> Result<(), StoreError> {
        let bindings = prepared
            .iter()
            .map(|item| item.binding.clone())
            .collect::<Vec<_>>();
        drop(prepared);
        for binding in bindings {
            paths.cleanup_adopted_job_input_blob(&binding.worker_blob(), job_id)?;
        }
        Ok(())
    }

    pub(crate) fn abandon_cancelled_job_input_adoptions(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        job_id: &str,
        prepared: Vec<PreparedJobInputAdoption>,
    ) -> Result<(), StoreError> {
        let bindings = prepared
            .iter()
            .map(|item| item.binding.clone())
            .collect::<Vec<_>>();
        drop(prepared);
        for binding in bindings {
            paths.cleanup_adopted_job_input_blob(&binding.worker_blob(), job_id)?;
            self.abandon_job_input_upload(paths, context, &binding.upload_id)?;
        }
        Ok(())
    }

    pub fn read_owned_job_result_bytes(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Vec<u8>, StoreError> {
        let job = self.get(context, job_id)?;
        if job.state != breadboard_runtime_protocol::JobState::Succeeded {
            return Err(StoreError::InvalidInput(
                "job result is unavailable before successful completion".into(),
            ));
        }
        paths
            .read_bounded_job_result(job_id, MAX_OWNED_JOB_RESULT_BYTES)
            .map_err(StoreError::from)
    }

    pub fn read_owned_job_checkpoint_bytes(
        &self,
        paths: &RuntimePaths,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        let _job = self.get(context, job_id)?;
        paths
            .read_bounded_job_checkpoint(job_id, MAX_OWNED_JOB_CHECKPOINT_BYTES)
            .map_err(StoreError::from)
    }

    /// Expires and cleans a bounded number of non-active upload tickets while
    /// the current generation remains online. Uploading streams and adopted
    /// job inputs are never selected; transient Windows sharing failures are
    /// rotated behind other rows and retried by a later bounded pass.
    pub fn reconcile_expired_job_input_uploads_online(
        &self,
        paths: &RuntimePaths,
        limit: usize,
    ) -> Result<usize, StoreError> {
        if !(1..=MAX_JOB_INPUT_CLEANUP_BATCH).contains(&limit) {
            return Err(StoreError::InvalidInput(format!(
                "input cleanup limit must be between 1 and {MAX_JOB_INPUT_CLEANUP_BATCH}"
            )));
        }
        let now = upload_now_ms();
        let expired = {
            let mut connection = self.connection.lock().expect("job store mutex poisoned");
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "UPDATE runtime_job_input_uploads
                 SET lifecycle_state='expired', updated_at=?1, abandoned_at=?1
                 WHERE lifecycle_state IN ('pending','sealed') AND expires_at<=?1",
                params![now],
            )?;
            let rows = {
                let mut statement = transaction.prepare(
                    "SELECT upload_id, declared_size_bytes, sealed_sha256
                     FROM runtime_job_input_uploads
                     WHERE lifecycle_state IN ('abandoned','expired')
                       AND cleaned_at IS NULL
                     ORDER BY updated_at, upload_id LIMIT ?1",
                )?;
                let rows = statement.query_map(params![limit as i64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            transaction.commit()?;
            rows
        };

        for (upload_id, expected_size, sha256) in &expired {
            match paths.cleanup_runtime_job_input_upload(
                upload_id,
                Some(*expected_size),
                sha256.as_deref(),
            ) {
                Ok(_) => {
                    let cleanup_now = upload_now_ms();
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_input_uploads
                         SET cleaned_at=COALESCE(cleaned_at, ?2), updated_at=?2
                         WHERE upload_id=?1
                           AND lifecycle_state IN ('abandoned','expired')",
                        params![upload_id, cleanup_now],
                    )?;
                }
                Err(PathError::BlobCleanupMismatch) => {
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_input_uploads
                         SET lifecycle_state='cleanup_blocked', updated_at=?2
                         WHERE upload_id=?1
                           AND lifecycle_state IN ('abandoned','expired')
                           AND cleaned_at IS NULL",
                        params![upload_id, upload_now_ms()],
                    )?;
                }
                Err(PathError::Io(_)) => {
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_input_uploads SET updated_at=?2
                         WHERE upload_id=?1
                           AND lifecycle_state IN ('abandoned','expired')
                           AND cleaned_at IS NULL",
                        params![upload_id, upload_now_ms()],
                    )?;
                }
                Err(error) => return Err(StoreError::Path(error)),
            }
        }
        Ok(expired.len())
    }

    /// Processes a bounded set of exact durable cleanup rows. Call this after
    /// the matching worker tree has produced a zero-resident receipt, and at
    /// startup after the prior generation has been drained.
    pub fn reconcile_job_input_uploads_after_restart(
        &self,
        paths: &RuntimePaths,
        prior_generation_reconciled: &PriorGenerationJobsReconciled,
        limit: usize,
    ) -> Result<usize, StoreError> {
        if !prior_generation_reconciled.matches_scope(&self.generation_scope) {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        let admission_gate = self
            .admission_open
            .lock()
            .expect("job admission gate mutex poisoned");
        if *admission_gate {
            return Err(StoreError::InvalidInput(
                "restart input cleanup requires closed generation admission".into(),
            ));
        }
        if !(1..=MAX_JOB_INPUT_CLEANUP_BATCH).contains(&limit) {
            return Err(StoreError::InvalidInput(format!(
                "input cleanup limit must be between 1 and {MAX_JOB_INPUT_CLEANUP_BATCH}"
            )));
        }
        let now = upload_now_ms();
        let (orphaned, job_blobs) = {
            let mut connection = self.connection.lock().expect("job store mutex poisoned");
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "UPDATE runtime_job_input_uploads
                 SET lifecycle_state='abandoning', updated_at=?1, abandoned_at=?1
                 WHERE lifecycle_state='uploading'",
                params![now],
            )?;
            transaction.execute(
                "UPDATE runtime_job_input_uploads
                 SET lifecycle_state='expired', updated_at=?1, abandoned_at=?1
                 WHERE lifecycle_state IN ('pending','sealed') AND expires_at<=?1",
                params![now],
            )?;
            let orphaned = {
                let mut statement = transaction.prepare(
                    "SELECT upload_id, declared_size_bytes, sealed_sha256
                     FROM runtime_job_input_uploads
                     WHERE lifecycle_state IN ('abandoning','abandoned','expired')
                       AND cleaned_at IS NULL
                     ORDER BY updated_at, upload_id LIMIT ?1",
                )?;
                let rows = statement.query_map(params![limit as i64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let remaining = limit.saturating_sub(orphaned.len());
            let job_blobs = if remaining == 0 {
                Vec::new()
            } else {
                let mut statement = transaction.prepare(
                    "SELECT job_id, ordinal, blob_id, upload_id, relative_path, size_bytes,
                            sha256, display_name, media_type
                     FROM runtime_job_blobs WHERE cleanup_state='pending'
                     ORDER BY cleanup_requested_at, job_id, ordinal LIMIT ?1",
                )?;
                let rows = statement.query_map(params![remaining as i64], |row| {
                    Ok(CleanupJobInputBlob {
                        job_id: row.get(0)?,
                        binding: JobInputBlobBinding {
                            ordinal: row.get(1)?,
                            blob_id: row.get(2)?,
                            upload_id: row.get(3)?,
                            relative_path: row.get(4)?,
                            size_bytes: row.get(5)?,
                            sha256: row.get(6)?,
                            display_name: row.get(7)?,
                            media_type: row.get(8)?,
                        },
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            transaction.commit()?;
            (orphaned, job_blobs)
        };

        let mut processed = 0;
        for (upload_id, maximum_size, sha256) in orphaned {
            match paths.cleanup_runtime_job_input_upload(
                &upload_id,
                Some(maximum_size),
                sha256.as_deref(),
            ) {
                Ok(_) => {
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_input_uploads
                         SET lifecycle_state=CASE WHEN lifecycle_state='abandoning'
                                THEN 'abandoned' ELSE lifecycle_state END,
                             cleaned_at=?2, updated_at=?2
                         WHERE upload_id=?1
                           AND lifecycle_state IN ('abandoning','abandoned','expired')
                           AND cleaned_at IS NULL",
                        params![upload_id, upload_now_ms()],
                    )?;
                    processed += 1;
                }
                Err(PathError::BlobCleanupMismatch) => {
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_input_uploads
                         SET lifecycle_state='cleanup_blocked', updated_at=?2
                         WHERE upload_id=?1
                           AND lifecycle_state IN ('abandoning','abandoned','expired')
                           AND cleaned_at IS NULL",
                        params![upload_id, upload_now_ms()],
                    )?;
                    processed += 1;
                }
                Err(error) => return Err(StoreError::Path(error)),
            }
        }

        for cleanup in job_blobs {
            let blob = cleanup.binding.worker_blob();
            let result = paths
                .cleanup_adopted_job_input_blob(&blob, &cleanup.job_id)
                .and_then(|_| {
                    paths.cleanup_runtime_job_input_upload(
                        &cleanup.binding.upload_id,
                        Some(cleanup.binding.size_bytes),
                        Some(&cleanup.binding.sha256),
                    )
                });
            match result {
                Ok(_) => {
                    let cleanup_now = upload_now_ms();
                    let mut connection = self.connection.lock().expect("job store mutex poisoned");
                    let transaction =
                        connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    transaction.execute(
                        "UPDATE runtime_job_blobs SET cleanup_state='cleaned', cleaned_at=?3
                         WHERE job_id=?1 AND ordinal=?2 AND cleanup_state='pending'",
                        params![cleanup.job_id, cleanup.binding.ordinal, cleanup_now],
                    )?;
                    transaction.execute(
                        "UPDATE runtime_job_input_uploads SET cleaned_at=?2, updated_at=?2
                         WHERE upload_id=?1 AND lifecycle_state='adopted' AND cleaned_at IS NULL",
                        params![cleanup.binding.upload_id, cleanup_now],
                    )?;
                    transaction.commit()?;
                    processed += 1;
                }
                Err(PathError::BlobCleanupMismatch) => {
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_blobs SET cleanup_state='blocked'
                         WHERE job_id=?1 AND ordinal=?2 AND cleanup_state='pending'",
                        params![cleanup.job_id, cleanup.binding.ordinal],
                    )?;
                    processed += 1;
                }
                Err(error) => return Err(StoreError::Path(error)),
            }
        }
        drop(admission_gate);
        Ok(processed)
    }

    pub fn cleanup_job_inputs_after_worker_exit(
        &self,
        paths: &RuntimePaths,
        tree_exit: &ProcessTreeExit,
    ) -> Result<usize, StoreError> {
        if !tree_exit.matches_generation_scope(&self.generation_scope) {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        let identity = tree_exit.worker_identity().ok_or_else(|| {
            StoreError::InvalidInput("service exit cannot clean job input".into())
        })?;
        let job = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            super::store::query_job(&connection, &identity.job_id)?
        };
        if !job.state.is_terminal() || job.identity().as_ref() != Some(identity) {
            return Err(StoreError::StaleWorker(identity.job_id.clone()));
        }
        self.cleanup_terminal_job_blobs_for_job(paths, &identity.job_id)
    }

    pub fn cleanup_job_inputs_after_worker_not_created(
        &self,
        paths: &RuntimePaths,
        authority: &WorkerLaunchNotCreatedCleanup,
    ) -> Result<usize, StoreError> {
        if authority.generation_scope != self.generation_scope {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        let job = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            super::store::query_job(&connection, &authority.identity.job_id)?
        };
        if !job.state.is_terminal() || job.identity().as_ref() != Some(&authority.identity) {
            return Err(StoreError::StaleWorker(authority.identity.job_id.clone()));
        }
        self.cleanup_terminal_job_blobs_for_job(paths, &authority.identity.job_id)
    }

    pub fn cleanup_unstarted_terminal_job_inputs(
        &self,
        paths: &RuntimePaths,
        job_id: &str,
    ) -> Result<usize, StoreError> {
        let job = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            super::store::query_job(&connection, job_id)?
        };
        if !job.state.is_terminal()
            || job.attempt != 0
            || job.worker_instance_id.is_some()
            || job.started_at.is_some()
        {
            return Err(StoreError::InvalidInput(
                "job input cleanup requires a proved unstarted terminal job".into(),
            ));
        }
        self.cleanup_terminal_job_blobs_for_job(paths, job_id)
    }

    fn cleanup_terminal_job_blobs_for_job(
        &self,
        paths: &RuntimePaths,
        job_id: &str,
    ) -> Result<usize, StoreError> {
        let rows = {
            let connection = self.connection.lock().expect("job store mutex poisoned");
            let mut statement = connection.prepare(
                "SELECT ordinal, blob_id, upload_id, relative_path, size_bytes, sha256,
                        display_name, media_type
                 FROM runtime_job_blobs
                 WHERE job_id=?1 AND cleanup_state='pending' ORDER BY ordinal",
            )?;
            let rows = statement.query_map(params![job_id], |row| {
                Ok(JobInputBlobBinding {
                    ordinal: row.get(0)?,
                    blob_id: row.get(1)?,
                    upload_id: row.get(2)?,
                    relative_path: row.get(3)?,
                    size_bytes: row.get(4)?,
                    sha256: row.get(5)?,
                    display_name: row.get(6)?,
                    media_type: row.get(7)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut cleaned = 0;
        for binding in rows {
            let worker_blob = binding.worker_blob();
            let result = paths
                .cleanup_adopted_job_input_blob(&worker_blob, job_id)
                .and_then(|_| {
                    paths.cleanup_runtime_job_input_upload(
                        &binding.upload_id,
                        Some(binding.size_bytes),
                        Some(&binding.sha256),
                    )
                });
            match result {
                Ok(_) => {
                    let cleanup_now = upload_now_ms();
                    let mut connection = self.connection.lock().expect("job store mutex poisoned");
                    let transaction =
                        connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    transaction.execute(
                        "UPDATE runtime_job_blobs SET cleanup_state='cleaned', cleaned_at=?3
                         WHERE job_id=?1 AND ordinal=?2 AND cleanup_state='pending'",
                        params![job_id, binding.ordinal, cleanup_now],
                    )?;
                    transaction.execute(
                        "UPDATE runtime_job_input_uploads SET cleaned_at=?2, updated_at=?2
                         WHERE upload_id=?1 AND lifecycle_state='adopted' AND cleaned_at IS NULL",
                        params![binding.upload_id, cleanup_now],
                    )?;
                    transaction.commit()?;
                    cleaned += 1;
                }
                Err(PathError::BlobCleanupMismatch) => {
                    let connection = self.connection.lock().expect("job store mutex poisoned");
                    connection.execute(
                        "UPDATE runtime_job_blobs SET cleanup_state='blocked'
                         WHERE job_id=?1 AND ordinal=?2 AND cleanup_state='pending'",
                        params![job_id, binding.ordinal],
                    )?;
                }
                Err(error) => return Err(StoreError::Path(error)),
            }
        }
        Ok(cleaned)
    }
}

struct CleanupJobInputBlob {
    job_id: String,
    binding: JobInputBlobBinding,
}

#[derive(Debug)]
struct UploadRow {
    upload_id: String,
    lifecycle_state: String,
    display_name: String,
    media_type: Option<String>,
    declared_size_bytes: u64,
    maximum_bytes: u64,
    sealed_size_bytes: Option<u64>,
    sealed_sha256: Option<String>,
    job_id: Option<String>,
    expires_at: i64,
    cleaned_at: Option<i64>,
}

fn query_owned_upload(
    connection: &rusqlite::Connection,
    context: &AuthenticatedJobContext,
    upload_id: &str,
) -> Result<UploadRow, StoreError> {
    let row = connection
        .query_row(
            "SELECT upload_id, owner_principal, garden_id, conversation_id,
                    lifecycle_state, display_name, media_type, declared_size_bytes,
                    maximum_bytes, sealed_size_bytes, sealed_sha256, job_id,
                    expires_at, cleaned_at
             FROM runtime_job_input_uploads WHERE upload_id=?1",
            params![upload_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, u64>(7)?,
                    row.get::<_, u64>(8)?,
                    row.get::<_, Option<u64>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, Option<i64>>(13)?,
                ))
            },
        )
        .optional()?;
    let Some((
        upload_id,
        owner_principal,
        garden_id,
        conversation_id,
        lifecycle_state,
        display_name,
        media_type,
        declared_size_bytes,
        maximum_bytes,
        sealed_size_bytes,
        sealed_sha256,
        job_id,
        expires_at,
        cleaned_at,
    )) = row
    else {
        return Err(StoreError::InputUploadNotFound(upload_id.into()));
    };
    // A null reservation scope may be narrowed at adoption time, but an
    // already-scoped upload can never change or widen scope.
    let scopes_match = garden_id
        .as_deref()
        .is_none_or(|scope| Some(scope) == context.garden_id())
        && conversation_id
            .as_deref()
            .is_none_or(|scope| Some(scope) == context.conversation_id());
    if owner_principal != context.owner().principal() || !scopes_match {
        return Err(StoreError::InputUploadNotOwned(upload_id));
    }
    Ok(UploadRow {
        upload_id,
        lifecycle_state,
        display_name,
        media_type,
        declared_size_bytes,
        maximum_bytes,
        sealed_size_bytes,
        sealed_sha256,
        job_id,
        expires_at,
        cleaned_at,
    })
}

pub(crate) fn adopt_job_input_uploads_tx(
    transaction: &Transaction<'_>,
    context: &AuthenticatedJobContext,
    job_id: &str,
    inputs: &[JobInputBlobBinding],
    now: i64,
) -> Result<(), StoreError> {
    for input in inputs {
        let row = query_owned_upload(transaction, context, &input.upload_id)?;
        if row.expires_at <= now {
            return Err(StoreError::InputUploadExpired(input.upload_id.clone()));
        }
        if row.lifecycle_state != "sealed"
            || row.sealed_size_bytes != Some(input.size_bytes)
            || row.sealed_sha256.as_deref() != Some(input.sha256.as_str())
            || row.display_name != input.display_name
            || row.media_type != input.media_type
        {
            return Err(StoreError::InputUploadState {
                upload_id: input.upload_id.clone(),
                state: row.lifecycle_state,
            });
        }
        transaction.execute(
            "INSERT INTO runtime_job_blobs (
                job_id, ordinal, blob_id, upload_id, relative_path, size_bytes,
                sha256, display_name, media_type
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                job_id,
                input.ordinal,
                input.blob_id,
                input.upload_id,
                input.relative_path,
                input.size_bytes,
                input.sha256,
                input.display_name,
                input.media_type,
            ],
        )?;
        let changed = transaction.execute(
            "UPDATE runtime_job_input_uploads
             SET lifecycle_state='adopted', job_id=?2, adopted_at=?3, updated_at=?3,
                 garden_id=COALESCE(garden_id, ?4),
                 conversation_id=COALESCE(conversation_id, ?5)
             WHERE upload_id=?1 AND lifecycle_state='sealed'",
            params![
                input.upload_id,
                job_id,
                now,
                context.garden_id(),
                context.conversation_id(),
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::InputUploadState {
                upload_id: input.upload_id.clone(),
                state: "adoption-raced".into(),
            });
        }
    }
    Ok(())
}

pub(crate) fn query_job_input_blob_bindings(
    connection: &rusqlite::Connection,
    job_id: &str,
) -> Result<Vec<JobInputBlobBinding>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT ordinal, blob_id, upload_id, relative_path, size_bytes, sha256,
                display_name, media_type
         FROM runtime_job_blobs WHERE job_id=?1 ORDER BY ordinal ASC",
    )?;
    let rows = statement.query_map(params![job_id], |row| {
        Ok(JobInputBlobBinding {
            ordinal: row.get(0)?,
            blob_id: row.get(1)?,
            upload_id: row.get(2)?,
            relative_path: row.get(3)?,
            size_bytes: row.get(4)?,
            sha256: row.get(5)?,
            display_name: row.get(6)?,
            media_type: row.get(7)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn upload_now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

pub(crate) fn semantic_blob_id(ordinal: u32, sha256: &str) -> String {
    format!("blob_{ordinal}_{sha256}")
}

fn mint_upload_id() -> Result<String, StoreError> {
    let mut random = [0_u8; 24];
    getrandom::getrandom(&mut random)
        .map_err(|_| StoreError::InvalidInput("secure upload id generation failed".into()))?;
    let mut encoded = String::with_capacity(7 + random.len() * 2);
    encoded.push_str("upload_");
    for byte in random {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}")
            .map_err(|_| StoreError::InvalidInput("upload id encoding failed".into()))?;
    }
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{canonicalize_request_payload, compute_submission_digest, NewJob};
    use crate::{
        AdmissionPolicy, JobAdmissionResult, RegisteredJobAdmission, SystemCommit,
        WorkerClaimOutcome,
    };
    use breadboard_runtime_protocol::{ResourceClass, RuntimeJobInputUploadReference};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::fs;
    use tempfile::TempDir;

    struct TestRuntime {
        _directory: TempDir,
        paths: RuntimePaths,
        store: JobStore,
    }

    fn runtime() -> TestRuntime {
        let directory = tempfile::tempdir().unwrap();
        let paths =
            RuntimePaths::new(directory.path(), directory.path(), directory.path()).unwrap();
        let store = JobStore::open(directory.path().join("runtime.sqlite3")).unwrap();
        TestRuntime {
            _directory: directory,
            paths,
            store,
        }
    }

    fn context(garden_id: Option<&str>) -> AuthenticatedJobContext {
        AuthenticatedJobContext::for_verified_user(7, garden_id, None).unwrap()
    }

    fn reserve(
        runtime: &TestRuntime,
        context: &AuthenticatedJobContext,
        bytes: &[u8],
    ) -> RuntimeJobInputReservationResponse {
        reserve_size(runtime, context, bytes.len() as u64).unwrap()
    }

    fn reserve_size(
        runtime: &TestRuntime,
        context: &AuthenticatedJobContext,
        declared_size_bytes: u64,
    ) -> Result<RuntimeJobInputReservationResponse, StoreError> {
        runtime.store.reserve_job_input_upload(
            context,
            &RuntimeJobInputReservationRequest {
                garden_id: context.garden_id().map(str::to_owned),
                conversation_id: None,
                display_name: "document.txt".into(),
                media_type: Some("text/plain".into()),
                declared_size_bytes,
            },
            declared_size_bytes,
        )
    }

    fn seal(
        runtime: &TestRuntime,
        context: &AuthenticatedJobContext,
        bytes: &[u8],
    ) -> RuntimeJobInputReservationResponse {
        let reservation = reserve(runtime, context, bytes);
        let mut lease = runtime
            .store
            .begin_job_input_upload(&runtime.paths, context, &reservation.upload_id)
            .unwrap();
        lease.write_all(bytes).unwrap();
        let receipt = lease.seal().unwrap();
        assert_eq!(receipt.size_bytes(), bytes.len() as u64);
        assert_eq!(receipt.sha256(), format!("{:x}", Sha256::digest(bytes)));
        reservation
    }

    fn submission(
        runtime: &TestRuntime,
        context: &AuthenticatedJobContext,
        upload_id: &str,
        job_id: &str,
        idempotency_key: &str,
    ) -> (NewJob, Vec<ResolvedJobInputUpload>) {
        let resolved = runtime
            .store
            .resolve_job_input_uploads(
                &runtime.paths,
                context,
                &[RuntimeJobInputUploadReference {
                    upload_id: upload_id.into(),
                }],
            )
            .unwrap();
        let digest_bindings = resolved
            .iter()
            .map(ResolvedJobInputUpload::digest_binding)
            .collect::<Vec<_>>();
        let canonical_request_payload =
            canonicalize_request_payload(&json!({"document": "runtime-owned"})).unwrap();
        let request_digest = compute_submission_digest(
            context.owner(),
            "document-ingestion",
            context.garden_id(),
            context.conversation_id(),
            &canonical_request_payload,
            &digest_bindings,
        )
        .unwrap();
        let layout = runtime.paths.job_paths(job_id).unwrap();
        let input_blobs = resolved
            .iter()
            .map(|input| input.binding_for_job(job_id))
            .collect();
        (
            NewJob {
                job_id: job_id.into(),
                job_type: "document-ingestion".into(),
                worker_kind: "document-ingestion-node".into(),
                resource_class: "document-processing".into(),
                owner: context.owner().clone(),
                garden_id: context.garden_id().map(str::to_owned),
                conversation_id: context.conversation_id().map(str::to_owned),
                input_manifest_path: layout.input_manifest_relative(),
                workspace_path: layout.workspace_relative(),
                checkpoint_path: layout.checkpoint_relative(),
                result_path: layout.result_relative(),
                idempotency_key: idempotency_key.into(),
                request_digest,
                canonical_request_payload,
                input_blobs,
            },
            resolved,
        )
    }

    fn commit_submission(
        runtime: &TestRuntime,
        submission: &NewJob,
        resolved: Vec<ResolvedJobInputUpload>,
    ) {
        let _input = runtime
            .paths
            .stage_job_input(&submission.job_id, &submission.canonical_request_payload)
            .unwrap();
        let prepared = runtime
            .store
            .prepare_job_input_adoptions(&runtime.paths, &submission.job_id, resolved)
            .unwrap();
        assert_eq!(
            prepared
                .iter()
                .map(|item| item.binding.clone())
                .collect::<Vec<_>>(),
            submission.input_blobs
        );
        runtime.store.submit_raw(submission).unwrap();
        drop(prepared);
    }

    #[test]
    fn reservation_stream_seal_is_bounded_durable_and_reopenable() {
        let runtime = runtime();
        let context = context(None);
        let bytes = b"durable input";
        let reservation = seal(&runtime, &context, bytes);
        let reopened = JobStore::open(runtime._directory.path().join("runtime.sqlite3")).unwrap();
        let resolved = reopened
            .resolve_job_input_uploads(
                &runtime.paths,
                &context,
                &[RuntimeJobInputUploadReference {
                    upload_id: reservation.upload_id.clone(),
                }],
            )
            .unwrap();
        assert_eq!(resolved[0].binding.size_bytes, bytes.len() as u64);
        assert_eq!(
            resolved[0].binding.sha256,
            format!("{:x}", Sha256::digest(bytes))
        );
        assert!(runtime
            .store
            .begin_job_input_upload(&runtime.paths, &context, "../escape")
            .is_err());

        let overflow = reserve(&runtime, &context, b"abc");
        let mut lease = runtime
            .store
            .begin_job_input_upload(&runtime.paths, &context, &overflow.upload_id)
            .unwrap();
        assert!(lease.write_all(b"abcd").is_err());
        drop(lease);
        let row = {
            let connection = runtime.store.connection.lock().unwrap();
            query_owned_upload(&connection, &context, &overflow.upload_id).unwrap()
        };
        assert_eq!(row.lifecycle_state, "abandoned");
        assert!(row.cleaned_at.is_some());
    }

    #[test]
    fn reservation_quota_atomically_bounds_owner_count_and_bytes_until_cleanup() {
        let count_runtime = runtime();
        let context = context(None);
        let reservations = (0..MAX_UNCLEANED_JOB_INPUT_UPLOADS_PER_OWNER)
            .map(|_| reserve_size(&count_runtime, &context, 1).unwrap())
            .collect::<Vec<_>>();
        assert!(matches!(
            reserve_size(&count_runtime, &context, 1),
            Err(StoreError::InputUploadQuotaExceeded {
                scope: InputUploadQuotaScope::Owner
            })
        ));
        assert!(count_runtime
            .store
            .abandon_job_input_upload(&count_runtime.paths, &context, &reservations[0].upload_id)
            .unwrap());
        reserve_size(&count_runtime, &context, 1).unwrap();

        let byte_runtime = runtime();
        let first = reserve_size(
            &byte_runtime,
            &context,
            breadboard_runtime_protocol::MAX_JOB_INPUT_UPLOAD_BYTES,
        )
        .unwrap();
        reserve_size(
            &byte_runtime,
            &context,
            breadboard_runtime_protocol::MAX_JOB_INPUT_UPLOAD_BYTES,
        )
        .unwrap();
        assert!(matches!(
            reserve_size(&byte_runtime, &context, 1),
            Err(StoreError::InputUploadQuotaExceeded {
                scope: InputUploadQuotaScope::Owner
            })
        ));
        byte_runtime
            .store
            .abandon_job_input_upload(&byte_runtime.paths, &context, &first.upload_id)
            .unwrap();
        reserve_size(&byte_runtime, &context, 1).unwrap();
    }

    #[test]
    fn reservation_quota_is_global_across_owners_and_released_only_after_cleanup() {
        let count_runtime = runtime();
        let mut first = None;
        for user_offset in
            0..(MAX_UNCLEANED_JOB_INPUT_UPLOADS_GLOBAL / MAX_UNCLEANED_JOB_INPUT_UPLOADS_PER_OWNER)
        {
            let owner = AuthenticatedJobContext::for_verified_user(
                10_000 + i64::try_from(user_offset).unwrap(),
                None,
                None,
            )
            .unwrap();
            for _ in 0..MAX_UNCLEANED_JOB_INPUT_UPLOADS_PER_OWNER {
                let reservation = reserve_size(&count_runtime, &owner, 1).unwrap();
                if first.is_none() {
                    first = Some((owner.clone(), reservation.upload_id));
                }
            }
        }
        let next_owner = AuthenticatedJobContext::for_verified_user(99_999, None, None).unwrap();
        assert!(matches!(
            reserve_size(&count_runtime, &next_owner, 1),
            Err(StoreError::InputUploadQuotaExceeded {
                scope: InputUploadQuotaScope::Global
            })
        ));
        let (first_owner, first_upload) = first.unwrap();
        count_runtime
            .store
            .abandon_job_input_upload(&count_runtime.paths, &first_owner, &first_upload)
            .unwrap();
        reserve_size(&count_runtime, &next_owner, 1).unwrap();

        let byte_runtime = runtime();
        for user_id in 20_000..20_004 {
            let owner = AuthenticatedJobContext::for_verified_user(user_id, None, None).unwrap();
            for _ in 0..2 {
                reserve_size(
                    &byte_runtime,
                    &owner,
                    breadboard_runtime_protocol::MAX_JOB_INPUT_UPLOAD_BYTES,
                )
                .unwrap();
            }
        }
        let byte_overflow_owner =
            AuthenticatedJobContext::for_verified_user(20_004, None, None).unwrap();
        assert!(matches!(
            reserve_size(&byte_runtime, &byte_overflow_owner, 1),
            Err(StoreError::InputUploadQuotaExceeded {
                scope: InputUploadQuotaScope::Global
            })
        ));
    }

    #[test]
    fn begin_path_failure_has_no_lease_and_cleans_the_abandoned_ticket() {
        let runtime = runtime();
        let context = context(None);
        let reservation = reserve(&runtime, &context, b"abc");
        let destination = runtime
            .paths
            .resolve_data(&format!(
                "runtime/uploads/{}/payload",
                reservation.upload_id
            ))
            .unwrap();
        fs::create_dir_all(destination.absolute().parent().unwrap()).unwrap();
        fs::write(destination.absolute(), b"abc").unwrap();

        assert!(runtime
            .store
            .begin_job_input_upload(&runtime.paths, &context, &reservation.upload_id)
            .is_err());
        let row = {
            let connection = runtime.store.connection.lock().unwrap();
            query_owned_upload(&connection, &context, &reservation.upload_id).unwrap()
        };
        assert_eq!(row.lifecycle_state, "abandoned");
        assert!(row.cleaned_at.is_some());
        assert!(!destination.absolute().exists());
    }

    #[test]
    fn abandon_racing_a_sealed_pin_is_fenced_and_exactly_cleaned() {
        let runtime = runtime();
        let context = context(None);
        let reservation = reserve(&runtime, &context, b"abc");
        let mut lease = runtime
            .store
            .begin_job_input_upload(&runtime.paths, &context, &reservation.upload_id)
            .unwrap();
        lease.write_all(b"abc").unwrap();
        let result = lease.seal_with_post_commit_hook(|| {
            assert!(runtime
                .store
                .abandon_job_input_upload(&runtime.paths, &context, &reservation.upload_id)
                .unwrap());
        });
        assert!(result.is_err());
        let row = {
            let connection = runtime.store.connection.lock().unwrap();
            query_owned_upload(&connection, &context, &reservation.upload_id).unwrap()
        };
        assert_eq!(row.lifecycle_state, "abandoned");
        assert!(row.cleaned_at.is_some());
        assert!(!runtime
            .paths
            .resolve_data(&format!(
                "runtime/uploads/{}/payload",
                reservation.upload_id
            ))
            .unwrap()
            .absolute()
            .exists());
    }

    #[test]
    fn adopted_upload_replays_same_key_after_cleanup_and_rejects_cross_key_reuse() {
        let runtime = runtime();
        let upload_context = context(None);
        let reservation = seal(&runtime, &upload_context, b"scope me");
        let garden_context = context(Some("garden-1"));
        let (first, resolved) = submission(
            &runtime,
            &garden_context,
            &reservation.upload_id,
            "job_same",
            "request-same",
        );
        commit_submission(&runtime, &first, resolved);
        {
            let connection = runtime.store.connection.lock().unwrap();
            let scope: Option<String> = connection
                .query_row(
                    "SELECT garden_id FROM runtime_job_input_uploads WHERE upload_id=?1",
                    params![reservation.upload_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(scope.as_deref(), Some("garden-1"));
        }
        // Simulate completed exact cleanup: replay must use the durable job
        // binding, not require the private upload bytes to survive.
        runtime
            .store
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE runtime_job_input_uploads SET cleaned_at=?2 WHERE upload_id=?1",
                params![reservation.upload_id, upload_now_ms()],
            )
            .unwrap();
        let private_path = runtime
            .paths
            .resolve_data(&format!(
                "runtime/uploads/{}/payload",
                reservation.upload_id
            ))
            .unwrap();
        fs::remove_file(private_path.absolute()).unwrap();
        let (replay, _) = submission(
            &runtime,
            &garden_context,
            &reservation.upload_id,
            "job_same",
            "request-same",
        );
        assert_eq!(
            runtime.store.replay_raw(&replay).unwrap().unwrap().job_id,
            "job_same"
        );
        let (cross_key, cross_resolved) = submission(
            &runtime,
            &garden_context,
            &reservation.upload_id,
            "job_other",
            "request-other",
        );
        assert!(matches!(
            runtime.store.prepare_job_input_adoptions(
                &runtime.paths,
                &cross_key.job_id,
                cross_resolved
            ),
            Err(StoreError::InputUploadState { .. })
        ));
    }

    #[test]
    fn atomic_adoption_rechecks_expiry_and_partial_copy_is_removed() {
        let runtime = runtime();
        let context = context(None);
        let reservation = seal(&runtime, &context, b"expires");
        let (submission, resolved) = submission(
            &runtime,
            &context,
            &reservation.upload_id,
            "job_expiry",
            "request-expiry",
        );
        let _input = runtime
            .paths
            .stage_job_input(&submission.job_id, &submission.canonical_request_payload)
            .unwrap();
        let prepared = runtime
            .store
            .prepare_job_input_adoptions(&runtime.paths, &submission.job_id, resolved)
            .unwrap();
        runtime
            .store
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE runtime_job_input_uploads SET expires_at=?2 WHERE upload_id=?1",
                params![reservation.upload_id, upload_now_ms().saturating_sub(1)],
            )
            .unwrap();
        assert!(matches!(
            runtime.store.submit_raw(&submission),
            Err(StoreError::InputUploadExpired(_))
        ));
        runtime
            .store
            .cleanup_unsubmitted_job_input_adoptions(&runtime.paths, &submission.job_id, prepared)
            .unwrap();
        assert!(!runtime
            .paths
            .resolve_data(&submission.input_blobs[0].relative_path)
            .unwrap()
            .absolute()
            .exists());
    }

    #[test]
    fn queued_and_admitted_attempt_zero_cancellation_clean_adopted_inputs() {
        for admitted in [false, true] {
            let runtime = runtime();
            let context = context(None);
            let bytes: &[u8] = if admitted { b"admitted" } else { b"queued" };
            let reservation = seal(&runtime, &context, bytes);
            let job_id = if admitted {
                "job_admitted_cleanup"
            } else {
                "job_queued_cleanup"
            };
            let idempotency_key = if admitted {
                "request-admitted-cleanup"
            } else {
                "request-queued-cleanup"
            };
            let (submission, resolved) = submission(
                &runtime,
                &context,
                &reservation.upload_id,
                job_id,
                idempotency_key,
            );
            commit_submission(&runtime, &submission, resolved);
            if admitted {
                let admission = RegisteredJobAdmission::new(
                    "document-ingestion",
                    "document-ingestion-node",
                    ResourceClass::DocumentProcessing,
                    1,
                    1,
                );
                assert!(matches!(
                    runtime
                        .store
                        .try_admit_job(job_id, &admission, AdmissionPolicy::default(), || Ok(
                            SystemCommit {
                                total_mb: 0,
                                limit_mb: 64 * 1024,
                            }
                        ),)
                        .unwrap(),
                    JobAdmissionResult::Admitted(_)
                ));
            }

            let cancelled = runtime
                .store
                .request_cancellation(&context, job_id)
                .unwrap();
            assert_eq!(
                cancelled.state,
                breadboard_runtime_protocol::JobState::Cancelled
            );
            assert_eq!(cancelled.attempt, 0);
            assert_eq!(
                runtime
                    .store
                    .cleanup_unstarted_terminal_job_inputs(&runtime.paths, job_id)
                    .unwrap(),
                1
            );
            assert!(!runtime
                .paths
                .resolve_data(&submission.input_blobs[0].relative_path)
                .unwrap()
                .absolute()
                .exists());
            assert!(!runtime
                .paths
                .resolve_data(&format!(
                    "runtime/uploads/{}/payload",
                    reservation.upload_id
                ))
                .unwrap()
                .absolute()
                .exists());
        }
    }

    #[test]
    fn online_expiry_sweep_is_bounded_and_never_touches_active_or_adopted_inputs() {
        let runtime = runtime();
        let context = context(None);
        let expired = seal(&runtime, &context, b"expired");
        let active = reserve(&runtime, &context, b"active");
        let active_lease = runtime
            .store
            .begin_job_input_upload(&runtime.paths, &context, &active.upload_id)
            .unwrap();
        let adopted = seal(&runtime, &context, b"adopted");
        let (submission, resolved) = submission(
            &runtime,
            &context,
            &adopted.upload_id,
            "job_online_sweep",
            "request-online-sweep",
        );
        commit_submission(&runtime, &submission, resolved);
        runtime
            .store
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE runtime_job_input_uploads SET expires_at=?1
                 WHERE upload_id IN (?2, ?3, ?4)",
                params![
                    upload_now_ms().saturating_sub(1),
                    expired.upload_id,
                    active.upload_id,
                    adopted.upload_id,
                ],
            )
            .unwrap();

        assert_eq!(
            runtime
                .store
                .reconcile_expired_job_input_uploads_online(&runtime.paths, 1)
                .unwrap(),
            1
        );
        let connection = runtime.store.connection.lock().unwrap();
        let states = [&expired.upload_id, &active.upload_id, &adopted.upload_id]
            .into_iter()
            .map(|upload_id| {
                connection
                    .query_row(
                        "SELECT lifecycle_state FROM runtime_job_input_uploads WHERE upload_id=?1",
                        params![upload_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        drop(connection);
        assert_eq!(states, vec!["expired", "uploading", "adopted"]);
        assert!(!runtime
            .paths
            .resolve_data(&format!("runtime/uploads/{}/payload", expired.upload_id))
            .unwrap()
            .absolute()
            .exists());
        assert!(runtime
            .paths
            .resolve_data(&submission.input_blobs[0].relative_path)
            .unwrap()
            .absolute()
            .exists());
        drop(active_lease);
    }

    #[test]
    fn one_restart_terminalizes_and_cleans_adopted_starting_job() {
        let runtime = runtime();
        let context = context(None);
        let reservation = seal(&runtime, &context, b"restart");
        let (submission, resolved) = submission(
            &runtime,
            &context,
            &reservation.upload_id,
            "job_restart_blob",
            "request-restart",
        );
        commit_submission(&runtime, &submission, resolved);
        let admission = RegisteredJobAdmission::new(
            "document-ingestion",
            "document-ingestion-node",
            ResourceClass::DocumentProcessing,
            1,
            1,
        );
        assert!(matches!(
            runtime
                .store
                .try_admit_job(
                    &submission.job_id,
                    &admission,
                    AdmissionPolicy::default(),
                    || Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024,
                    }),
                )
                .unwrap(),
            JobAdmissionResult::Admitted(_)
        ));
        let claim = runtime
            .store
            .try_claim_admitted_worker(&submission.job_id, "worker_restart")
            .unwrap();
        assert!(matches!(&claim, WorkerClaimOutcome::Claimed(_)));
        drop(claim);
        runtime.store.pause_accepting_work();
        let proof = runtime.store.prior_generation_drained_for_test();
        let (_jobs, cleanup_authority) = runtime
            .store
            .reconcile_after_runtime_restart_with_blob_authority_for_test(proof)
            .unwrap();
        while runtime
            .store
            .reconcile_job_input_uploads_after_restart(
                &runtime.paths,
                &cleanup_authority,
                MAX_JOB_INPUT_CLEANUP_BATCH,
            )
            .unwrap()
            == MAX_JOB_INPUT_CLEANUP_BATCH
        {}
        assert!(!runtime
            .paths
            .resolve_data(&submission.input_blobs[0].relative_path)
            .unwrap()
            .absolute()
            .exists());
        assert!(!runtime
            .paths
            .resolve_data(&format!(
                "runtime/uploads/{}/payload",
                reservation.upload_id
            ))
            .unwrap()
            .absolute()
            .exists());
        let states: (String, Option<i64>) = runtime
            .store
            .connection
            .lock()
            .unwrap()
            .query_row(
                "SELECT cleanup_state, cleaned_at FROM runtime_job_blobs WHERE job_id=?1",
                params![submission.job_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(states.0, "cleaned");
        assert!(states.1.is_some());
    }

    #[test]
    fn restart_batches_do_not_starve_after_a_blocked_orphan() {
        let runtime = runtime();
        let now = upload_now_ms();
        {
            let mut connection = runtime.store.connection.lock().unwrap();
            let transaction = connection.transaction().unwrap();
            for ordinal in 0..66 {
                let upload_id = format!("upload_batch_{ordinal:03}");
                transaction
                    .execute(
                        "INSERT INTO runtime_job_input_uploads (
                            upload_id, owner_principal, user_id, lifecycle_state,
                            display_name, declared_size_bytes, maximum_bytes,
                            relative_path, expires_at, created_at, updated_at, abandoned_at
                         ) VALUES (?1, 'user:7', 7, 'abandoned', 'batch.bin', 1, 1,
                                   ?2, ?3, ?3, ?3, ?3)",
                        params![
                            upload_id,
                            format!("runtime/uploads/{upload_id}/payload"),
                            now,
                        ],
                    )
                    .unwrap();
            }
            transaction.commit().unwrap();
        }
        let mismatched = runtime
            .paths
            .resolve_data("runtime/uploads/upload_batch_000/payload")
            .unwrap();
        fs::create_dir_all(mismatched.absolute().parent().unwrap()).unwrap();
        fs::write(mismatched.absolute(), b"xx").unwrap();
        runtime.store.pause_accepting_work();
        let proof = runtime.store.prior_generation_drained_for_test();
        let (_jobs, cleanup_authority) = runtime
            .store
            .reconcile_after_runtime_restart_with_blob_authority_for_test(proof)
            .unwrap();
        let mut batches = Vec::new();
        loop {
            let processed = runtime
                .store
                .reconcile_job_input_uploads_after_restart(
                    &runtime.paths,
                    &cleanup_authority,
                    MAX_JOB_INPUT_CLEANUP_BATCH,
                )
                .unwrap();
            batches.push(processed);
            if processed < MAX_JOB_INPUT_CLEANUP_BATCH {
                break;
            }
        }
        assert_eq!(batches, vec![64, 2]);
        let connection = runtime.store.connection.lock().unwrap();
        let blocked: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_job_input_uploads
                 WHERE lifecycle_state='cleanup_blocked'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let cleaned: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_job_input_uploads WHERE cleaned_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((blocked, cleaned), (1, 65));
    }
}
