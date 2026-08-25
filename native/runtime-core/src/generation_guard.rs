use sha2::{Digest, Sha256};
use std::fmt;
use std::time::Duration;
use thiserror::Error;

const GENERATION_SCOPE_DOMAIN: &[u8] = b"breadboard-runtime-v2-generation-scope\0";
const OBJECT_NAME_PREFIX: &str = "Global\\Breadboard.RuntimeV2.v1.";
const OWNER_OBJECT_SUFFIX: &str = ".owner";
const DRAIN_OBJECT_SUFFIX: &str = ".drain";
const MAX_GENERATION_WAIT: Duration = Duration::from_secs(300);

#[cfg(windows)]
static GENERATION_GUARD_ACQUIRED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// The exit status assigned to a process terminated while draining a previous
/// runtime generation. Durable restart reconciliation remains responsible for
/// classifying the interrupted operation; this private status is not a public
/// job failure code.
#[cfg(windows)]
const PRIOR_GENERATION_DRAIN_EXIT_CODE: u32 = 75;

/// Opaque, stable authority scope for one pinned Runtime V2 data root.
///
/// This is deliberately not constructible outside `runtime-core`. A later
/// `RuntimePaths` integration will mint it from the already-opened Windows
/// volume and file identity rather than accepting a path, PID, lock-file
/// payload, or caller-provided object name.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct RuntimeGenerationScope {
    digest: [u8; 32],
}

impl RuntimeGenerationScope {
    /// Staged constructor for `RuntimePaths`. Keeping it crate-private prevents
    /// an untrusted bootstrap value from choosing the kernel-object namespace.
    #[allow(dead_code)]
    pub(crate) fn from_trusted_data_root_identity(volume: u64, file: u64) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(GENERATION_SCOPE_DOMAIN);
        hasher.update(volume.to_le_bytes());
        hasher.update(file.to_le_bytes());
        Self {
            digest: hasher.finalize().into(),
        }
    }

    fn object_name(&self, suffix: &str) -> String {
        let mut name = String::with_capacity(
            OBJECT_NAME_PREFIX.len() + self.digest.len() * 2 + suffix.len(),
        );
        name.push_str(OBJECT_NAME_PREFIX);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in self.digest {
            name.push(char::from(HEX[usize::from(byte >> 4)]));
            name.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
        name.push_str(suffix);
        name
    }

    fn owner_object_name(&self) -> String {
        self.object_name(OWNER_OBJECT_SUFFIX)
    }

    fn drain_object_name(&self) -> String {
        self.object_name(DRAIN_OBJECT_SUFFIX)
    }
}

impl fmt::Debug for RuntimeGenerationScope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RuntimeGenerationScope(<opaque pinned-root identity>)")
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GenerationGuardError {
    #[error("Runtime V2 generation ownership is unsupported on this platform")]
    UnsupportedPlatform,
    #[error("Runtime V2 generation owner wait is outside its bounded range")]
    InvalidOwnerWait,
    #[error("Runtime V2 prior-generation drain wait is outside its bounded range")]
    InvalidDrainWait,
    #[error("this process already acquired Runtime V2 generation ownership")]
    AlreadyAcquired,
    #[error("another Runtime V2 generation still owns this data root")]
    OwnerBusy,
    #[error("creating the Runtime V2 generation owner failed with Windows error {code}")]
    OwnerCreate { code: u32 },
    #[error("waiting for the Runtime V2 generation owner failed with Windows error {code}")]
    OwnerWait { code: u32 },
    #[error("waiting for the Runtime V2 generation owner returned unexpected status {status}")]
    OwnerWaitStatus { status: u32 },
    #[error("creating or opening the Runtime V2 generation drain job failed with Windows error {code}")]
    DrainJobCreate { code: u32 },
    #[error("the existing Runtime V2 generation drain job has incompatible containment limits")]
    IncompatibleDrainJob,
    #[error("configuring the Runtime V2 generation drain job failed with Windows error {code}")]
    DrainJobConfigure { code: u32 },
    #[error("querying the Runtime V2 generation drain job failed with Windows error {code}")]
    DrainJobQuery { code: u32 },
    #[error("terminating the previous Runtime V2 generation failed with Windows error {code}")]
    DrainJobTerminate { code: u32 },
    #[error("the previous Runtime V2 generation did not reach zero resident processes before the deadline")]
    DrainTimeout { active_processes: u32 },
}

