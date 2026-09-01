use crate::generation_guard::RuntimeGenerationScope;
use breadboard_runtime_protocol::{
    validate_identifier, validate_relative_path, ValidationError, WorkerExecutionScope,
    WorkerIdentity, WorkerInputBlob, WorkerStartManifest, MAX_JOB_INPUT_UPLOAD_BYTES,
    MAX_REQUEST_BODY_BYTES, MAX_WORKER_START_MANIFEST_BYTES, WORKER_START_MANIFEST_FILE,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use thiserror::Error;

const MAX_STAGING_FILE_CREATE_ATTEMPTS: usize = 32;
static NEXT_STAGING_FILE_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum PathError {
    #[error(transparent)]
    InvalidRelative(#[from] ValidationError),
    #[error("resolved path escaped the configured {0} root")]
    EscapedRoot(&'static str),
    #[error("configured {0} root must be absolute")]
    RelativeRoot(&'static str),
    #[error("configured {0} root is unavailable")]
    RootUnavailable(&'static str, #[source] io::Error),
    #[error("configured {0} root is not a directory")]
    RootNotDirectory(&'static str),
    #[error("configured {0} root changed after authority was established")]
    RootChanged(&'static str),
    #[error("resolved path was not minted by this {0} root authority")]
    WrongAuthority(&'static str),
    #[error("trusted path contains a symbolic link or Windows reparse point")]
    ReparsePoint,
    #[error("trusted path is not a regular file")]
    NotRegularFile,
    #[error("trusted mutable file has more than one hard link")]
    MultipleHardLinks,
    #[error("trusted file exceeds its {maximum_bytes}-byte limit")]
    OversizedFile { maximum_bytes: usize },
    #[error("trusted file changed while it was being read")]
    FileChanged,
    #[error("{0} already exists and will not be overwritten")]
    AlreadyStaged(&'static str),
    #[error("staged job input must be bounded canonical JSON")]
    InvalidJobInput,
    #[error("job input blob size must be between 1 and its {maximum_bytes}-byte limit")]
    InvalidBlobSize { maximum_bytes: u64 },
    #[error("job input blob SHA-256 must be 64 lowercase hexadecimal characters")]
    InvalidBlobDigest,
    #[error("job input blob exceeded its declared {declared_bytes}-byte size")]
    BlobOverflow { declared_bytes: u64 },
    #[error(
        "job input blob size mismatch: declared {declared_bytes} bytes but received {actual_bytes}"
    )]
    BlobSizeMismatch {
        declared_bytes: u64,
        actual_bytes: u64,
    },
    #[error("job input blob SHA-256 did not match its declared digest")]
    BlobDigestMismatch,
    #[error("job input blob staging writer is no longer valid")]
    BlobWriterPoisoned,
    #[error("trusted job input cleanup metadata did not match the exact file")]
    BlobCleanupMismatch,
    #[error("trusted filesystem operation failed")]
    Io(#[source] io::Error),
    #[error("trusted child argv path has no safe normal absolute presentation")]
    InvalidChildArgvPath,
    #[error("trusted handle identity is unsupported on this platform")]
    UnsupportedPlatform,
}

#[derive(Clone, PartialEq, Eq)]
struct FileIdentity {
    volume: u64,
    file: u64,
    links: u64,
}

impl fmt::Debug for FileIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("FileIdentity(<redacted>)")
    }
}

#[derive(Clone)]
struct TrustedRoot {
    kind: &'static str,
    canonical: PathBuf,
    identity: FileIdentity,
    // Keeping the directory open pins it against replacement on Windows. The
    // identity comparison also detects replacement on platforms where an open
    // directory can still be renamed.
    _directory: Arc<File>,
}

impl fmt::Debug for TrustedRoot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedRoot")
            .field("kind", &self.kind)
            .field("canonical", &"<redacted>")
            .finish()
    }
}

/// A lexically resolved path selected beneath a trusted root. This value is
/// not by itself proof that an on-disk object is contained by the root:
/// filesystem access must use `RuntimePaths`' handle-backed methods so
/// junctions, symlinks, and path swaps are rejected.
#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedTrustedPath {
    root: PathBuf,
    relative: PathBuf,
    absolute: PathBuf,
}

impl fmt::Debug for ResolvedTrustedPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ResolvedTrustedPath(<redacted>)")
    }
}

impl ResolvedTrustedPath {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn relative(&self) -> &Path {
        &self.relative
    }

    pub fn absolute(&self) -> &Path {
        &self.absolute
    }

    /// Returns an argv spelling for a trusted path without changing the
    /// canonical path that backs containment and identity checks. Windows
    /// language runtimes do not consistently accept the `\\?\` spelling that
    /// `fs::canonicalize` returns, even though CreateProcessW does. Only typed
    /// path operands may call this method; ordinary manifest literals must
    /// retain their exact bytes.
    pub(crate) fn child_argv_path(&self) -> Result<PathBuf, PathError> {
        child_argv_path_presentation(&self.absolute)
    }
}

/// Pins a verified regular file while a trusted subsystem consumes its path.
/// On Windows the handle shares read access only, denying both writers and
/// share-delete replacement between verification and a second trusted opener.
pub struct TrustedFilePin {
    root: TrustedRoot,
    path: ResolvedTrustedPath,
    _file: File,
}

impl fmt::Debug for TrustedFilePin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedFilePin")
            .field("path", &"<redacted>")
            .finish()
    }
}

impl TrustedFilePin {
    pub(crate) fn authority_kind(&self) -> &'static str {
        self.root.kind
    }

    pub fn absolute(&self) -> &Path {
        self.path.absolute()
    }

    /// Presents this still-pinned file as a child argv path. Revalidation and
    /// file identity continue to use the unchanged canonical path.
    pub(crate) fn child_argv_path(&self) -> Result<PathBuf, PathError> {
        self.path.child_argv_path()
    }

    pub fn relative(&self) -> &Path {
        self.path.relative()
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        RuntimeGenerationScope::from_trusted_data_root_identity(
            self.root.identity.volume,
            self.root.identity.file,
        ) == *scope
    }

    /// Revalidates both the authority root and the exact opened file identity.
    /// Process launchers retain this guard through child creation and call this
    /// immediately before allowing a suspended child to execute.
    pub fn revalidate(&self) -> Result<(), PathError> {
        self.root.revalidate()?;
        verify_regular_file(&self.root, &self.path, &self._file, true)?;
        self.root.revalidate()
    }

    /// Re-reads this exact already-opened file handle while retaining its
    /// Windows no-share-write/no-share-delete authority. This is stronger than
    /// reopening the pathname: callers can compare content immediately before
    /// committing a durable decision without releasing the handle that fenced
    /// mutation and replacement after the first validation.
    pub(crate) fn read_bounded_revalidated(
        &self,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        let mut file = self._file.try_clone().map_err(PathError::Io)?;
        read_bounded_open_file(&self.root, &self.path, &mut file, maximum_bytes)
    }
}

/// Pins a verified directory against replacement for the guard's lifetime.
pub struct TrustedDirectoryPin {
    root: TrustedRoot,
}

impl fmt::Debug for TrustedDirectoryPin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedDirectoryPin")
            .field("root", &"<redacted>")
            .finish()
    }
}

impl TrustedDirectoryPin {
    /// Establishes and pins one existing absolute directory root using the
    /// same canonical-path, open-handle, and filesystem-identity checks as
    /// `RuntimePaths`.
    pub fn pin_existing(kind: &'static str, value: impl Into<PathBuf>) -> Result<Self, PathError> {
        Ok(Self {
            root: establish_root(kind, value.into())?,
        })
    }

    pub fn absolute(&self) -> &Path {
        &self.root.canonical
    }

    /// Fails if the pinned pathname no longer resolves to the directory whose
    /// identity was established when this guard was created.
    pub fn revalidate(&self) -> Result<(), PathError> {
        self.root.revalidate()
    }

    /// Reads one bounded regular file beneath this exact pinned directory.
    /// The relative path is reparse/hard-link checked and the file is read
    /// through a no-share-write/no-share-delete handle, so configuration is
    /// consumed as one stable snapshot rather than by reopening a mutable
    /// pathname during parsing.
    pub fn read_bounded_file(
        &self,
        relative: &str,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        let path = resolve_inside(&self.root, relative)?;
        read_bounded(&self.root, &path, maximum_bytes)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LaunchDirectoryAuthority {
    RuntimeData,
    Application,
}

/// An opaque process working-directory authority. Unlike
/// `TrustedDirectoryPin`, this type cannot be created from an arbitrary
/// absolute directory: only `RuntimePaths` can mint it after proving the
/// directory is beneath a manifest-selected pinned app or mutable-data root.
pub struct TrustedLaunchDirectory {
    authority_root: TrustedRoot,
    directory: TrustedDirectoryPin,
    authority: LaunchDirectoryAuthority,
}

impl fmt::Debug for TrustedLaunchDirectory {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TrustedLaunchDirectory(<redacted launch authority>)")
    }
}

impl TrustedLaunchDirectory {
    pub fn absolute(&self) -> &Path {
        self.directory.absolute()
    }

    /// Returns the normal absolute spelling presented to a child process.
    ///
    /// Windows handle pinning deliberately retains the verbatim `\\?\` path
    /// for identity and revalidation, but Node-based tools do not consistently
    /// accept that spelling as their process working directory. This derives a
    /// presentation-only path from the already-pinned authority; it never
    /// replaces or weakens the canonical handle-backed identity.
    pub(crate) fn child_process_path(&self) -> Result<PathBuf, PathError> {
        child_argv_path_presentation(self.directory.absolute())
    }

    /// Revalidates the minting data root, the exact directory handle identity,
    /// and containment. The private authority tag prevents a configuration
    /// root pin from being relabeled as a launch workspace.
    pub fn revalidate(&self) -> Result<(), PathError> {
        match self.authority {
            LaunchDirectoryAuthority::RuntimeData | LaunchDirectoryAuthority::Application => {
                self.authority_root.revalidate()?;
                self.directory.revalidate()?;
                if !path_is_within(self.directory.absolute(), &self.authority_root.canonical) {
                    return Err(PathError::EscapedRoot(self.authority_root.kind));
                }
                self.authority_root.revalidate()
            }
        }
    }
}

/// A complete per-job layout proved to be lexically beneath the configured
/// mutable-data root. All actual filesystem access must still go through the
/// handle-backed authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrustedJobPaths {
    input_manifest: ResolvedTrustedPath,
    workspace: ResolvedTrustedPath,
    checkpoint: ResolvedTrustedPath,
    result: ResolvedTrustedPath,
}

/// Runtime-minted attempt launch material. The fixed argument is always
/// `start.json`; request content and data-root paths are carried by the pinned
/// file instead of expanding the process argv. These guards must remain alive
/// through launch (and, where the platform permits, worker consumption).
pub(crate) struct PreparedWorkerStart {
    manifest: WorkerStartManifest,
    job_directory: TrustedDirectoryPin,
    input_manifest: TrustedFilePin,
    input_blobs: Vec<SealedJobInputBlob>,
    launch_directory: TrustedLaunchDirectory,
    workspace_directory: TrustedDirectoryPin,
    start_manifest: TrustedFilePin,
}

impl fmt::Debug for PreparedWorkerStart {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedWorkerStart")
            .field("identity", &self.manifest.identity)
            .field("paths", &"<redacted runtime-data authority>")
            .finish()
    }
}

impl PreparedWorkerStart {
    pub(crate) fn manifest(&self) -> &WorkerStartManifest {
        &self.manifest
    }

    pub(crate) fn launch_directory(&self) -> &TrustedLaunchDirectory {
        &self.launch_directory
    }

    pub(crate) const fn start_manifest_argument(&self) -> &'static str {
        WORKER_START_MANIFEST_FILE
    }

    pub(crate) fn revalidate(&self) -> Result<(), PathError> {
        self.job_directory.revalidate()?;
        self.input_manifest.revalidate()?;
        for input_blob in &self.input_blobs {
            input_blob.revalidate()?;
        }
        self.launch_directory.revalidate()?;
        self.workspace_directory.revalidate()?;
        self.start_manifest.revalidate()?;
        Ok(())
    }
}

#[derive(Debug)]
struct TrustedWorkerAttemptPaths {
    job_directory: ResolvedTrustedPath,
    input_manifest: ResolvedTrustedPath,
    launch_directory: ResolvedTrustedPath,
    workspace: ResolvedTrustedPath,
    checkpoint: ResolvedTrustedPath,
    result: ResolvedTrustedPath,
    start_manifest: ResolvedTrustedPath,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingDestinationPolicy {
    Reject,
    MatchExactBytes,
}

struct TemporaryStagingFile {
    path: ResolvedTrustedPath,
    file: File,
    identity: FileIdentity,
    published: bool,
}

/// A bounded, one-shot writer for one runtime-minted job input blob. The
/// destination and unique unpublished sibling are derived exclusively from
/// validated job/blob identifiers; callers never supply a filesystem path.
#[must_use = "an unsealed job input blob is deleted when its staging authority is dropped"]
pub struct JobInputBlobStaging {
    paths: RuntimePaths,
    blob_directory: TrustedDirectoryPin,
    destination: ResolvedTrustedPath,
    staging: TemporaryStagingFile,
    declared_size: u64,
    expected_sha256: Option<[u8; 32]>,
    streamed_sha256: Sha256,
    written: u64,
    poisoned: bool,
}

impl fmt::Debug for JobInputBlobStaging {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("JobInputBlobStaging")
            .field("declared_size", &self.declared_size)
            .field("written", &self.written)
            .field("authority", &"<redacted runtime-data blob authority>")
            .finish()
    }
}

impl Write for JobInputBlobStaging {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.poisoned {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                PathError::BlobWriterPoisoned,
            ));
        }
        if bytes.is_empty() {
            return Ok(0);
        }
        let requested = u64::try_from(bytes.len()).map_err(|_| {
            self.poisoned = true;
            io::Error::new(
                io::ErrorKind::InvalidInput,
                PathError::BlobOverflow {
                    declared_bytes: self.declared_size,
                },
            )
        })?;
        let next = self.written.checked_add(requested).ok_or_else(|| {
            self.poisoned = true;
            io::Error::new(
                io::ErrorKind::InvalidInput,
                PathError::BlobOverflow {
                    declared_bytes: self.declared_size,
                },
            )
        })?;
        if next > self.declared_size {
            self.poisoned = true;
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                PathError::BlobOverflow {
                    declared_bytes: self.declared_size,
                },
            ));
        }

        match self.staging.file.write(bytes) {
            Ok(written) => {
                self.streamed_sha256.update(&bytes[..written]);
                self.written += written as u64;
                Ok(written)
            }
            Err(error) => {
                self.poisoned = true;
                Err(error)
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.poisoned {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                PathError::BlobWriterPoisoned,
            ));
        }
        if let Err(error) = self.staging.file.flush() {
            self.poisoned = true;
            return Err(error);
        }
        Ok(())
    }
}

impl JobInputBlobStaging {
    /// Publishes the exact received bytes once. Size/digest mismatches leave no
    /// final path, and a pre-existing or racing destination is never replaced.
    pub fn seal(mut self) -> Result<SealedJobInputBlob, PathError> {
        if self.poisoned {
            return Err(PathError::BlobWriterPoisoned);
        }
        if self.written != self.declared_size {
            return Err(PathError::BlobSizeMismatch {
                declared_bytes: self.declared_size,
                actual_bytes: self.written,
            });
        }

        self.flush().map_err(PathError::Io)?;
        self.staging.file.sync_all().map_err(PathError::Io)?;
        let before = verify_regular_file(
            &self.paths.data_root,
            &self.staging.path,
            &self.staging.file,
            true,
        )?;
        let metadata_size = self.staging.file.metadata().map_err(PathError::Io)?.len();
        if metadata_size != self.declared_size {
            return Err(PathError::FileChanged);
        }

        let streamed_sha256: [u8; 32] = self.streamed_sha256.clone().finalize().into();
        let on_disk_sha256 = hash_open_file(&mut self.staging.file, self.declared_size)?;
        let after = verify_regular_file(
            &self.paths.data_root,
            &self.staging.path,
            &self.staging.file,
            true,
        )?;
        if before != after || streamed_sha256 != on_disk_sha256 {
            return Err(PathError::FileChanged);
        }
        if self
            .expected_sha256
            .is_some_and(|expected| on_disk_sha256 != expected)
        {
            return Err(PathError::BlobDigestMismatch);
        }

        self.paths.data_root.revalidate()?;
        self.blob_directory.revalidate()?;
        reject_parent_link_components(
            &self.paths.data_root.canonical,
            self.destination.absolute(),
        )?;
        reject_blob_destination(self.destination.absolute())?;
        if let Err(error) =
            install_file_no_replace(self.staging.path.absolute(), self.destination.absolute())
        {
            if error.kind() == io::ErrorKind::AlreadyExists
                || fs::symlink_metadata(self.destination.absolute()).is_ok()
            {
                reject_blob_destination(self.destination.absolute())?;
            }
            return Err(PathError::Io(error));
        }
        self.staging.published = true;
        sync_installed_parent(self.destination.absolute())?;
        let installed_identity = verify_regular_file(
            &self.paths.data_root,
            &self.destination,
            &self.staging.file,
            true,
        )?;
        drop(self.staging);

        let pinned = self.paths.pin_existing_data_file(&self.destination)?;
        let pinned_identity = file_identity(&pinned._file)?;
        if installed_identity != pinned_identity {
            return Err(PathError::FileChanged);
        }
        let sealed = SealedJobInputBlob {
            blob_directory: self.blob_directory,
            file: pinned,
            size: self.declared_size,
            sha256: digest_hex(&on_disk_sha256),
        };
        sealed.revalidate()?;
        Ok(sealed)
    }
}

/// A non-forgeable pin for one sealed job input blob. It intentionally exposes
/// only immutable metadata; the host path remains confined to `RuntimePaths`.
#[must_use = "the sealed blob pin must remain alive through worker launch"]
pub struct SealedJobInputBlob {
    blob_directory: TrustedDirectoryPin,
    file: TrustedFilePin,
    size: u64,
    sha256: String,
}

impl fmt::Debug for SealedJobInputBlob {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SealedJobInputBlob")
            .field("size", &self.size)
            .field("authority", &"<redacted runtime-data blob authority>")
            .finish()
    }
}

impl SealedJobInputBlob {
    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    pub fn relative_path(&self) -> &Path {
        self.file.relative()
    }

    /// Revalidates the pinned directory and file identities and re-hashes the
    /// exact final bytes, detecting replacement or mutation before launch.
    pub fn revalidate(&self) -> Result<(), PathError> {
        self.blob_directory.revalidate()?;
        self.file.revalidate()?;
        let mut verifier = open_read_pinned(self.file.path.absolute()).map_err(PathError::Io)?;
        let before = verify_regular_file(&self.file.root, &self.file.path, &verifier, true)?;
        let pinned_identity = file_identity(&self.file._file)?;
        if before != pinned_identity
            || verifier.metadata().map_err(PathError::Io)?.len() != self.size
        {
            return Err(PathError::FileChanged);
        }
        let digest = hash_open_file(&mut verifier, self.size)?;
        let after = verify_regular_file(&self.file.root, &self.file.path, &verifier, true)?;
        if before != after || digest_hex(&digest) != self.sha256 {
            return Err(PathError::FileChanged);
        }
        self.file.revalidate()?;
        self.blob_directory.revalidate()
    }
}

impl Drop for TemporaryStagingFile {
    fn drop(&mut self) {
        // Publication moves/unlinks this sibling, so NotFound is the ordinary
        // success case. On every error path this is a best-effort cleanup; a
        // process crash may leave one unique orphan, but it cannot block a
        // later call because no fixed pending name is reused.
        if self.published {
            return;
        }
        let Ok(candidate) = open_staging_cleanup_candidate(self.path.absolute()) else {
            return;
        };
        let Ok(candidate_identity) = file_identity(&candidate) else {
            return;
        };
        if candidate_identity.volume != self.identity.volume
            || candidate_identity.file != self.identity.file
        {
            return;
        }
        drop(candidate);
        let _ = fs::remove_file(self.path.absolute());
    }
}

impl TrustedJobPaths {
    pub(crate) fn input_manifest_relative(&self) -> String {
        path_text(self.input_manifest.relative())
    }

    pub(crate) fn workspace_relative(&self) -> String {
        path_text(self.workspace.relative())
    }

    pub(crate) fn checkpoint_relative(&self) -> String {
        path_text(self.checkpoint.relative())
    }

    pub(crate) fn result_relative(&self) -> String {
        path_text(self.result.relative())
    }

    pub(crate) fn result(&self) -> &ResolvedTrustedPath {
        &self.result
    }
}

#[derive(Clone)]
pub struct RuntimePaths {
    data_root: TrustedRoot,
    app_root: TrustedRoot,
    runtime_root: TrustedRoot,
}

impl fmt::Debug for RuntimePaths {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RuntimePaths")
            .field("data_root", &"<redacted>")
            .field("app_root", &"<redacted>")
            .field("runtime_root", &"<redacted>")
            .finish()
    }
}

fn worker_diagnostic_log_relative(identity: &WorkerIdentity) -> String {
    format!(
        "runtime/jobs/{}/attempts/{}/{}/diagnostics.log",
        identity.job_id, identity.attempt, identity.worker_instance_id
    )
}

impl RuntimePaths {
    /// Appends one already-sanitized service diagnostic to a bounded
    /// Runtime-owned log. The entire retained tail is replaced atomically so a
    /// crash can leave either the previous valid log or the new valid log, but
    /// never a partially written compatibility artifact.
    pub(crate) fn append_bounded_service_log(
        &self,
        service_id: &str,
        record: &[u8],
        maximum_bytes: usize,
    ) -> Result<(), PathError> {
        validate_identifier("serviceId", service_id)?;
        let relative = format!("logs/services/{service_id}.log");
        self.append_bounded_diagnostic_log(&relative, record, maximum_bytes)
    }

    /// Appends one already-sanitized worker diagnostic to the exact durable
    /// attempt log selected by Runtime-owned fencing identity. A caller cannot
    /// supply a path or collapse two attempts into the same file.
    pub(crate) fn append_bounded_worker_log(
        &self,
        identity: &WorkerIdentity,
        record: &[u8],
        maximum_bytes: usize,
    ) -> Result<(), PathError> {
        identity.validate()?;
        let relative = worker_diagnostic_log_relative(identity);
        self.append_bounded_diagnostic_log(&relative, record, maximum_bytes)
    }