/// Process-lifetime ownership of one Runtime V2 generation.
///
/// On Windows the mutex and outer Job Object handles are intentionally wrapped
/// in `ManuallyDrop`: an accidental Rust drop must not release the generation
/// boundary while this process can still execute. The operating system closes
/// both handles at process termination. Normal host integration must therefore
/// retain this value for the entire process and must never call `ReleaseMutex`.
pub struct RuntimeGenerationGuard {
    scope: RuntimeGenerationScope,
    // A Windows mutex is owned by the acquiring thread. Preventing this guard
    // from becoming Send/Sync keeps that thread affinity explicit even though
    // launch membership below is safe to clone onto dispatcher threads.
    _thread_affinity: std::marker::PhantomData<std::rc::Rc<()>>,
    #[cfg(windows)]
    owner_mutex: std::mem::ManuallyDrop<windows::OwnedHandle>,
    #[cfg(windows)]
    drain_job: std::mem::ManuallyDrop<std::sync::Arc<windows::OwnedHandle>>,
}

impl fmt::Debug for RuntimeGenerationGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.scope, &self._thread_affinity);
        #[cfg(windows)]
        let _ = (&self.owner_mutex, &self.drain_job);
        formatter.write_str("RuntimeGenerationGuard(<process-lifetime kernel authority>)")
    }
}

impl RuntimeGenerationGuard {
    /// Acquires exclusive generation ownership and proves that the prior outer
    /// Job Object contains no live processes.
    ///
    /// `owner_wait` may be zero for fail-fast acquisition. `drain_wait` must be
    /// nonzero. Both waits are capped so bootstrap cannot block indefinitely.
    #[cfg(windows)]
    pub fn acquire(
        scope: RuntimeGenerationScope,
        owner_wait: Duration,
        drain_wait: Duration,
    ) -> Result<(Self, PriorGenerationDrained), GenerationGuardError> {
        use std::sync::atomic::Ordering;

        if GENERATION_GUARD_ACQUIRED
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(GenerationGuardError::AlreadyAcquired);
        }
        let result: Result<(Self, PriorGenerationDrained), GenerationGuardError> = (|| {
            let owner_wait_ms = bounded_wait_millis(owner_wait, true)?;
            let drain_wait = validate_drain_wait(drain_wait)?;
            let owner_mutex =
                windows::acquire_owner_mutex(&scope.owner_object_name(), owner_wait_ms)?;
            let drain_job = std::sync::Arc::new(windows::open_and_drain_job(
                &scope.drain_object_name(),
                drain_wait,
            )?);
            let proof = PriorGenerationDrained {
                scope: scope.clone(),
                private: (),
            };
            Ok((
                Self {
                    scope,
                    _thread_affinity: std::marker::PhantomData,
                    owner_mutex: std::mem::ManuallyDrop::new(owner_mutex),
                    drain_job: std::mem::ManuallyDrop::new(drain_job),
                },
                proof,
            ))
        })();
        if result.is_err() {
            GENERATION_GUARD_ACQUIRED.store(false, Ordering::Release);
        }
        result
    }

    #[cfg(not(windows))]
    pub fn acquire(
        _scope: RuntimeGenerationScope,
        _owner_wait: Duration,
        _drain_wait: Duration,
    ) -> Result<(Self, PriorGenerationDrained), GenerationGuardError> {
        Err(GenerationGuardError::UnsupportedPlatform)
    }

    pub fn matches_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.scope == *scope
    }

    /// Mints cloneable launch membership backed by the same outer Job Object.
    /// It carries no mutex ownership and cannot authorize reconciliation.
    pub fn membership(&self) -> CurrentGenerationMembership {
        CurrentGenerationMembership {
            scope: self.scope.clone(),
            #[cfg(windows)]
            drain_job: std::sync::Arc::clone(&*self.drain_job),
        }
    }
}

/// Cloneable authority used only to place new helpers in the current outer Job
/// Object. This is intentionally weaker than `PriorGenerationDrained`.
#[derive(Clone)]
pub struct CurrentGenerationMembership {
    scope: RuntimeGenerationScope,
    #[cfg(windows)]
    drain_job: std::sync::Arc<windows::OwnedHandle>,
}

impl CurrentGenerationMembership {
    pub fn matches_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.scope == *scope
    }

    #[cfg(windows)]
    #[allow(dead_code)]
    pub(crate) fn raw_job_handle(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.drain_job.raw()
    }
}

impl fmt::Debug for CurrentGenerationMembership {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = &self.scope;
        formatter.write_str("CurrentGenerationMembership(<opaque outer-job authority>)")
    }
}

/// One-shot startup evidence that the prior outer Job Object was observed with
/// exactly zero resident processes after exclusive generation ownership was
/// acquired. It is neither cloneable nor constructible outside this module.
pub struct PriorGenerationDrained {
    scope: RuntimeGenerationScope,
    private: (),
}