    fn append_bounded_diagnostic_log(
        &self,
        relative: &str,
        record: &[u8],
        maximum_bytes: usize,
    ) -> Result<(), PathError> {
        if record.is_empty() || maximum_bytes == 0 || record.len() > maximum_bytes {
            return Err(PathError::OversizedFile { maximum_bytes });
        }
        let destination = self.resolve_data(relative)?;
        let mut retained = match read_bounded(&self.data_root, &destination, maximum_bytes) {
            Ok(bytes) => bytes,
            Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error),
        };
        if !retained.is_empty() && !retained.ends_with(b"\n") {
            retained.push(b'\n');
        }
        retained.extend_from_slice(record);
        if !retained.ends_with(b"\n") {
            retained.push(b'\n');
        }
        if retained.len() > maximum_bytes {
            let overflow = retained.len() - maximum_bytes;
            let start = retained[overflow..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|relative| overflow + relative + 1)
                .unwrap_or(overflow);
            retained.drain(..start);
        }
        if retained.is_empty() {
            retained.push(b'\n');
        }
        drop(self.atomic_replace_data_file(relative, &retained, maximum_bytes)?);
        Ok(())
    }

    /// Reads the already-redacted bounded diagnostic file for one exact
    /// manifest service. Control adapters may further project a small tail,
    /// but they never receive a caller-selected path.
    pub fn read_bounded_service_log(
        &self,
        service_id: &str,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        validate_identifier("serviceId", service_id)?;
        let relative = format!("logs/services/{service_id}.log");
        self.read_bounded_diagnostic_log(&relative, maximum_bytes)
    }

    /// Reads the already-redacted diagnostic tail for one exact worker
    /// attempt. The identity is validated as a closed fence; no path text is
    /// accepted from a control caller.
    pub fn read_bounded_worker_log(
        &self,
        identity: &WorkerIdentity,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        identity.validate()?;
        let relative = worker_diagnostic_log_relative(identity);
        self.read_bounded_diagnostic_log(&relative, maximum_bytes)
    }

    fn read_bounded_diagnostic_log(
        &self,
        relative: &str,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        if maximum_bytes == 0 {
            return Err(PathError::OversizedFile { maximum_bytes });
        }
        let path = self.resolve_data(relative)?;
        match read_bounded(&self.data_root, &path, maximum_bytes) {
            Ok(bytes) => Ok(bytes),
            Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error),
        }
    }

    /// Establishes authority over three existing directory roots. Every root is
    /// canonicalized, opened, and identity-pinned. A merely lexical absolute
    /// path is deliberately not treated as trusted.
    pub fn new(
        data_root: impl Into<PathBuf>,
        app_root: impl Into<PathBuf>,
        runtime_root: impl Into<PathBuf>,
    ) -> Result<Self, PathError> {
        Ok(Self {
            data_root: establish_root("data", data_root.into())?,
            app_root: establish_root("application", app_root.into())?,
            runtime_root: establish_root("runtime", runtime_root.into())?,
        })
    }

    pub fn data_root(&self) -> &Path {
        &self.data_root.canonical
    }

    pub fn app_root(&self) -> &Path {
        &self.app_root.canonical
    }

    pub fn runtime_root(&self) -> &Path {
        &self.runtime_root.canonical
    }

    /// Reports whether Electron established a mutable data authority distinct
    /// from the application authority. Compare the pinned directory identities
    /// rather than caller-provided spellings so aliases cannot opt a service
    /// into an isolated-development path.
    pub(crate) fn has_distinct_data_root(&self) -> bool {
        self.data_root.identity.volume != self.app_root.identity.volume
            || self.data_root.identity.file != self.app_root.identity.file
    }

    /// Mints the opaque generation namespace for this exact pinned mutable
    /// data root. Application and executable roots deliberately do not
    /// participate: generation ownership protects the runtime data and
    /// database identified by the already-opened data-root handle.
    pub fn runtime_generation_scope(&self) -> RuntimeGenerationScope {
        RuntimeGenerationScope::from_trusted_data_root_identity(
            self.data_root.identity.volume,
            self.data_root.identity.file,
        )
    }

    pub fn resolve_data(&self, relative: &str) -> Result<ResolvedTrustedPath, PathError> {
        resolve_inside(&self.data_root, relative)
    }

    pub fn resolve_app(&self, relative: &str) -> Result<ResolvedTrustedPath, PathError> {
        resolve_inside(&self.app_root, relative)
    }

    pub fn resolve_runtime(&self, relative: &str) -> Result<ResolvedTrustedPath, PathError> {
        resolve_inside(&self.runtime_root, relative)
    }

    /// Reads one existing application file through a verified handle. The byte
    /// ceiling is checked against handle metadata and during the read.
    pub fn read_bounded_app_file(
        &self,
        path: &ResolvedTrustedPath,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        read_bounded(&self.app_root, path, maximum_bytes)
    }

    /// Reads one immutable runtime manifest through the separately pinned
    /// executable/manifest authority. Application entrypoints are not minted
    /// by this root.
    pub fn read_bounded_runtime_file(
        &self,
        path: &ResolvedTrustedPath,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        read_bounded(&self.runtime_root, path, maximum_bytes)
    }

    /// Pins an executable or entrypoint against mutation/replacement while the
    /// process owner creates the target suspended and verifies its image.
    pub fn pin_app_file_for_launch(
        &self,
        path: &ResolvedTrustedPath,
    ) -> Result<TrustedFilePin, PathError> {
        validate_authority(&self.app_root, path)?;
        self.app_root.revalidate()?;
        reject_link_components(&self.app_root.canonical, path.absolute())?;
        let file = open_read_pinned(path.absolute()).map_err(PathError::Io)?;
        verify_regular_file(&self.app_root, path, &file, true)?;
        self.app_root.revalidate()?;
        Ok(TrustedFilePin {
            root: self.app_root.clone(),
            path: path.clone(),
            _file: file,
        })
    }

    /// Pins a predefined executable beneath runtimeRoot. Entrypoints remain
    /// separately pinned beneath appRoot so neither authority can mint a path
    /// belonging to the other.
    pub fn pin_runtime_file_for_launch(
        &self,
        path: &ResolvedTrustedPath,
    ) -> Result<TrustedFilePin, PathError> {
        validate_authority(&self.runtime_root, path)?;
        self.runtime_root.revalidate()?;
        reject_link_components(&self.runtime_root.canonical, path.absolute())?;
        let file = open_read_pinned(path.absolute()).map_err(PathError::Io)?;
        verify_regular_file(&self.runtime_root, path, &file, true)?;
        self.runtime_root.revalidate()?;
        Ok(TrustedFilePin {
            root: self.runtime_root.clone(),
            path: path.clone(),
            _file: file,
        })
    }

    /// Pins an existing setup-produced executable beneath the mutable data
    /// root. Relative-path validation, root identity revalidation, reparse and
    /// symlink rejection, exact opened-path verification, and single-link
    /// enforcement are identical to immutable launch pins. This does not
    /// create or update the file and cannot accept an absolute caller path.
    pub fn pin_data_file_for_launch(
        &self,
        path: &ResolvedTrustedPath,
    ) -> Result<TrustedFilePin, PathError> {
        self.pin_existing_data_file(path)
    }

    /// Opens one exact data file with read-only sharing, validates and reads it
    /// through that handle, then returns both the bounded bytes and the still-
    /// live pin. The caller must retain the pin through the durable operation
    /// authorized by those bytes.
    pub(crate) fn read_bounded_data_file_with_pin(
        &self,
        path: &ResolvedTrustedPath,
        maximum_bytes: usize,
    ) -> Result<(Vec<u8>, TrustedFilePin), PathError> {
        let pin = self.pin_existing_data_file(path)?;
        let bytes = pin.read_bounded_revalidated(maximum_bytes)?;
        Ok((bytes, pin))
    }

    /// Creates without truncation, or opens, a mutable data file and keeps a
    /// verified handle alive. The host retains this guard while another
    /// trusted library opens the same pathname.
    pub fn pin_data_file_for_update(
        &self,
        path: &ResolvedTrustedPath,
    ) -> Result<TrustedFilePin, PathError> {
        validate_authority(&self.data_root, path)?;
        self.data_root.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, path.absolute())?;
        let file = open_or_create_pinned_file(path.absolute()).map_err(PathError::Io)?;
        verify_regular_file(&self.data_root, path, &file, true)?;
        self.data_root.revalidate()?;
        Ok(TrustedFilePin {
            root: self.data_root.clone(),
            path: path.clone(),
            _file: file,
        })
    }

    /// Creates and pins a directory beneath the data root. Existing symlink,
    /// junction, or reparse components are rejected after creation and again
    /// after the directory handle is acquired.
    pub fn prepare_data_directory(&self, relative: &str) -> Result<TrustedDirectoryPin, PathError> {
        let path = self.resolve_data(relative)?;
        self.data_root.revalidate()?;
        let directory = create_directory_chain(&self.data_root, &path)?;
        reject_link_components(&self.data_root.canonical, path.absolute())?;
        let metadata = directory.metadata().map_err(PathError::Io)?;
        if !metadata.is_dir() {
            return Err(PathError::RootNotDirectory("prepared data"));
        }
        let actual = opened_final_path(&directory, path.absolute())?;
        if !path_is_within(&actual, &self.data_root.canonical) {
            return Err(PathError::EscapedRoot("data"));
        }
        reject_link_components(&self.data_root.canonical, path.absolute())?;
        self.data_root.revalidate()?;
        let identity = file_identity(&directory)?;
        Ok(TrustedDirectoryPin {
            root: TrustedRoot {
                kind: "prepared data",
                canonical: path.absolute,
                identity,
                _directory: Arc::new(directory),
            },
        })
    }

    /// Atomically replaces one bounded Runtime-owned configuration file below
    /// the pinned data root. Generated service configuration is mutable across
    /// launches, unlike immutable submitted job inputs.
    pub fn atomic_replace_data_file(
        &self,
        relative: &str,
        bytes: &[u8],
        maximum_bytes: usize,
    ) -> Result<TrustedFilePin, PathError> {
        if bytes.is_empty() || bytes.len() > maximum_bytes {
            return Err(PathError::OversizedFile { maximum_bytes });
        }
        let destination = self.resolve_data(relative)?;
        let parent = destination
            .relative()
            .parent()
            .ok_or(PathError::EscapedRoot("data"))?;
        let parent = path_text(parent);
        let parent_pin = self.prepare_data_directory(&parent)?;
        self.data_root.revalidate()?;
        parent_pin.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, destination.absolute())?;

        match fs::symlink_metadata(destination.absolute()) {
            Ok(_) => {
                // Prove the old destination is an ordinary one-link file under
                // this exact root before granting replacement authority.
                drop(self.pin_existing_data_file(&destination)?);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(PathError::Io(error)),
        }

        let mut staging = self.create_temporary_staging_file(&destination)?;
        staging.file.write_all(bytes).map_err(PathError::Io)?;
        staging.file.flush().map_err(PathError::Io)?;
        staging.file.sync_all().map_err(PathError::Io)?;
        verify_regular_file(&self.data_root, &staging.path, &staging.file, true)?;
        install_file_replace(staging.path.absolute(), destination.absolute())
            .map_err(PathError::Io)?;
        staging.published = true;
        sync_installed_parent(destination.absolute())?;
        drop(staging);

        let pinned = self.pin_existing_data_file(&destination)?;
        let installed = pinned.read_bounded_revalidated(maximum_bytes)?;
        if installed != bytes {
            return Err(PathError::FileChanged);
        }
        parent_pin.revalidate()?;
        self.data_root.revalidate()?;
        Ok(pinned)
    }

    /// Creates the only directory capability accepted by the authoritative
    /// process launcher. The returned value is provenance-sealed to this
    /// `RuntimePaths` data root and cannot be forged from `pin_existing`.
    pub fn prepare_launch_directory(
        &self,
        relative: &str,
    ) -> Result<TrustedLaunchDirectory, PathError> {
        let directory = self.prepare_data_directory(relative)?;
        let launch = TrustedLaunchDirectory {
            authority_root: self.data_root.clone(),
            directory,
            authority: LaunchDirectoryAuthority::RuntimeData,
        };
        launch.revalidate()?;
        Ok(launch)
    }

    /// Pins an immutable, manifest-selected application directory as service
    /// cwd authority. This remains crate-private so downstream callers cannot
    /// relabel arbitrary application paths as launch directories; Registry is
    /// the only intended selector.
    pub(crate) fn pin_app_launch_directory(
        &self,
        relative: &str,
    ) -> Result<TrustedLaunchDirectory, PathError> {
        let path = self.resolve_app(relative)?;
        let directory =
            pin_existing_directory_inside(&self.app_root, &path, "application launch directory")?;
        let launch = TrustedLaunchDirectory {
            authority_root: self.app_root.clone(),
            directory,
            authority: LaunchDirectoryAuthority::Application,
        };
        launch.revalidate()?;
        Ok(launch)
    }

    /// Pins an existing manifest-selected mutable service directory as cwd.
    /// Unlike per-job `prepare_launch_directory`, this does not create a
    /// missing toolchain root: installation probes must establish it first.
    pub(crate) fn pin_data_launch_directory(
        &self,
        relative: &str,
    ) -> Result<TrustedLaunchDirectory, PathError> {
        let path = self.resolve_data(relative)?;
        let directory =
            pin_existing_directory_inside(&self.data_root, &path, "runtime data launch directory")?;
        let launch = TrustedLaunchDirectory {
            authority_root: self.data_root.clone(),
            directory,
            authority: LaunchDirectoryAuthority::RuntimeData,
        };
        launch.revalidate()?;
        Ok(launch)
    }

    /// Mints the pinned application root itself as a service cwd. This is a
    /// separate closed operation because the manifest's `app-root` policy has
    /// no relative path and must not be represented by an empty or dot path.
    pub(crate) fn pin_app_root_launch_directory(
        &self,
    ) -> Result<TrustedLaunchDirectory, PathError> {
        self.app_root.revalidate()?;
        let launch = TrustedLaunchDirectory {
            authority_root: self.app_root.clone(),
            directory: TrustedDirectoryPin {
                root: self.app_root.clone(),
            },
            authority: LaunchDirectoryAuthority::Application,
        };
        launch.revalidate()?;
        Ok(launch)
    }

    /// Installs canonical submission bytes at the fixed job input path. An
    /// existing byte-for-byte match is returned idempotently; any conflicting
    /// file fails closed. A completed unique sibling is published atomically
    /// without replacing an earlier or racing submission.
    pub(crate) fn stage_job_input(
        &self,
        job_id: &str,
        canonical_request_payload: &[u8],
    ) -> Result<TrustedFilePin, PathError> {
        validate_identifier("jobId", job_id)?;
        validate_canonical_job_input(canonical_request_payload)?;
        let job_directory = format!("runtime/jobs/{job_id}");
        let _job_directory_pin = self.prepare_data_directory(&job_directory)?;
        let input = self.resolve_data(&format!("{job_directory}/input.json"))?;
        self.atomic_write_new_data_file(
            &input,
            canonical_request_payload,
            MAX_REQUEST_BODY_BYTES,
            "job input",
            ExistingDestinationPolicy::MatchExactBytes,
        )
    }

    /// Mints one private bounded staging authority beneath the exact job/blob
    /// namespace. Validation completes before any directory or file is made.
    pub fn begin_job_input_blob_staging(
        &self,
        job_id: &str,
        blob_id: &str,
        declared_size: u64,
        maximum_bytes: u64,
        expected_sha256: &str,
    ) -> Result<JobInputBlobStaging, PathError> {
        validate_identifier("jobId", job_id)?;
        validate_identifier("blobId", blob_id)?;
        if declared_size == 0 || maximum_bytes == 0 || declared_size > maximum_bytes {
            return Err(PathError::InvalidBlobSize { maximum_bytes });
        }
        let expected_sha256 = parse_digest_hex(expected_sha256)?;

        let blob_root = format!("runtime/jobs/{job_id}/inputs/{blob_id}");
        let blob_directory = self.prepare_data_directory(&blob_root)?;
        let destination = self.resolve_data(&format!("{blob_root}/payload"))?;
        self.data_root.revalidate()?;
        blob_directory.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, destination.absolute())?;
        reject_blob_destination(destination.absolute())?;
        let staging = self.create_temporary_staging_file(&destination)?;

        Ok(JobInputBlobStaging {
            paths: self.clone(),
            blob_directory,
            destination,
            staging,
            declared_size,
            expected_sha256: Some(expected_sha256),
            streamed_sha256: Sha256::new(),
            written: 0,
            poisoned: false,
        })
    }

    /// Opens the one deterministic pending file for a durable upload ticket.
    /// The upload id and size come from the runtime ledger; neither a caller
    /// path nor a caller digest participates. `seal` computes the authoritative
    /// SHA-256 from the streamed bytes before publishing `payload`.
    pub(crate) fn begin_runtime_job_input_upload_staging(
        &self,
        upload_id: &str,
        declared_size: u64,
        maximum_bytes: u64,
    ) -> Result<JobInputBlobStaging, PathError> {
        validate_identifier("uploadId", upload_id)?;
        if declared_size == 0
            || maximum_bytes == 0
            || declared_size > maximum_bytes
            || maximum_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
        {
            return Err(PathError::InvalidBlobSize { maximum_bytes });
        }

        let upload_root = format!("runtime/uploads/{upload_id}");
        let upload_directory = self.prepare_data_directory(&upload_root)?;
        let destination = self.resolve_data(&format!("{upload_root}/payload"))?;
        let pending = self.resolve_data(&format!("{upload_root}/payload.pending"))?;
        self.data_root.revalidate()?;
        upload_directory.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, destination.absolute())?;
        reject_blob_destination(destination.absolute())?;
        let staging = self.create_exact_temporary_staging_file(&pending)?;

        Ok(JobInputBlobStaging {
            paths: self.clone(),
            blob_directory: upload_directory,
            destination,
            staging,
            declared_size,
            expected_sha256: None,
            streamed_sha256: Sha256::new(),
            written: 0,
            poisoned: false,
        })
    }

    /// Publishes a verified sealed upload into the exact job/blob namespace.
    /// The source is copied through pinned handles into a unique sibling and
    /// installed without replacement. A byte-identical destination is an
    /// idempotent replay; any mismatch fails closed before the job is queued.
    pub(crate) fn stage_adopted_job_input_blob(
        &self,
        job_id: &str,
        blob_id: &str,
        source: &SealedJobInputBlob,
    ) -> Result<SealedJobInputBlob, PathError> {
        validate_identifier("jobId", job_id)?;
        validate_identifier("blobId", blob_id)?;
        source.revalidate()?;
        let blob_root = format!("runtime/jobs/{job_id}/inputs/{blob_id}");
        let blob_directory = self.prepare_data_directory(&blob_root)?;
        let destination = self.resolve_data(&format!("{blob_root}/payload"))?;
        if fs::symlink_metadata(destination.absolute()).is_ok() {
            return self.pin_exact_sealed_blob(
                blob_directory,
                destination,
                source.size,
                &source.sha256,
                "adopted job input blob",
            );
        }

        let mut staging = self.create_temporary_staging_file(&destination)?;
        let mut input = source.file._file.try_clone().map_err(PathError::Io)?;
        input.seek(SeekFrom::Start(0)).map_err(PathError::Io)?;
        let source_before =
            verify_regular_file(&source.file.root, &source.file.path, &input, true)?;
        let mut digest = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input.read(&mut buffer).map_err(PathError::Io)?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read as u64)
                .ok_or(PathError::FileChanged)?;
            if total > source.size {
                return Err(PathError::FileChanged);
            }
            staging
                .file
                .write_all(&buffer[..read])
                .map_err(PathError::Io)?;
            digest.update(&buffer[..read]);
        }
        let source_after = verify_regular_file(&source.file.root, &source.file.path, &input, true)?;
        let copied_sha256 = digest_hex(&digest.finalize().into());
        if source_before != source_after || total != source.size || copied_sha256 != source.sha256 {
            return Err(PathError::FileChanged);
        }
        staging.file.flush().map_err(PathError::Io)?;
        staging.file.sync_all().map_err(PathError::Io)?;
        verify_regular_file(&self.data_root, &staging.path, &staging.file, true)?;

        if let Err(error) = install_file_no_replace(staging.path.absolute(), destination.absolute())
        {
            if error.kind() == io::ErrorKind::AlreadyExists
                || fs::symlink_metadata(destination.absolute()).is_ok()
            {
                return self.pin_exact_sealed_blob(
                    blob_directory,
                    destination,
                    source.size,
                    &source.sha256,
                    "adopted job input blob",
                );
            }
            return Err(PathError::Io(error));
        }
        staging.published = true;
        sync_installed_parent(destination.absolute())?;
        drop(staging);
        self.pin_exact_sealed_blob(
            blob_directory,
            destination,
            source.size,
            &source.sha256,
            "adopted job input blob",
        )
    }

    pub(crate) fn pin_runtime_job_input_upload(
        &self,
        upload_id: &str,
        size: u64,
        sha256: &str,
    ) -> Result<SealedJobInputBlob, PathError> {
        validate_identifier("uploadId", upload_id)?;
        let root = format!("runtime/uploads/{upload_id}");
        let directory = self.prepare_data_directory(&root)?;
        let path = self.resolve_data(&format!("{root}/payload"))?;
        self.pin_exact_sealed_blob(directory, path, size, sha256, "job input upload")
    }

    /// Removes only the exact derived upload files after validating their
    /// regular-file identity and durable size/digest metadata. Missing files
    /// are idempotent; a mismatch is retained for explicit reconciliation.
    pub(crate) fn cleanup_runtime_job_input_upload(
        &self,
        upload_id: &str,
        maximum_size: Option<u64>,
        expected_sha256: Option<&str>,
    ) -> Result<bool, PathError> {
        validate_identifier("uploadId", upload_id)?;
        if maximum_size.is_some_and(|size| size == 0 || size > MAX_JOB_INPUT_UPLOAD_BYTES) {
            return Err(PathError::BlobCleanupMismatch);
        }
        if let Some(digest) = expected_sha256 {
            parse_digest_hex(digest)?;
        }
        let root = format!("runtime/uploads/{upload_id}");
        let mut removed = false;
        for (name, require_exact_size) in [("payload.pending", false), ("payload", true)] {
            let path = self.resolve_data(&format!("{root}/{name}"))?;
            removed |= self.remove_verified_blob_file(
                &path,
                maximum_size,
                require_exact_size.then_some(expected_sha256).flatten(),
                require_exact_size,
            )?;
        }
        let directory = self.resolve_data(&root)?;
        if fs::remove_dir(directory.absolute()).is_ok() {
            sync_installed_parent(directory.absolute())?;
        }
        Ok(removed)
    }

    pub(crate) fn cleanup_adopted_job_input_blob(
        &self,
        blob: &WorkerInputBlob,
        job_id: &str,
    ) -> Result<bool, PathError> {
        let expected = format!("runtime/jobs/{job_id}/inputs/{}/payload", blob.blob_id);
        if blob.relative_path != expected {
            return Err(PathError::BlobCleanupMismatch);
        }
        let path = self.resolve_data(&expected)?;
        let removed = self.remove_verified_blob_file(
            &path,
            Some(blob.size_bytes),
            Some(blob.sha256.as_str()),
            true,
        )?;
        let directory =
            self.resolve_data(&format!("runtime/jobs/{job_id}/inputs/{}", blob.blob_id))?;
        let _ = fs::remove_dir(directory.absolute());
        Ok(removed)
    }

    fn remove_verified_blob_file(
        &self,
        path: &ResolvedTrustedPath,
        maximum_size: Option<u64>,
        expected_sha256: Option<&str>,
        exact_size: bool,
    ) -> Result<bool, PathError> {
        validate_authority(&self.data_root, path)?;
        self.data_root.revalidate()?;
        let mut file = match open_staging_cleanup_candidate(path.absolute()) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(PathError::Io(error)),
        };
        // A never-started reservation has no upload directory at all; opening
        // first makes that exact absence idempotent. Once a candidate exists,
        // keep its handle pinned while validating every parent so a link swap
        // still fails closed before deletion.
        reject_parent_link_components(&self.data_root.canonical, path.absolute())?;
        let before = verify_regular_file(&self.data_root, path, &file, true)?;
        let size = file.metadata().map_err(PathError::Io)?.len();
        if maximum_size.is_some_and(|expected| {
            (exact_size && size != expected) || (!exact_size && size > expected)
        }) {
            return Err(PathError::BlobCleanupMismatch);
        }
        if let Some(expected_sha256) = expected_sha256 {
            let digest = hash_open_file(&mut file, size)?;
            if digest_hex(&digest) != expected_sha256 {
                return Err(PathError::BlobCleanupMismatch);
            }
        }
        let after = verify_regular_file(&self.data_root, path, &file, true)?;
        if before != after {
            return Err(PathError::FileChanged);
        }
        fs::remove_file(path.absolute()).map_err(PathError::Io)?;
        drop(file);
        sync_installed_parent(path.absolute())?;
        self.data_root.revalidate()?;
        Ok(true)
    }

    pub(crate) fn read_bounded_job_result(
        &self,
        job_id: &str,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, PathError> {
        validate_identifier("jobId", job_id)?;
        let path = self.resolve_data(&format!("runtime/jobs/{job_id}/result.json"))?;
        read_bounded(&self.data_root, &path, maximum_bytes)
    }

    pub(crate) fn read_bounded_job_checkpoint(
        &self,
        job_id: &str,
        maximum_bytes: usize,
    ) -> Result<Option<Vec<u8>>, PathError> {
        validate_identifier("jobId", job_id)?;
        let path = self.resolve_data(&format!("runtime/jobs/{job_id}/checkpoint.json"))?;
        match read_bounded(&self.data_root, &path, maximum_bytes) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn pin_worker_input_blob(
        &self,
        job_id: &str,
        blob: &WorkerInputBlob,
    ) -> Result<SealedJobInputBlob, PathError> {
        let expected = format!("runtime/jobs/{job_id}/inputs/{}/payload", blob.blob_id);
        if blob.relative_path != expected {
            return Err(PathError::InvalidRelative(
                ValidationError::InvalidRelativePath {
                    field: "input blob path",
                },
            ));
        }
        let directory =
            self.prepare_data_directory(&format!("runtime/jobs/{job_id}/inputs/{}", blob.blob_id))?;
        let path = self.resolve_data(&expected)?;
        self.pin_exact_sealed_blob(
            directory,
            path,
            blob.size_bytes,
            &blob.sha256,
            "worker input blob",
        )
    }

    fn pin_exact_sealed_blob(
        &self,
        blob_directory: TrustedDirectoryPin,
        path: ResolvedTrustedPath,
        size: u64,
        sha256: &str,
        kind: &'static str,
    ) -> Result<SealedJobInputBlob, PathError> {
        if size == 0 || size > MAX_JOB_INPUT_UPLOAD_BYTES {
            return Err(PathError::InvalidBlobSize {
                maximum_bytes: MAX_JOB_INPUT_UPLOAD_BYTES,
            });
        }
        parse_digest_hex(sha256)?;
        let file = match self.pin_existing_data_file(&path) {
            Ok(file) => file,
            Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                return Err(PathError::AlreadyStaged(kind));
            }
            Err(error) => return Err(error),
        };
        let sealed = SealedJobInputBlob {
            blob_directory,
            file,
            size,
            sha256: sha256.to_owned(),
        };
        sealed.revalidate()?;
        Ok(sealed)
    }

    /// Creates a fresh attempt root and private workspace, then atomically
    /// installs its closed start manifest. Both the root and the manifest are
    /// derived from the full worker fence; callers cannot choose a cwd or
    /// inject data paths. Reusing an attempt identity fails rather than
    /// truncating stale launch material.
    pub(crate) fn prepare_worker_start(
        &self,
        identity: &WorkerIdentity,
        execution_scope: &WorkerExecutionScope,
        input_blobs: &[WorkerInputBlob],
    ) -> Result<PreparedWorkerStart, PathError> {
        let manifest = WorkerStartManifest::for_identity_scope_and_inputs(
            identity.clone(),
            execution_scope.clone(),
            input_blobs.to_vec(),
        )?;
        let attempt = self.worker_attempt_paths(&manifest)?;
        validate_authority(&self.data_root, &attempt.checkpoint)?;
        validate_authority(&self.data_root, &attempt.result)?;
        let job_directory =
            self.prepare_data_directory(&path_text(attempt.job_directory.relative()))?;
        let input_manifest = self.pin_existing_data_file(&attempt.input_manifest)?;
        let input_blobs = manifest
            .input_blobs
            .iter()
            .map(|blob| self.pin_worker_input_blob(&identity.job_id, blob))
            .collect::<Result<Vec<_>, _>>()?;
        let launch_directory =
            self.prepare_launch_directory(&path_text(attempt.launch_directory.relative()))?;
        let workspace_directory =
            self.prepare_data_directory(&path_text(attempt.workspace.relative()))?;

        let encoded = serde_json::to_vec(&manifest)
            .map_err(|error| PathError::Io(io::Error::new(io::ErrorKind::InvalidData, error)))?;
        let start_manifest = self.atomic_write_new_data_file(
            &attempt.start_manifest,
            &encoded,
            MAX_WORKER_START_MANIFEST_BYTES,
            "worker start manifest",
            ExistingDestinationPolicy::Reject,
        )?;

        let prepared = PreparedWorkerStart {
            manifest,
            job_directory,
            input_manifest,
            input_blobs,
            launch_directory,
            workspace_directory,
            start_manifest,
        };
        prepared.revalidate()?;
        Ok(prepared)
    }

    fn worker_attempt_paths(
        &self,
        manifest: &WorkerStartManifest,
    ) -> Result<TrustedWorkerAttemptPaths, PathError> {
        manifest.validate()?;
        let identity = &manifest.identity;
        let job_directory = format!("runtime/jobs/{}", identity.job_id);
        let launch_directory = format!(
            "{job_directory}/attempts/{}/{}",
            identity.attempt, identity.worker_instance_id
        );
        let expected_workspace = format!("{launch_directory}/workspace");
        if manifest.workspace_path != expected_workspace {
            return Err(PathError::InvalidRelative(
                ValidationError::InvalidRelativePath {
                    field: "workspacePath",
                },
            ));
        }
        Ok(TrustedWorkerAttemptPaths {
            job_directory: self.resolve_data(&job_directory)?,
            input_manifest: self.resolve_data(&manifest.input_manifest_path)?,
            launch_directory: self.resolve_data(&launch_directory)?,
            workspace: self.resolve_data(&manifest.workspace_path)?,
            checkpoint: self.resolve_data(&manifest.checkpoint_path)?,
            result: self.resolve_data(&manifest.result_path)?,
            start_manifest: self
                .resolve_data(&format!("{launch_directory}/{WORKER_START_MANIFEST_FILE}"))?,
        })
    }

    fn pin_existing_data_file(
        &self,
        path: &ResolvedTrustedPath,
    ) -> Result<TrustedFilePin, PathError> {
        validate_authority(&self.data_root, path)?;
        self.data_root.revalidate()?;
        reject_link_components(&self.data_root.canonical, path.absolute())?;
        let file = open_read_pinned(path.absolute()).map_err(PathError::Io)?;
        verify_regular_file(&self.data_root, path, &file, true)?;
        self.data_root.revalidate()?;
        Ok(TrustedFilePin {
            root: self.data_root.clone(),
            path: path.clone(),
            _file: file,
        })
    }

    fn atomic_write_new_data_file(
        &self,
        destination: &ResolvedTrustedPath,
        bytes: &[u8],
        maximum_bytes: usize,
        kind: &'static str,
        existing_policy: ExistingDestinationPolicy,
    ) -> Result<TrustedFilePin, PathError> {
        if bytes.is_empty() || bytes.len() > maximum_bytes {
            return Err(PathError::OversizedFile { maximum_bytes });
        }
        validate_authority(&self.data_root, destination)?;
        self.data_root.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, destination.absolute())?;
        if let Some(existing) = self.resolve_existing_destination(
            destination,
            bytes,
            maximum_bytes,
            kind,
            existing_policy,
        )? {
            return Ok(existing);
        }

        let mut staging = self.create_temporary_staging_file(destination)?;
        staging.file.write_all(bytes).map_err(PathError::Io)?;
        staging.file.flush().map_err(PathError::Io)?;
        staging.file.sync_all().map_err(PathError::Io)?;
        verify_regular_file(&self.data_root, &staging.path, &staging.file, true)?;

        if let Err(publish_error) =
            install_file_no_replace(staging.path.absolute(), destination.absolute())
        {
            if publish_error.kind() == io::ErrorKind::AlreadyExists
                || fs::symlink_metadata(destination.absolute()).is_ok()
            {
                if let Some(existing) = self.resolve_existing_destination(
                    destination,
                    bytes,
                    maximum_bytes,
                    kind,
                    existing_policy,
                )? {
                    return Ok(existing);
                }
            }
            return Err(PathError::Io(publish_error));
        }
        staging.published = true;
        sync_installed_parent(destination.absolute())?;
        let installed_identity =
            verify_regular_file(&self.data_root, destination, &staging.file, true)?;
        drop(staging);
        let pinned = self.pin_existing_data_file(destination)?;
        let pinned_identity = file_identity(&pinned._file)?;
        if installed_identity.volume != pinned_identity.volume
            || installed_identity.file != pinned_identity.file
            || pinned_identity.links != 1
        {
            return Err(PathError::FileChanged);
        }
        self.data_root.revalidate()?;
        Ok(pinned)
    }

    fn resolve_existing_destination(
        &self,
        destination: &ResolvedTrustedPath,
        expected_bytes: &[u8],
        maximum_bytes: usize,
        kind: &'static str,
        policy: ExistingDestinationPolicy,
    ) -> Result<Option<TrustedFilePin>, PathError> {
        match policy {
            ExistingDestinationPolicy::Reject => {
                reject_existing_destination(destination.absolute(), kind)?;
                Ok(None)
            }
            ExistingDestinationPolicy::MatchExactBytes => self.pin_existing_data_file_if_exact(
                destination,
                expected_bytes,
                maximum_bytes,
                kind,
            ),
        }
    }

    fn pin_existing_data_file_if_exact(
        &self,
        path: &ResolvedTrustedPath,
        expected_bytes: &[u8],
        maximum_bytes: usize,
        kind: &'static str,
    ) -> Result<Option<TrustedFilePin>, PathError> {
        validate_authority(&self.data_root, path)?;
        self.data_root.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, path.absolute())?;
        match fs::symlink_metadata(path.absolute()) {
            Ok(metadata) if is_link_or_reparse(&metadata) => return Err(PathError::ReparsePoint),
            Ok(metadata) if !metadata.is_file() => return Err(PathError::NotRegularFile),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(PathError::Io(error)),
        }

        let mut file = match open_read_pinned(path.absolute()) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(PathError::Io(error)),
        };
        let before = verify_regular_file(&self.data_root, path, &file, true)?;
        let length = file.metadata().map_err(PathError::Io)?.len();
        if length != expected_bytes.len() as u64 || length > maximum_bytes as u64 {
            return Err(PathError::AlreadyStaged(kind));
        }
        let mut actual = Vec::with_capacity(length as usize);
        (&mut file)
            .take(maximum_bytes as u64 + 1)
            .read_to_end(&mut actual)
            .map_err(PathError::Io)?;
        let after = verify_regular_file(&self.data_root, path, &file, true)?;
        if before != after || actual.len() as u64 != file.metadata().map_err(PathError::Io)?.len() {
            return Err(PathError::FileChanged);
        }
        if actual.as_slice() != expected_bytes {
            return Err(PathError::AlreadyStaged(kind));
        }
        self.data_root.revalidate()?;
        Ok(Some(TrustedFilePin {
            root: self.data_root.clone(),
            path: path.clone(),
            _file: file,
        }))
    }

    fn create_temporary_staging_file(
        &self,
        destination: &ResolvedTrustedPath,
    ) -> Result<TemporaryStagingFile, PathError> {
        validate_authority(&self.data_root, destination)?;
        let parent = destination
            .relative()
            .parent()
            .ok_or(PathError::EscapedRoot("data"))?;
        let file_name = destination
            .relative()
            .file_name()
            .ok_or(PathError::EscapedRoot("data"))?;
        for _ in 0..MAX_STAGING_FILE_CREATE_ATTEMPTS {
            let nonce = NEXT_STAGING_FILE_NONCE.fetch_add(1, Ordering::Relaxed);
            let mut temporary_name = file_name.to_os_string();
            temporary_name.push(format!(".pending.{}.{nonce}", std::process::id()));
            let relative = parent.join(temporary_name);
            let path = self.resolve_data(&path_text(&relative))?;
            reject_parent_link_components(&self.data_root.canonical, path.absolute())?;
            match open_new_staging_file(path.absolute()) {
                Ok(file) => {
                    let identity = match file_identity(&file) {
                        Ok(identity) => identity,
                        Err(error) => {
                            drop(file);
                            let _ = fs::remove_file(path.absolute());
                            return Err(error);
                        }
                    };
                    let staging = TemporaryStagingFile {
                        path,
                        file,
                        identity,
                        published: false,
                    };
                    let verified_identity =
                        verify_regular_file(&self.data_root, &staging.path, &staging.file, true)?;
                    if verified_identity != staging.identity {
                        return Err(PathError::FileChanged);
                    }
                    self.data_root.revalidate()?;
                    return Ok(staging);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(PathError::Io(error)),
            }
        }
        Err(PathError::Io(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not create a unique bounded staging sibling",
        )))
    }

    fn create_exact_temporary_staging_file(
        &self,
        path: &ResolvedTrustedPath,
    ) -> Result<TemporaryStagingFile, PathError> {
        validate_authority(&self.data_root, path)?;
        self.data_root.revalidate()?;
        reject_parent_link_components(&self.data_root.canonical, path.absolute())?;
        reject_existing_destination(path.absolute(), "job input upload staging file")?;
        let file = open_new_staging_file(path.absolute()).map_err(PathError::Io)?;
        let identity = match file_identity(&file) {
            Ok(identity) => identity,
            Err(error) => {
                drop(file);
                let _ = fs::remove_file(path.absolute());
                return Err(error);
            }
        };
        let staging = TemporaryStagingFile {
            path: path.clone(),
            file,
            identity,
            published: false,
        };
        let verified = verify_regular_file(&self.data_root, &staging.path, &staging.file, true)?;
        if verified != staging.identity {
            return Err(PathError::FileChanged);
        }
        self.data_root.revalidate()?;
        Ok(staging)
    }

    pub(crate) fn job_paths(&self, job_id: &str) -> Result<TrustedJobPaths, PathError> {
        validate_identifier("jobId", job_id)?;
        let root = format!("runtime/jobs/{job_id}");
        Ok(TrustedJobPaths {
            input_manifest: self.resolve_data(&format!("{root}/input.json"))?,
            workspace: self.resolve_data(&format!("{root}/workspace"))?,
            checkpoint: self.resolve_data(&format!("{root}/checkpoint.json"))?,
            result: self.resolve_data(&format!("{root}/result.json"))?,
        })
    }
}

impl TrustedRoot {
    fn revalidate(&self) -> Result<(), PathError> {
        let current = open_directory(&self.canonical)
            .map_err(|error| PathError::RootUnavailable(self.kind, error))?;
        let current_identity = file_identity(&current)?;
        if current_identity.volume != self.identity.volume
            || current_identity.file != self.identity.file
        {
            return Err(PathError::RootChanged(self.kind));
        }
        Ok(())
    }
}

fn establish_root(kind: &'static str, value: PathBuf) -> Result<TrustedRoot, PathError> {
    if !value.is_absolute() {
        return Err(PathError::RelativeRoot(kind));
    }
    let canonical =
        fs::canonicalize(&value).map_err(|error| PathError::RootUnavailable(kind, error))?;
    let directory =
        open_directory(&canonical).map_err(|error| PathError::RootUnavailable(kind, error))?;
    let metadata = directory
        .metadata()
        .map_err(|error| PathError::RootUnavailable(kind, error))?;
    if !metadata.is_dir() {
        return Err(PathError::RootNotDirectory(kind));
    }
    let actual = opened_final_path(&directory, &canonical)?;
    if !paths_equal(&actual, &canonical) {
        return Err(PathError::RootChanged(kind));
    }
    let identity = file_identity(&directory)?;
    Ok(TrustedRoot {
        kind,
        canonical,
        identity,
        _directory: Arc::new(directory),
    })
}