impl PriorGenerationDrained {
    pub fn matches_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        let _ = self.private;
        self.scope == *scope
    }
}

impl fmt::Debug for PriorGenerationDrained {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.scope, &self.private);
        formatter.write_str("PriorGenerationDrained(<opaque zero-resident proof>)")
    }
}

#[cfg(windows)]
fn bounded_wait_millis(
    wait: Duration,
    allow_zero: bool,
) -> Result<u32, GenerationGuardError> {
    if (!allow_zero && wait.is_zero()) || wait > MAX_GENERATION_WAIT {
        return Err(if allow_zero {
            GenerationGuardError::InvalidOwnerWait
        } else {
            GenerationGuardError::InvalidDrainWait
        });
    }
    if wait.is_zero() {
        return Ok(0);
    }
    let millis = wait.as_millis().max(1);
    u32::try_from(millis).map_err(|_| {
        if allow_zero {
            GenerationGuardError::InvalidOwnerWait
        } else {
            GenerationGuardError::InvalidDrainWait
        }
    })
}

#[cfg(windows)]
fn validate_drain_wait(wait: Duration) -> Result<Duration, GenerationGuardError> {
    bounded_wait_millis(wait, false)?;
    Ok(wait)
}

#[cfg(windows)]
mod windows {
    use super::{GenerationGuardError, PRIOR_GENERATION_DRAIN_EXIT_CODE};
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::{null, null_mut};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, SetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, HANDLE,
        WAIT_ABANDONED, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, QueryInformationJobObject, SetInformationJobObject,
        TerminateJobObject, JobObjectBasicAccountingInformation,
        JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_UI_RESTRICTIONS,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };
    use windows_sys::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};

    const DRAIN_POLL_INTERVAL: Duration = Duration::from_millis(10);

    pub(super) struct OwnedHandle(isize);

    impl OwnedHandle {
        fn from_raw(handle: HANDLE) -> Option<Self> {
            (!handle.is_null()).then_some(Self(handle as isize))
        }

        pub(super) fn raw(&self) -> HANDLE {
            self.0 as HANDLE
        }
    }

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.raw());
            }
        }
    }

    pub(super) fn acquire_owner_mutex(
        name: &str,
        wait_ms: u32,
    ) -> Result<OwnedHandle, GenerationGuardError> {
        let name = wide_name(name);
        unsafe { SetLastError(ERROR_SUCCESS) };
        let raw = unsafe { CreateMutexW(null(), 1, name.as_ptr()) };
        let created_error = unsafe { GetLastError() };
        let handle = OwnedHandle::from_raw(raw)
            .ok_or(GenerationGuardError::OwnerCreate { code: created_error })?;
        if created_error != ERROR_ALREADY_EXISTS {
            return Ok(handle);
        }

        match unsafe { WaitForSingleObject(handle.raw(), wait_ms) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(handle),
            WAIT_TIMEOUT => Err(GenerationGuardError::OwnerBusy),
            WAIT_FAILED => Err(GenerationGuardError::OwnerWait {
                code: unsafe { GetLastError() },
            }),
            status => Err(GenerationGuardError::OwnerWaitStatus { status }),
        }
    }

    pub(super) fn open_and_drain_job(
        name: &str,
        drain_wait: Duration,
    ) -> Result<OwnedHandle, GenerationGuardError> {
        let name = wide_name(name);
        unsafe { SetLastError(ERROR_SUCCESS) };
        let raw = unsafe { CreateJobObjectW(null(), name.as_ptr()) };
        let created_error = unsafe { GetLastError() };
        let job = OwnedHandle::from_raw(raw)
            .ok_or(GenerationGuardError::DrainJobCreate { code: created_error })?;
        let existed = created_error == ERROR_ALREADY_EXISTS;

        if !existed {
            configure_new_job(job.raw())?;
        }
        validate_job(job.raw())?;
        drain_prior_generation(job.raw(), drain_wait)?;
        Ok(job)
    }

    fn configure_new_job(job: HANDLE) -> Result<(), GenerationGuardError> {
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(GenerationGuardError::DrainJobConfigure {
                code: unsafe { GetLastError() },
            });
        }
        Ok(())
    }

    fn validate_job(job: HANDLE) -> Result<(), GenerationGuardError> {
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        if unsafe {
            QueryInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(GenerationGuardError::DrainJobQuery {
                code: unsafe { GetLastError() },
            });
        }
        let flags = limits.BasicLimitInformation.LimitFlags;
        if flags != JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            || flags & (JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK) != 0
        {
            return Err(GenerationGuardError::IncompatibleDrainJob);
        }

        let mut restrictions: JOBOBJECT_BASIC_UI_RESTRICTIONS = unsafe { zeroed() };
        if unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicUIRestrictions,
                (&mut restrictions as *mut JOBOBJECT_BASIC_UI_RESTRICTIONS).cast::<c_void>(),
                size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(GenerationGuardError::DrainJobQuery {
                code: unsafe { GetLastError() },
            });
        }
        if restrictions.UIRestrictionsClass != 0 {
            return Err(GenerationGuardError::IncompatibleDrainJob);
        }
        Ok(())
    }

    fn drain_prior_generation(
        job: HANDLE,
        drain_wait: Duration,
    ) -> Result<(), GenerationGuardError> {
        let mut active = active_processes(job)?;
        if active == 0 {
            return Ok(());
        }
        if unsafe { TerminateJobObject(job, PRIOR_GENERATION_DRAIN_EXIT_CODE) } == 0 {
            return Err(GenerationGuardError::DrainJobTerminate {
                code: unsafe { GetLastError() },
            });
        }

        let deadline = Instant::now()
            .checked_add(drain_wait)
            .ok_or(GenerationGuardError::InvalidDrainWait)?;
        loop {
            active = active_processes(job)?;
            if active == 0 {
                return Ok(());
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(GenerationGuardError::DrainTimeout {
                    active_processes: active,
                });
            }
            thread::sleep(DRAIN_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
        }
    }

    fn active_processes(job: HANDLE) -> Result<u32, GenerationGuardError> {
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        if unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast::<c_void>(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(GenerationGuardError::DrainJobQuery {
                code: unsafe { GetLastError() },
            });
        }
        Ok(accounting.ActiveProcesses)
    }

    fn wide_name(name: &str) -> Vec<u16> {
        name.encode_utf16().chain(Some(0)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_is_stable_and_separates_distinct_filesystem_identities() {
        let first = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let same = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let other_volume = RuntimeGenerationScope::from_trusted_data_root_identity(8, 11);
        let other_file = RuntimeGenerationScope::from_trusted_data_root_identity(7, 12);

        assert_eq!(first, same);
        assert_ne!(first, other_volume);
        assert_ne!(first, other_file);
    }

    #[test]
    fn object_names_are_global_bounded_ascii_and_kind_separated() {
        let scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let owner = scope.owner_object_name();
        let drain = scope.drain_object_name();

        assert!(owner.starts_with(OBJECT_NAME_PREFIX));
        assert!(owner.ends_with(OWNER_OBJECT_SUFFIX));
        assert!(drain.starts_with(OBJECT_NAME_PREFIX));
        assert!(drain.ends_with(DRAIN_OBJECT_SUFFIX));
        assert_ne!(owner, drain);
        assert!(owner.is_ascii());
        assert!(drain.is_ascii());
        assert!(owner.len() < 128);
        assert!(drain.len() < 128);
    }

    #[test]
    fn drain_proof_is_scoped_and_debug_output_is_redacted() {
        let scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let other = RuntimeGenerationScope::from_trusted_data_root_identity(7, 12);
        let proof = PriorGenerationDrained {
            scope: scope.clone(),
            private: (),
        };

        assert!(proof.matches_scope(&scope));
        assert!(!proof.matches_scope(&other));
        assert!(!format!("{proof:?}").contains(&scope.owner_object_name()));
        assert!(!format!("{scope:?}").contains(&scope.owner_object_name()));
    }

    #[cfg(windows)]
    #[test]
    fn wait_bounds_reject_unbounded_or_zero_drain_waits() {
        assert_eq!(bounded_wait_millis(Duration::ZERO, true), Ok(0));
        assert_eq!(
            validate_drain_wait(Duration::ZERO),
            Err(GenerationGuardError::InvalidDrainWait)
        );
        assert_eq!(
            bounded_wait_millis(MAX_GENERATION_WAIT + Duration::from_millis(1), true),
            Err(GenerationGuardError::InvalidOwnerWait)
        );
        assert_eq!(
            validate_drain_wait(MAX_GENERATION_WAIT + Duration::from_millis(1)),
            Err(GenerationGuardError::InvalidDrainWait)
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn unsupported_platform_fails_honestly() {
        let scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        assert!(matches!(
            RuntimeGenerationGuard::acquire(
                scope,
                Duration::ZERO,
                Duration::from_secs(1)
            ),
            Err(GenerationGuardError::UnsupportedPlatform)
        ));
    }
}