fn resolve_inside(root: &TrustedRoot, relative: &str) -> Result<ResolvedTrustedPath, PathError> {
    validate_relative_path("path", relative)?;
    let relative = PathBuf::from(relative);
    let absolute = root.canonical.join(&relative);
    if !path_is_within(&absolute, &root.canonical) {
        return Err(PathError::EscapedRoot(root.kind));
    }
    Ok(ResolvedTrustedPath {
        root: root.canonical.clone(),
        relative,
        absolute,
    })
}

fn validate_authority(root: &TrustedRoot, path: &ResolvedTrustedPath) -> Result<(), PathError> {
    validate_relative_path("path", &path_text(path.relative()))?;
    let expected = root.canonical.join(path.relative());
    if !paths_equal(path.root(), &root.canonical) || !paths_equal(path.absolute(), &expected) {
        return Err(PathError::WrongAuthority(root.kind));
    }
    Ok(())
}

fn pin_existing_directory_inside(
    root: &TrustedRoot,
    path: &ResolvedTrustedPath,
    kind: &'static str,
) -> Result<TrustedDirectoryPin, PathError> {
    validate_authority(root, path)?;
    root.revalidate()?;
    reject_link_components(&root.canonical, path.absolute())?;
    let directory = open_directory(path.absolute()).map_err(PathError::Io)?;
    let metadata = directory.metadata().map_err(PathError::Io)?;
    if !metadata.is_dir() {
        return Err(PathError::RootNotDirectory(kind));
    }
    let actual = opened_final_path(&directory, path.absolute())?;
    if !path_is_within(&actual, &root.canonical) || !paths_equal(&actual, path.absolute()) {
        return Err(PathError::EscapedRoot(root.kind));
    }
    reject_link_components(&root.canonical, path.absolute())?;
    root.revalidate()?;
    let identity = file_identity(&directory)?;
    Ok(TrustedDirectoryPin {
        root: TrustedRoot {
            kind,
            canonical: path.absolute.clone(),
            identity,
            _directory: Arc::new(directory),
        },
    })
}

fn create_directory_chain(
    root: &TrustedRoot,
    path: &ResolvedTrustedPath,
) -> Result<File, PathError> {
    validate_authority(root, path)?;
    root.revalidate()?;
    let mut current = root.canonical.clone();
    // Retain every opened directory until the final handle is returned. On
    // Windows these handles deny share-delete, preventing an already-checked
    // parent from being replaced while a deeper component is created.
    let mut directories = Vec::new();
    for component in path.relative().components() {
        let Component::Normal(component) = component else {
            return Err(PathError::EscapedRoot(root.kind));
        };
        current.push(component);
        match fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(PathError::Io(error)),
        }
        let metadata = fs::symlink_metadata(&current).map_err(PathError::Io)?;
        if is_link_or_reparse(&metadata) {
            return Err(PathError::ReparsePoint);
        }
        if !metadata.is_dir() {
            return Err(PathError::RootNotDirectory("prepared data"));
        }
        let directory = open_directory(&current).map_err(PathError::Io)?;
        let actual = opened_final_path(&directory, &current)?;
        if !path_is_within(&actual, &root.canonical) {
            return Err(PathError::EscapedRoot(root.kind));
        }
        directories.push(directory);
    }
    reject_link_components(&root.canonical, path.absolute())?;
    root.revalidate()?;
    directories
        .pop()
        .ok_or(PathError::RootNotDirectory("prepared data"))
}

fn validate_canonical_job_input(bytes: &[u8]) -> Result<(), PathError> {
    if bytes.is_empty() || bytes.len() > MAX_REQUEST_BODY_BYTES {
        return Err(PathError::InvalidJobInput);
    }
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| PathError::InvalidJobInput)?;
    let canonical = canonical_json(&value);
    let encoded = serde_json::to_vec(&canonical).map_err(|_| PathError::InvalidJobInput)?;
    if encoded.as_slice() != bytes {
        return Err(PathError::InvalidJobInput);
    }
    Ok(())
}

fn canonical_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(canonical_json).collect())
        }
        serde_json::Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                let item = values
                    .get(key)
                    .expect("canonical JSON key came from this object");
                canonical.insert(key.clone(), canonical_json(item));
            }
            serde_json::Value::Object(canonical)
        }
        scalar => scalar.clone(),
    }
}

fn reject_existing_destination(path: &Path, kind: &'static str) -> Result<(), PathError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(PathError::AlreadyStaged(kind)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PathError::Io(error)),
    }
}

fn reject_blob_destination(path: &Path) -> Result<(), PathError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_link_or_reparse(&metadata) => Err(PathError::ReparsePoint),
        Ok(_) => Err(PathError::AlreadyStaged("job input blob")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PathError::Io(error)),
    }
}

fn parse_digest_hex(value: &str) -> Result<[u8; 32], PathError> {
    let encoded = value.as_bytes();
    if encoded.len() != 64
        || encoded
            .iter()
            .any(|byte| !byte.is_ascii_digit() && !(b'a'..=b'f').contains(byte))
    {
        return Err(PathError::InvalidBlobDigest);
    }
    let mut digest = [0_u8; 32];
    for (index, output) in digest.iter_mut().enumerate() {
        let high = digest_nibble(encoded[index * 2])?;
        let low = digest_nibble(encoded[index * 2 + 1])?;
        *output = (high << 4) | low;
    }
    Ok(digest)
}

fn digest_nibble(value: u8) -> Result<u8, PathError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(PathError::InvalidBlobDigest),
    }
}

fn digest_hex(digest: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn hash_open_file(file: &mut File, expected_size: u64) -> Result<[u8; 32], PathError> {
    file.seek(SeekFrom::Start(0)).map_err(PathError::Io)?;
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let remaining_with_sentinel = expected_size.saturating_sub(total).saturating_add(1);
        let capacity = usize::try_from(remaining_with_sentinel.min(buffer.len() as u64))
            .map_err(|_| PathError::FileChanged)?;
        let read = file.read(&mut buffer[..capacity]).map_err(PathError::Io)?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or(PathError::FileChanged)?;
        if total > expected_size {
            return Err(PathError::BlobSizeMismatch {
                declared_bytes: expected_size,
                actual_bytes: total,
            });
        }
        digest.update(&buffer[..read]);
    }
    if total != expected_size {
        return Err(PathError::BlobSizeMismatch {
            declared_bytes: expected_size,
            actual_bytes: total,
        });
    }
    Ok(digest.finalize().into())
}

fn read_bounded(
    root: &TrustedRoot,
    path: &ResolvedTrustedPath,
    maximum_bytes: usize,
) -> Result<Vec<u8>, PathError> {
    validate_authority(root, path)?;
    root.revalidate()?;
    reject_link_components(&root.canonical, path.absolute())?;
    let mut file = open_read_pinned(path.absolute()).map_err(PathError::Io)?;
    read_bounded_open_file(root, path, &mut file, maximum_bytes)
}

fn read_bounded_open_file(
    root: &TrustedRoot,
    path: &ResolvedTrustedPath,
    file: &mut File,
    maximum_bytes: usize,
) -> Result<Vec<u8>, PathError> {
    if maximum_bytes == 0 {
        return Err(PathError::OversizedFile { maximum_bytes });
    }
    validate_authority(root, path)?;
    root.revalidate()?;
    reject_link_components(&root.canonical, path.absolute())?;
    file.seek(SeekFrom::Start(0)).map_err(PathError::Io)?;
    let before = verify_regular_file(root, path, file, true)?;
    let length = file.metadata().map_err(PathError::Io)?.len();
    if length > maximum_bytes as u64 {
        return Err(PathError::OversizedFile { maximum_bytes });
    }
    let mut bytes = Vec::with_capacity(length as usize);
    (&mut *file)
        .take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(PathError::Io)?;
    if bytes.len() > maximum_bytes {
        return Err(PathError::OversizedFile { maximum_bytes });
    }
    let after = verify_regular_file(root, path, file, true)?;
    if before.volume != after.volume
        || before.file != after.file
        || before.links != after.links
        || bytes.len() as u64 != file.metadata().map_err(PathError::Io)?.len()
    {
        return Err(PathError::FileChanged);
    }
    root.revalidate()?;
    Ok(bytes)
}

fn verify_regular_file(
    root: &TrustedRoot,
    path: &ResolvedTrustedPath,
    file: &File,
    require_single_link: bool,
) -> Result<FileIdentity, PathError> {
    validate_authority(root, path)?;
    let metadata = file.metadata().map_err(PathError::Io)?;
    if !metadata.is_file() {
        return Err(PathError::NotRegularFile);
    }
    let identity = file_identity(file)?;
    if require_single_link && identity.links != 1 {
        return Err(PathError::MultipleHardLinks);
    }
    let actual = opened_final_path(file, path.absolute())?;
    if !path_is_within(&actual, &root.canonical) {
        return Err(PathError::EscapedRoot(root.kind));
    }
    reject_link_components(&root.canonical, path.absolute())?;
    Ok(identity)
}

fn reject_link_components(root: &Path, candidate: &Path) -> Result<(), PathError> {
    let relative = candidate
        .strip_prefix(root)
        .map_err(|_| PathError::EscapedRoot("trusted"))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::Normal(value) => current.push(value),
            _ => return Err(PathError::EscapedRoot("trusted")),
        }
        let metadata = fs::symlink_metadata(&current).map_err(PathError::Io)?;
        if is_link_or_reparse(&metadata) {
            return Err(PathError::ReparsePoint);
        }
    }
    Ok(())
}

fn reject_parent_link_components(root: &Path, candidate: &Path) -> Result<(), PathError> {
    let parent = candidate
        .parent()
        .ok_or(PathError::EscapedRoot("trusted"))?;
    reject_link_components(root, parent)
}

#[cfg(windows)]
fn is_link_or_reparse(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(unix)]
fn is_link_or_reparse(metadata: &Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(not(any(windows, unix)))]
fn is_link_or_reparse(_metadata: &Metadata) -> bool {
    true
}

#[cfg(windows)]
fn open_directory(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
}

#[cfg(not(windows))]
fn open_directory(path: &Path) -> io::Result<File> {
    File::open(path)
}

#[cfg(windows)]
fn open_read_pinned(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
}

#[cfg(not(windows))]
fn open_read_pinned(path: &Path) -> io::Result<File> {
    OpenOptions::new().read(true).open(path)
}

#[cfg(windows)]
fn open_staging_cleanup_candidate(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    // The original staging handle is still open for read/write and explicitly
    // shares deletion. This identity-only reopen must reciprocally share all
    // three access classes or Windows rejects it with a sharing violation.
    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(path)
}

#[cfg(not(windows))]
fn open_staging_cleanup_candidate(path: &Path) -> io::Result<File> {
    open_read_pinned(path)
}

#[cfg(windows)]
fn open_or_create_pinned_file(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

    let open = |create_new| {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .create_new(create_new);
        options.open(path)
    };
    match open(true) {
        Ok(file) => Ok(file),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => open(false),
        Err(error) => Err(error),
    }
}

#[cfg(not(windows))]
fn open_or_create_pinned_file(path: &Path) -> io::Result<File> {
    let open = |create_new| {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(create_new)
            .open(path)
    };
    match open(true) {
        Ok(file) => Ok(file),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => open(false),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn open_new_staging_file(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};

    OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
}

#[cfg(not(windows))]
fn open_new_staging_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)
}

#[cfg(windows)]
fn install_file_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let success = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if success == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn install_file_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    // Creating the destination link is one atomic no-replace operation on the
    // same directory/filesystem. Removing the private pending name publishes
    // a final path with one link while the completed inode remains open.
    fs::hard_link(source, destination)?;
    fs::remove_file(source)
}

#[cfg(not(any(windows, unix)))]
fn install_file_no_replace(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic no-replace installation is unsupported",
    ))
}

#[cfg(windows)]
fn install_file_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let success = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if success == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn install_file_replace(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(not(any(windows, unix)))]
fn install_file_replace(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic replacement is unsupported",
    ))
}

#[cfg(windows)]
fn sync_installed_parent(_destination: &Path) -> Result<(), PathError> {
    // MOVEFILE_WRITE_THROUGH provides the platform's durable move boundary.
    Ok(())
}

#[cfg(unix)]
fn sync_installed_parent(destination: &Path) -> Result<(), PathError> {
    let parent = destination.parent().ok_or(PathError::EscapedRoot("data"))?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(PathError::Io)
}

#[cfg(not(any(windows, unix)))]
fn sync_installed_parent(_destination: &Path) -> Result<(), PathError> {
    Err(PathError::UnsupportedPlatform)
}

#[cfg(windows)]
fn file_identity(file: &File) -> Result<FileIdentity, PathError> {
    use std::mem::zeroed;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
    let success =
        unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut information) };
    if success == 0 {
        return Err(PathError::Io(io::Error::last_os_error()));
    }
    Ok(FileIdentity {
        volume: u64::from(information.dwVolumeSerialNumber),
        file: (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
        links: u64::from(information.nNumberOfLinks),
    })
}

#[cfg(unix)]
fn file_identity(file: &File) -> Result<FileIdentity, PathError> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata().map_err(PathError::Io)?;
    Ok(FileIdentity {
        volume: metadata.dev(),
        file: metadata.ino(),
        links: metadata.nlink(),
    })
}

#[cfg(not(any(windows, unix)))]
fn file_identity(_file: &File) -> Result<FileIdentity, PathError> {
    Err(PathError::UnsupportedPlatform)
}

#[cfg(windows)]
fn opened_final_path(file: &File, _candidate: &Path) -> Result<PathBuf, PathError> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS,
    };

    // Windows extended-length paths cannot exceed 32,767 UTF-16 code units.
    let mut buffer = vec![0_u16; 32_768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle() as _,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if length == 0 {
        return Err(PathError::Io(io::Error::last_os_error()));
    }
    if length as usize >= buffer.len() {
        return Err(PathError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            "final path exceeded the platform path limit",
        )));
    }
    buffer.truncate(length as usize);
    Ok(PathBuf::from(OsString::from_wide(&buffer)))
}

#[cfg(unix)]
fn opened_final_path(file: &File, candidate: &Path) -> Result<PathBuf, PathError> {
    let canonical = fs::canonicalize(candidate).map_err(PathError::Io)?;
    let canonical_file = File::open(&canonical).map_err(PathError::Io)?;
    let opened = file_identity(file)?;
    let current = file_identity(&canonical_file)?;
    if opened.volume != current.volume || opened.file != current.file {
        return Err(PathError::FileChanged);
    }
    Ok(canonical)
}

#[cfg(not(any(windows, unix)))]
fn opened_final_path(_file: &File, _candidate: &Path) -> Result<PathBuf, PathError> {
    Err(PathError::UnsupportedPlatform)
}

#[cfg(windows)]
fn paths_equal(left: &Path, right: &Path) -> bool {
    path_components(left) == path_components(right)
}

#[cfg(not(windows))]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left == right
}

#[cfg(windows)]
fn path_is_within(candidate: &Path, root: &Path) -> bool {
    let candidate = path_components(candidate);
    let root = path_components(root);
    candidate.len() >= root.len() && candidate[..root.len()] == root
}

#[cfg(not(windows))]
fn path_is_within(candidate: &Path, root: &Path) -> bool {
    candidate.starts_with(root)
}

#[cfg(windows)]
fn normal_windows_component_is_unambiguous(value: &std::ffi::OsStr) -> bool {
    use std::os::windows::ffi::OsStrExt;

    let units = value.encode_wide().collect::<Vec<_>>();
    if units.is_empty()
        || matches!(units.last(), Some(unit) if *unit == u16::from(b'.') || *unit == u16::from(b' '))
        || units.iter().any(|unit| {
            *unit == 0
                || *unit < 32
                || matches!(
                    *unit,
                    value if value == u16::from(b'<')
                        || value == u16::from(b'>')
                        || value == u16::from(b':')
                        || value == u16::from(b'"')
                        || value == u16::from(b'/')
                        || value == u16::from(b'\\')
                        || value == u16::from(b'|')
                        || value == u16::from(b'?')
                        || value == u16::from(b'*')
                )
        })
    {
        return false;
    }

    let stem = units
        .split(|unit| *unit == u16::from(b'.'))
        .next()
        .unwrap_or_default();
    let ascii_stem = stem
        .iter()
        .map(|unit| {
            u8::try_from(*unit)
                .ok()
                .map(|byte| byte.to_ascii_uppercase())
        })
        .collect::<Option<Vec<_>>>();
    if let Some(stem) = ascii_stem.as_deref() {
        if matches!(
            stem,
            b"CON" | b"PRN" | b"AUX" | b"NUL" | b"CONIN$" | b"CONOUT$" | b"CLOCK$"
        ) {
            return false;
        }
        if stem.len() == 4
            && matches!(&stem[..3], b"COM" | b"LPT")
            && matches!(stem[3], b'1'..=b'9')
        {
            return false;
        }
    }
    if stem.len() == 4 && matches!(stem[3], 0x00b9 | 0x00b2 | 0x00b3) {
        let prefix_matches = |expected: &[u8; 3]| {
            stem[..3].iter().zip(expected).all(|(unit, byte)| {
                *unit == u16::from(byte.to_ascii_uppercase())
                    || *unit == u16::from(byte.to_ascii_lowercase())
            })
        };
        if prefix_matches(b"COM") || prefix_matches(b"LPT") {
            return false;
        }
    }
    true
}

#[cfg(windows)]
pub(crate) fn child_argv_path_presentation(path: &Path) -> Result<PathBuf, PathError> {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Prefix;

    if path.as_os_str().encode_wide().any(|unit| unit == 0) {
        return Err(PathError::InvalidChildArgvPath);
    }

    let mut components = path.components();
    let prefix = match components.next() {
        Some(Component::Prefix(prefix)) => prefix.kind(),
        _ => return Err(PathError::InvalidChildArgvPath),
    };
    let (mut presented, rebuild) = match prefix {
        Prefix::Disk(drive) if drive.is_ascii_alphabetic() => (path.to_path_buf(), false),
        Prefix::UNC(server, share)
            if normal_windows_component_is_unambiguous(server)
                && normal_windows_component_is_unambiguous(share) =>
        {
            (path.to_path_buf(), false)
        }
        Prefix::VerbatimDisk(drive) if drive.is_ascii_alphabetic() => {
            (PathBuf::from(format!("{}:\\", char::from(drive))), true)
        }
        Prefix::VerbatimUNC(server, share)
            if normal_windows_component_is_unambiguous(server)
                && normal_windows_component_is_unambiguous(share) =>
        {
            let mut value = PathBuf::from(r"\\");
            value.push(server);
            value.push(share);
            (value, true)
        }
        // Generic verbatim and device namespaces do not have a safe normal
        // absolute spelling. Trusted roots established with VOLUME_NAME_DOS
        // should never produce either form, so fail closed if one appears.
        Prefix::Verbatim(_)
        | Prefix::DeviceNS(_)
        | Prefix::Disk(_)
        | Prefix::UNC(_, _)
        | Prefix::VerbatimDisk(_) => return Err(PathError::InvalidChildArgvPath),
        Prefix::VerbatimUNC(_, _) => return Err(PathError::InvalidChildArgvPath),
    };

    let mut rooted = false;
    for component in components {
        match component {
            Component::RootDir if !rooted => rooted = true,
            Component::Normal(value)
                if rooted && normal_windows_component_is_unambiguous(value) =>
            {
                if rebuild {
                    presented.push(value);
                }
            }
            Component::Prefix(_) | Component::CurDir | Component::ParentDir => {
                return Err(PathError::InvalidChildArgvPath)
            }
            Component::RootDir | Component::Normal(_) => {
                return Err(PathError::InvalidChildArgvPath)
            }
        }
    }
    if !rooted || !presented.is_absolute() {
        return Err(PathError::InvalidChildArgvPath);
    }
    Ok(presented)
}

#[cfg(not(windows))]
pub(crate) fn child_argv_path_presentation(path: &Path) -> Result<PathBuf, PathError> {
    if !path.is_absolute() {
        return Err(PathError::InvalidChildArgvPath);
    }
    Ok(path.to_path_buf())
}

#[cfg(windows)]
fn path_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use breadboard_runtime_protocol::parse_worker_start_manifest;
    use std::io::Write;

    fn roots(name: &str) -> (tempfile::TempDir, RuntimePaths) {
        let directory = tempfile::Builder::new().prefix(name).tempdir().unwrap();
        let data = directory.path().join("data");
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime-root");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&app).unwrap();
        fs::create_dir_all(&runtime).unwrap();
        let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
        (directory, paths)
    }

    fn blob_digest(bytes: &[u8]) -> String {
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        digest_hex(&digest)
    }

    fn unscoped_worker() -> WorkerExecutionScope {
        WorkerExecutionScope::unscoped()
    }

    #[test]
    fn runtime_paths_reject_traversal_and_absolute_paths() {
        let (_directory, paths) = roots("breadboard-runtime-path-test");
        let resolved = paths.resolve_data("runtime/jobs/job_1").unwrap();
        assert_eq!(resolved.relative(), Path::new("runtime/jobs/job_1"));
        assert!(resolved.absolute().starts_with(resolved.root()));
        assert!(paths.resolve_data("../../Windows").is_err());
        assert!(paths.resolve_app("C:/Windows/System32/cmd.exe").is_err());
        assert!(paths.resolve_runtime("../app/worker.mjs").is_err());
    }

    #[test]
    fn child_argv_presentation_preserves_canonical_pin_authority() {
        let (_directory, paths) = roots("breadboard-runtime-child-argv-authority");
        let entrypoint = paths
            .app_root()
            .join("dashboard/scripts/runtime-v2-dashboard.mjs");
        fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
        fs::write(&entrypoint, b"trusted entrypoint").unwrap();

        let resolved = paths
            .resolve_app("dashboard/scripts/runtime-v2-dashboard.mjs")
            .unwrap();
        let canonical = resolved.absolute().to_path_buf();
        let resolved_argument = resolved.child_argv_path().unwrap();
        assert_eq!(resolved.absolute(), canonical);
        assert_eq!(fs::canonicalize(&resolved_argument).unwrap(), canonical);

        let pin = paths.pin_app_file_for_launch(&resolved).unwrap();
        let pinned_canonical = pin.absolute().to_path_buf();
        let pinned_argument = pin.child_argv_path().unwrap();
        pin.revalidate().unwrap();
        assert_eq!(pin.absolute(), pinned_canonical);
        assert_eq!(
            fs::canonicalize(&pinned_argument).unwrap(),
            pinned_canonical
        );

        #[cfg(windows)]
        {
            assert_ne!(resolved_argument, canonical);
            assert_ne!(pinned_argument, pinned_canonical);
        }
        #[cfg(not(windows))]
        {
            assert_eq!(resolved_argument, canonical);
            assert_eq!(pinned_argument, pinned_canonical);
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_launch_directory_presents_a_normal_child_path_without_replacing_its_pin() {
        let (_directory, paths) = roots("breadboard-runtime-launch-directory-presentation");
        let dashboard = paths.app_root().join("dashboard");
        fs::create_dir_all(&dashboard).unwrap();
        let directory = paths.pin_app_launch_directory("dashboard").unwrap();
        let canonical = directory.absolute().to_path_buf();

        let presented = directory.child_process_path().unwrap();
        assert!(!presented.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(fs::canonicalize(&presented).unwrap(), canonical);
        directory.revalidate().unwrap();
        assert_eq!(directory.absolute(), canonical);
    }

    #[cfg(windows)]
    #[test]
    fn windows_child_argv_presentation_is_non_lossy_and_fail_closed() {
        let verbatim_drive = Path::new(r"\\?\C:\Program Files\Breadboard\日本語\entry.mjs");
        assert_eq!(
            child_argv_path_presentation(verbatim_drive).unwrap(),
            PathBuf::from(r"C:\Program Files\Breadboard\日本語\entry.mjs")
        );
        let verbatim_unc = Path::new(r"\\?\UNC\server\share\Breadboard files\entry.mjs");
        assert_eq!(
            child_argv_path_presentation(verbatim_unc).unwrap(),
            PathBuf::from(r"\\server\share\Breadboard files\entry.mjs")
        );

        for unchanged in [
            Path::new(r"C:\Breadboard\entry.mjs"),
            Path::new(r"\\server\share\Breadboard\entry.mjs"),
        ] {
            assert_eq!(child_argv_path_presentation(unchanged).unwrap(), unchanged);
        }
        let rejected = [
            PathBuf::from(r"relative\entry.mjs"),
            PathBuf::from(r"\rooted-without-drive\entry.mjs"),
            PathBuf::from(r"\\?\GLOBALROOT\Device\HarddiskVolume1\entry.mjs"),
            PathBuf::from(r"\\.\C:\Breadboard\entry.mjs"),
            PathBuf::from(r"\\?\1:\Breadboard\entry.mjs"),
            PathBuf::from(r"\\?\C:relative\entry.mjs"),
            PathBuf::from(r"\\?\UNC\server"),
            PathBuf::from(r"\\?\UNC\server.\share\entry.mjs"),
            PathBuf::from(r"\\?\UNC\server\share.\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\one\..\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\trailing.\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\trailing \entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\CON\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\aux.txt\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\COM1\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\LPT9.log\entry.mjs"),
            PathBuf::from(r"\\?\C:\Breadboard\name:stream\entry.mjs"),
            PathBuf::from("\\\\?\\C:\\Breadboard\\control\u{1}name\\entry.mjs"),
        ];
        for rejected in &rejected {
            assert!(matches!(
                child_argv_path_presentation(rejected),
                Err(PathError::InvalidChildArgvPath)
            ));
        }
    }

    #[test]
    fn data_root_launch_file_is_exactly_pinned_and_rejects_hard_link_aliases() {
        let (_directory, paths) = roots("breadboard-runtime-data-launch-file");
        let executable = paths.data_root().join("runtime/comfyui/python.exe");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, b"test interpreter").unwrap();
        let resolved = paths.resolve_data("runtime/comfyui/python.exe").unwrap();
        let pin = paths.pin_data_file_for_launch(&resolved).unwrap();
        pin.revalidate().unwrap();
        drop(pin);

        fs::hard_link(
            &executable,
            paths.data_root().join("runtime/comfyui/alias.exe"),
        )
        .unwrap();
        assert!(matches!(
            paths.pin_data_file_for_launch(&resolved),
            Err(PathError::MultipleHardLinks)
        ));
        assert!(paths.resolve_data("../runtime/comfyui/python.exe").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn data_root_launch_file_rejects_windows_reparse_aliases() {
        use std::os::windows::fs::symlink_file;

        let (_directory, paths) = roots("breadboard-runtime-data-launch-reparse");
        let target = paths.data_root().join("target.exe");
        let alias = paths.data_root().join("runtime/comfyui/python.exe");
        fs::create_dir_all(alias.parent().unwrap()).unwrap();
        fs::write(&target, b"test interpreter").unwrap();
        if let Err(error) = symlink_file(&target, &alias) {
            if error.kind() == io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(1314)
            {
                return;
            }
            panic!("could not create Windows reparse test fixture: {error}");
        }
        let resolved = paths.resolve_data("runtime/comfyui/python.exe").unwrap();
        assert!(matches!(
            paths.pin_data_file_for_launch(&resolved),
            Err(PathError::ReparsePoint)
        ));
    }

    #[test]
    fn generation_scope_is_minted_only_from_the_pinned_data_root_identity() {
        let directory = tempfile::Builder::new()
            .prefix("breadboard-runtime-generation-scope")
            .tempdir()
            .unwrap();
        let data = directory.path().join("data");
        let other_data = directory.path().join("other-data");
        let app = directory.path().join("app");
        let other_app = directory.path().join("other-app");
        let runtime = directory.path().join("runtime");
        let other_runtime = directory.path().join("other-runtime");
        for root in [
            &data,
            &other_data,
            &app,
            &other_app,
            &runtime,
            &other_runtime,
        ] {
            fs::create_dir_all(root).unwrap();
        }

        let original = RuntimePaths::new(&data, &app, &runtime).unwrap();
        let same_data_different_other_roots =
            RuntimePaths::new(&data, &other_app, &other_runtime).unwrap();
        let different_data = RuntimePaths::new(&other_data, &app, &runtime).unwrap();

        assert_eq!(
            original.runtime_generation_scope(),
            same_data_different_other_roots.runtime_generation_scope()
        );
        assert_ne!(
            original.runtime_generation_scope(),
            different_data.runtime_generation_scope()
        );
    }

    #[test]
    fn job_layout_is_derived_inside_the_data_root() {
        let (_directory, paths) = roots("breadboard-runtime-layout-test");
        let layout = paths.job_paths("job_1").unwrap();
        assert_eq!(
            layout.input_manifest_relative(),
            "runtime/jobs/job_1/input.json"
        );
        assert_eq!(layout.workspace_relative(), "runtime/jobs/job_1/workspace");
        assert!(paths.job_paths("../other-job").is_err());
    }

    #[test]
    fn canonical_job_input_is_idempotent_only_for_exact_existing_bytes() {
        let (_directory, paths) = roots("breadboard-runtime-stage-input");
        let canonical = br#"{"a":{"x":1},"z":[2,3]}"#;
        let job_directory = paths.data_root().join("runtime/jobs/job_1");
        fs::create_dir_all(&job_directory).unwrap();
        let stale_fixed_pending = job_directory.join("input.json.pending");
        File::create(&stale_fixed_pending)
            .unwrap()
            .write_all(b"orphan from a crashed older runtime")
            .unwrap();

        let pin = paths.stage_job_input("job_1", canonical).unwrap();
        assert_eq!(pin.relative(), Path::new("runtime/jobs/job_1/input.json"));
        pin.revalidate().unwrap();
        assert_eq!(fs::read(pin.absolute()).unwrap(), canonical);
        assert!(stale_fixed_pending.exists());
        drop(pin);

        let replay = paths.stage_job_input("job_1", canonical).unwrap();
        replay.revalidate().unwrap();
        assert_eq!(fs::read(replay.absolute()).unwrap(), canonical);
        drop(replay);

        assert!(matches!(
            paths.stage_job_input("job_1", br#"{"a":{"x":2},"z":[2,3]}"#),
            Err(PathError::AlreadyStaged("job input"))
        ));
        assert_eq!(
            fs::read(paths.data_root().join("runtime/jobs/job_1/input.json")).unwrap(),
            canonical
        );
        assert!(fs::read_dir(job_directory)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with("input.json.pending.")));
    }

    #[test]
    fn temporary_staging_siblings_are_unique_and_raii_cleaned() {
        let (_directory, paths) = roots("breadboard-runtime-staging-sibling");
        paths.prepare_data_directory("runtime/jobs/job_1").unwrap();
        let destination = paths.resolve_data("runtime/jobs/job_1/input.json").unwrap();

        let first = paths.create_temporary_staging_file(&destination).unwrap();
        let second = paths.create_temporary_staging_file(&destination).unwrap();
        let first_path = first.path.absolute().to_path_buf();
        let second_path = second.path.absolute().to_path_buf();
        assert_ne!(first_path, second_path);
        assert_eq!(first_path.parent(), destination.absolute().parent());
        assert_eq!(second_path.parent(), destination.absolute().parent());
        assert!(first_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("input.json.pending."));
        assert!(first_path.exists());
        assert!(second_path.exists());

        drop(first);
        drop(second);
        assert!(!first_path.exists());
        assert!(!second_path.exists());
    }

    #[test]
    fn job_input_blob_streams_and_seals_exact_bytes_under_minted_path() {
        let (_directory, paths) = roots("breadboard-runtime-blob-seal");
        let bytes = b"one bounded blob payload";
        let digest = blob_digest(bytes);
        let mut staging = paths
            .begin_job_input_blob_staging("job_1", "blob_1", bytes.len() as u64, 1024, &digest)
            .unwrap();
        let temporary = staging.staging.path.absolute().to_path_buf();
        assert_eq!(
            temporary.parent().unwrap(),
            paths.data_root().join("runtime/jobs/job_1/inputs/blob_1")
        );
        assert!(temporary
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("payload.pending."));

        staging.write_all(&bytes[..7]).unwrap();
        staging.write_all(&bytes[7..]).unwrap();
        let sealed = staging.seal().unwrap();
        assert_eq!(sealed.size(), bytes.len() as u64);
        assert_eq!(sealed.sha256(), digest);
        assert_eq!(
            sealed.file.path.relative(),
            Path::new("runtime/jobs/job_1/inputs/blob_1/payload")
        );
        assert_eq!(fs::read(sealed.file.path.absolute()).unwrap(), bytes);
        assert!(!temporary.exists());
        sealed.revalidate().unwrap();
        assert!(!format!("{sealed:?}").contains(paths.data_root().to_string_lossy().as_ref()));
    }

    #[test]
    fn job_input_blob_overflow_poisoning_removes_only_its_unsealed_temp() {
        let (_directory, paths) = roots("breadboard-runtime-blob-overflow");
        let expected = blob_digest(b"four");
        let mut staging = paths
            .begin_job_input_blob_staging("job_1", "blob_1", 4, 8, &expected)
            .unwrap();
        let temporary = staging.staging.path.absolute().to_path_buf();
        assert!(staging.write_all(b"five!").is_err());
        assert!(matches!(staging.seal(), Err(PathError::BlobWriterPoisoned)));
        assert!(!temporary.exists());
        assert!(!paths
            .data_root()
            .join("runtime/jobs/job_1/inputs/blob_1/payload")
            .exists());
    }

    #[test]
    fn job_input_blob_size_and_digest_mismatches_clean_up_without_publication() {
        let (_directory, paths) = roots("breadboard-runtime-blob-mismatch");
        let expected = blob_digest(b"1234");
        let mut short = paths
            .begin_job_input_blob_staging("job_1", "short", 4, 8, &expected)
            .unwrap();
        let short_temporary = short.staging.path.absolute().to_path_buf();
        short.write_all(b"123").unwrap();
        assert!(matches!(
            short.seal(),
            Err(PathError::BlobSizeMismatch {
                declared_bytes: 4,
                actual_bytes: 3
            })
        ));
        assert!(!short_temporary.exists());

        let mut wrong_digest = paths
            .begin_job_input_blob_staging("job_1", "wrong_digest", 4, 8, &expected)
            .unwrap();
        let digest_temporary = wrong_digest.staging.path.absolute().to_path_buf();
        wrong_digest.write_all(b"5678").unwrap();
        assert!(matches!(
            wrong_digest.seal(),
            Err(PathError::BlobDigestMismatch)
        ));
        assert!(!digest_temporary.exists());
        assert!(!paths
            .data_root()
            .join("runtime/jobs/job_1/inputs/short/payload")
            .exists());
        assert!(!paths
            .data_root()
            .join("runtime/jobs/job_1/inputs/wrong_digest/payload")
            .exists());
    }

    #[test]
    fn dropping_disconnected_job_input_blob_removes_its_unique_temp() {
        let (_directory, paths) = roots("breadboard-runtime-blob-disconnect");
        let expected = blob_digest(b"stream interrupted");
        let mut staging = paths
            .begin_job_input_blob_staging("job_1", "blob_1", 18, 64, &expected)
            .unwrap();
        staging.write_all(b"stream").unwrap();
        let temporary = staging.staging.path.absolute().to_path_buf();
        assert!(temporary.exists());
        drop(staging);
        assert!(!temporary.exists());
        assert!(!paths
            .data_root()
            .join("runtime/jobs/job_1/inputs/blob_1/payload")
            .exists());
    }

    #[test]
    fn dropping_job_input_blob_never_deletes_a_replaced_temp_path() {
        let (_directory, paths) = roots("breadboard-runtime-blob-drop-replacement");
        let expected = blob_digest(b"unsealed");
        let staging = paths
            .begin_job_input_blob_staging("job_1", "blob_1", 8, 64, &expected)
            .unwrap();
        let temporary = staging.staging.path.absolute().to_path_buf();
        let displaced = temporary.with_extension("displaced");
        fs::rename(&temporary, &displaced).unwrap();
        File::create(&temporary)
            .unwrap()
            .write_all(b"replacement")
            .unwrap();

        drop(staging);
        assert_eq!(fs::read(&temporary).unwrap(), b"replacement");
        assert!(displaced.exists());
        fs::remove_file(temporary).unwrap();
        fs::remove_file(displaced).unwrap();
    }

    #[test]
    fn job_input_blob_replay_and_racing_destination_never_overwrite() {
        let (_directory, paths) = roots("breadboard-runtime-blob-no-overwrite");
        let bytes = b"first sealed bytes";
        let digest = blob_digest(bytes);
        let mut first = paths
            .begin_job_input_blob_staging("job_1", "blob_1", bytes.len() as u64, 1024, &digest)
            .unwrap();
        first.write_all(bytes).unwrap();
        let sealed = first.seal().unwrap();
        assert!(matches!(
            paths.begin_job_input_blob_staging(
                "job_1",
                "blob_1",
                bytes.len() as u64,
                1024,
                &digest
            ),
            Err(PathError::AlreadyStaged("job input blob"))
        ));
        sealed.revalidate().unwrap();
        assert_eq!(fs::read(sealed.file.path.absolute()).unwrap(), bytes);

        let racing_bytes = b"candidate";
        let mut racing = paths
            .begin_job_input_blob_staging(
                "job_1",
                "blob_2",
                racing_bytes.len() as u64,
                1024,
                &blob_digest(racing_bytes),
            )
            .unwrap();
        racing.write_all(racing_bytes).unwrap();
        let racing_temporary = racing.staging.path.absolute().to_path_buf();
        let final_path = paths
            .data_root()
            .join("runtime/jobs/job_1/inputs/blob_2/payload");
        File::create(&final_path)
            .unwrap()
            .write_all(b"racing winner")
            .unwrap();
        assert!(matches!(
            racing.seal(),
            Err(PathError::AlreadyStaged("job input blob"))
        ));
        assert!(!racing_temporary.exists());
        assert_eq!(fs::read(final_path).unwrap(), b"racing winner");
    }

    #[test]
    fn job_input_blob_rejects_zero_invalid_digest_and_traversal_before_creating_paths() {
        let (_directory, paths) = roots("breadboard-runtime-blob-traversal");
        let digest = blob_digest(b"x");
        assert!(matches!(
            paths.begin_job_input_blob_staging("job_1", "blob_1", 0, 1, &digest),
            Err(PathError::InvalidBlobSize { maximum_bytes: 1 })
        ));
        assert!(matches!(
            paths.begin_job_input_blob_staging("job_1", "blob_1", 1, 1, "ABC"),
            Err(PathError::InvalidBlobDigest)
        ));
        assert!(paths
            .begin_job_input_blob_staging("../job_1", "blob_1", 1, 1, &digest)
            .is_err());
        assert!(paths
            .begin_job_input_blob_staging("job_1", "../blob_1", 1, 1, &digest)
            .is_err());
        assert!(!paths.data_root().join("runtime/jobs").exists());
    }

    #[cfg(unix)]
    #[test]
    fn sealed_job_input_blob_revalidation_detects_same_inode_mutation() {
        let (_directory, paths) = roots("breadboard-runtime-blob-mutation");
        let bytes = b"sealed bytes";
        let mut staging = paths
            .begin_job_input_blob_staging(
                "job_1",
                "blob_1",
                bytes.len() as u64,
                64,
                &blob_digest(bytes),
            )
            .unwrap();
        staging.write_all(bytes).unwrap();
        let sealed = staging.seal().unwrap();
        fs::write(sealed.file.path.absolute(), b"altered byte").unwrap();
        assert!(matches!(sealed.revalidate(), Err(PathError::FileChanged)));
    }

    #[test]
    fn job_input_is_validated_before_any_job_directory_is_created() {
        let (_directory, paths) = roots("breadboard-runtime-invalid-stage-input");
        assert!(matches!(
            paths.stage_job_input("job_1", br#"{"z":1,"a":2}"#),
            Err(PathError::InvalidJobInput)
        ));
        assert!(!paths.data_root().join("runtime/jobs/job_1").exists());

        let oversized = vec![b' '; MAX_REQUEST_BODY_BYTES + 1];
        assert!(matches!(
            paths.stage_job_input("job_2", &oversized),
            Err(PathError::InvalidJobInput)
        ));
        assert!(!paths.data_root().join("runtime/jobs/job_2").exists());
        assert!(paths.stage_job_input("../job_3", b"{}").is_err());
    }

    #[test]
    fn worker_start_is_fenced_to_one_exact_attempt_root_and_fixed_argv() {
        let (_directory, paths) = roots("breadboard-runtime-worker-start");
        drop(
            paths
                .stage_job_input("job_1", br#"{"sourceIds":["one"]}"#)
                .unwrap(),
        );
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 2,
            worker_instance_id: "worker_7".into(),
        };
        let attempt_directory = paths
            .data_root()
            .join("runtime/jobs/job_1/attempts/2/worker_7");
        fs::create_dir_all(&attempt_directory).unwrap();
        let stale_fixed_pending = attempt_directory.join("start.json.pending");
        File::create(&stale_fixed_pending)
            .unwrap()
            .write_all(b"orphan from a crashed older runtime")
            .unwrap();

        let execution_scope = WorkerExecutionScope::new(
            Some(42),
            Some("garden-1".into()),
            Some("conversation-1".into()),
        )
        .unwrap();
        let prepared = paths
            .prepare_worker_start(&identity, &execution_scope, &[])
            .unwrap();
        assert_eq!(prepared.start_manifest_argument(), "start.json");
        assert_eq!(
            prepared.launch_directory().absolute(),
            fs::canonicalize(
                paths
                    .data_root()
                    .join("runtime/jobs/job_1/attempts/2/worker_7")
            )
            .unwrap()
        );
        assert!(paths
            .data_root()
            .join("runtime/jobs/job_1/attempts/2/worker_7/workspace")
            .is_dir());

        let start_path = paths
            .resolve_data("runtime/jobs/job_1/attempts/2/worker_7/start.json")
            .unwrap();
        let (encoded, _pin) = paths
            .read_bounded_data_file_with_pin(&start_path, MAX_WORKER_START_MANIFEST_BYTES)
            .unwrap();
        let parsed = parse_worker_start_manifest(&encoded).unwrap();
        assert_eq!(&parsed, prepared.manifest());
        assert_eq!(parsed.execution_scope, execution_scope);
        assert_eq!(
            prepared.manifest().workspace_path,
            "runtime/jobs/job_1/attempts/2/worker_7/workspace"
        );
        assert!(stale_fixed_pending.exists());
        assert!(fs::read_dir(&attempt_directory)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with("start.json.pending.")));
        prepared.revalidate().unwrap();
        drop(prepared);

        let mismatched_scope = unscoped_worker();
        assert!(matches!(
            paths.prepare_worker_start(&identity, &mismatched_scope, &[]),
            Err(PathError::AlreadyStaged("worker start manifest"))
        ));
        let (encoded, _pin) = paths
            .read_bounded_data_file_with_pin(&start_path, MAX_WORKER_START_MANIFEST_BYTES)
            .unwrap();
        assert_eq!(
            parse_worker_start_manifest(&encoded)
                .unwrap()
                .execution_scope,
            execution_scope
        );
    }

    #[test]
    fn worker_start_requires_the_previously_staged_fixed_input() {
        let (_directory, paths) = roots("breadboard-runtime-worker-start-input");
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        assert!(paths
            .prepare_worker_start(&identity, &unscoped_worker(), &[])
            .is_err());
        assert!(!paths
            .data_root()
            .join("runtime/jobs/job_1/attempts/1/worker_1/start.json")
            .exists());
    }

    #[test]
    fn configured_roots_must_exist_and_be_absolute_directories() {
        assert!(matches!(
            RuntimePaths::new("relative/data", "relative/app", "relative/runtime"),
            Err(PathError::RelativeRoot(_))
        ));
        let base = std::env::temp_dir().join("breadboard-runtime-missing-root");
        assert!(matches!(
            RuntimePaths::new(
                base.join("missing-data"),
                base.join("missing-app"),
                base.join("missing-runtime")
            ),
            Err(PathError::RootUnavailable(_, _))
        ));
    }

    #[test]
    fn existing_directory_pins_use_trusted_root_validation() {
        let directory = tempfile::Builder::new()
            .prefix("breadboard-runtime-directory-pin")
            .tempdir()
            .unwrap();
        let config = directory.path().join("config");
        fs::create_dir(&config).unwrap();

        let pin = TrustedDirectoryPin::pin_existing("configuration", &config).unwrap();
        let canonical = fs::canonicalize(&config).unwrap();
        assert_eq!(pin.absolute(), canonical.as_path());
        pin.revalidate().unwrap();

        assert!(matches!(
            TrustedDirectoryPin::pin_existing("configuration", "relative/config"),
            Err(PathError::RelativeRoot("configuration"))
        ));
        let file = directory.path().join("not-a-directory");
        File::create(&file).unwrap();
        assert!(matches!(
            TrustedDirectoryPin::pin_existing("configuration", file),
            Err(PathError::RootNotDirectory("configuration"))
        ));
    }

    #[test]
    fn pinned_configuration_reads_are_bounded_and_cannot_traverse() {
        let directory = tempfile::Builder::new()
            .prefix("breadboard-runtime-configuration-read")
            .tempdir()
            .unwrap();
        let config = directory.path().join("config");
        fs::create_dir(&config).unwrap();
        fs::write(config.join("desktop-config.json"), br#"{"version":2}"#).unwrap();
        fs::write(directory.path().join("outside.json"), b"secret").unwrap();

        let pin = TrustedDirectoryPin::pin_existing("configuration", &config).unwrap();
        assert_eq!(
            pin.read_bounded_file("desktop-config.json", 13).unwrap(),
            br#"{"version":2}"#
        );
        assert!(matches!(
            pin.read_bounded_file("desktop-config.json", 12),
            Err(PathError::OversizedFile { maximum_bytes: 12 })
        ));
        assert!(pin.read_bounded_file("../outside.json", 64).is_err());
        pin.revalidate().unwrap();
    }

    #[test]
    fn launch_directory_is_minted_only_from_runtime_data_authority() {
        let (_directory, paths) = roots("breadboard-runtime-launch-directory");
        let launch = paths
            .prepare_launch_directory("runtime/jobs/job_1/workspace")
            .unwrap();
        assert!(launch.absolute().starts_with(paths.data_root()));
        assert_eq!(launch.authority, LaunchDirectoryAuthority::RuntimeData);
        launch.revalidate().unwrap();
    }

    #[test]
    fn service_cwd_is_minted_only_from_an_existing_app_subdirectory() {
        let (_directory, paths) = roots("breadboard-runtime-app-launch-directory");
        fs::create_dir_all(paths.app_root().join("dashboard/scripts")).unwrap();

        let launch = paths.pin_app_launch_directory("dashboard").unwrap();
        assert!(launch.absolute().starts_with(paths.app_root()));
        assert_eq!(launch.authority, LaunchDirectoryAuthority::Application);
        launch.revalidate().unwrap();

        assert!(paths.pin_app_launch_directory("../dashboard").is_err());
        assert!(paths.pin_app_launch_directory("missing").is_err());
    }

    #[test]
    fn service_cwd_is_minted_only_from_an_existing_data_subdirectory() {
        let (_directory, paths) = roots("breadboard-runtime-data-launch-directory");
        fs::create_dir_all(paths.data_root().join("runtime-v2/toolchains/comfyui")).unwrap();

        let launch = paths
            .pin_data_launch_directory("runtime-v2/toolchains/comfyui")
            .unwrap();
        assert!(launch.absolute().starts_with(paths.data_root()));
        assert_eq!(launch.authority, LaunchDirectoryAuthority::RuntimeData);
        launch.revalidate().unwrap();

        assert!(paths.pin_data_launch_directory("../comfyui").is_err());
        assert!(paths
            .pin_data_launch_directory("runtime-v2/toolchains/missing")
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn existing_directory_pin_detects_path_replacement() {
        let directory = tempfile::Builder::new()
            .prefix("breadboard-runtime-directory-pin-replacement")
            .tempdir()
            .unwrap();
        let config = directory.path().join("config");
        let displaced = directory.path().join("displaced-config");
        fs::create_dir(&config).unwrap();
        let pin = TrustedDirectoryPin::pin_existing("configuration", &config).unwrap();

        fs::rename(&config, displaced).unwrap();
        fs::create_dir(&config).unwrap();

        assert!(matches!(
            pin.revalidate(),
            Err(PathError::RootChanged("configuration"))
        ));
    }

    #[test]
    fn bounded_reads_use_the_minting_authority_and_exact_size_limit() {
        let (_directory, paths) = roots("breadboard-runtime-bounded-read");
        let file_path = paths
            .runtime_root()
            .join("runtime-v2/manifests/workers.json");
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        File::create(&file_path).unwrap().write_all(b"{}").unwrap();
        let resolved = paths
            .resolve_runtime("runtime-v2/manifests/workers.json")
            .unwrap();
        assert_eq!(
            paths.read_bounded_runtime_file(&resolved, 2).unwrap(),
            b"{}"
        );
        assert!(matches!(
            paths.read_bounded_runtime_file(&resolved, 1),
            Err(PathError::OversizedFile { maximum_bytes: 1 })
        ));

        let (second_directory, second) = roots("breadboard-runtime-other-authority");
        assert!(matches!(
            second.read_bounded_runtime_file(&resolved, 2),
            Err(PathError::WrongAuthority("runtime"))
        ));
        drop(second);
        drop(second_directory);
    }

    #[test]
    fn service_diagnostic_log_is_atomic_bounded_and_keeps_the_newest_records() {
        let (_directory, paths) = roots("breadboard-runtime-service-log");
        for sequence in 0..8 {
            paths
                .append_bounded_service_log(
                    "dashboard",
                    format!("record-{sequence:02}-abcdefghijkl").as_bytes(),
                    64,
                )
                .unwrap();
        }
        let path = paths.data_root().join("logs/services/dashboard.log");
        let bytes = fs::read(path).unwrap();
        assert!(bytes.len() <= 64);
        assert!(bytes.ends_with(b"\n"));
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("record-07-abcdefghijkl"));
        assert!(!text.contains("record-00-abcdefghijkl"));
        assert!(paths
            .append_bounded_service_log("../escaped", b"record", 64)
            .is_err());
    }

    #[test]
    fn worker_diagnostic_log_is_attempt_fenced_atomic_and_bounded() {
        let (_directory, paths) = roots("breadboard-runtime-worker-log");
        let identity = WorkerIdentity {
            job_id: "job_upload_1".into(),
            attempt: 2,
            worker_instance_id: "worker_ingest_1".into(),
        };
        for sequence in 0..8 {
            paths
                .append_bounded_worker_log(
                    &identity,
                    format!("stderr-{sequence:02}-abcdefghijkl").as_bytes(),
                    64,
                )
                .unwrap();
        }

        let expected = paths
            .data_root()
            .join("runtime/jobs/job_upload_1/attempts/2/worker_ingest_1/diagnostics.log");
        let bytes = fs::read(&expected).unwrap();
        assert!(bytes.len() <= 64);
        assert!(bytes.ends_with(b"\n"));
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("stderr-07-abcdefghijkl"));
        assert!(!text.contains("stderr-00-abcdefghijkl"));
        assert_eq!(
            paths.read_bounded_worker_log(&identity, 64).unwrap(),
            fs::read(expected).unwrap()
        );

        let other_attempt = WorkerIdentity {
            attempt: 3,
            ..identity.clone()
        };
        assert!(paths
            .read_bounded_worker_log(&other_attempt, 64)
            .unwrap()
            .is_empty());
        let invalid = WorkerIdentity {
            job_id: "../escaped".into(),
            ..identity
        };
        assert!(paths
            .append_bounded_worker_log(&invalid, b"record", 64)
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn bounded_reads_reject_symlink_components() {
        use std::os::unix::fs::symlink;

        let (outside, paths) = roots("breadboard-runtime-symlink-read");
        let target = outside.path().join("outside.json");
        File::create(&target).unwrap().write_all(b"{}").unwrap();
        let link = paths.app_root().join("linked.json");
        symlink(&target, &link).unwrap();
        let resolved = paths.resolve_app("linked.json").unwrap();
        assert!(matches!(
            paths.read_bounded_app_file(&resolved, 2),
            Err(PathError::ReparsePoint)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn staging_rejects_symlinked_job_and_attempt_components_before_writing() {
        use std::os::unix::fs::symlink;

        let (directory, paths) = roots("breadboard-runtime-symlink-stage");
        let outside_job = directory.path().join("outside-job");
        fs::create_dir(&outside_job).unwrap();
        fs::create_dir_all(paths.data_root().join("runtime/jobs")).unwrap();
        symlink(&outside_job, paths.data_root().join("runtime/jobs/job_1")).unwrap();
        assert!(matches!(
            paths.stage_job_input("job_1", b"{}"),
            Err(PathError::ReparsePoint)
        ));
        assert!(!outside_job.join("input.json").exists());

        let outside_input = directory.path().join("outside-input.json");
        File::create(&outside_input)
            .unwrap()
            .write_all(b"{}")
            .unwrap();
        fs::create_dir_all(paths.data_root().join("runtime/jobs/job_3")).unwrap();
        symlink(
            &outside_input,
            paths.data_root().join("runtime/jobs/job_3/input.json"),
        )
        .unwrap();
        assert!(matches!(
            paths.stage_job_input("job_3", b"{}"),
            Err(PathError::ReparsePoint)
        ));
        assert_eq!(fs::read(outside_input).unwrap(), b"{}");

        let outside_blob = directory.path().join("outside-blob");
        fs::create_dir(&outside_blob).unwrap();
        fs::create_dir_all(paths.data_root().join("runtime/jobs/job_4/inputs")).unwrap();
        symlink(
            &outside_blob,
            paths.data_root().join("runtime/jobs/job_4/inputs/blob_1"),
        )
        .unwrap();
        assert!(matches!(
            paths.begin_job_input_blob_staging("job_4", "blob_1", 2, 2, &blob_digest(b"{}")),
            Err(PathError::ReparsePoint)
        ));
        assert!(!outside_blob.join("payload").exists());

        drop(paths.stage_job_input("job_2", b"{}").unwrap());
        let outside_attempts = directory.path().join("outside-attempts");
        fs::create_dir(&outside_attempts).unwrap();
        symlink(
            &outside_attempts,
            paths.data_root().join("runtime/jobs/job_2/attempts"),
        )
        .unwrap();
        let identity = WorkerIdentity {
            job_id: "job_2".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        assert!(matches!(
            paths.prepare_worker_start(&identity, &unscoped_worker(), &[]),
            Err(PathError::ReparsePoint)
        ));
        assert!(!outside_attempts.join("1/worker_1/start.json").exists());
    }
}
