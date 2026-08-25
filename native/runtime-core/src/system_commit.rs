use crate::admission::SystemCommit;
use std::io;
use thiserror::Error;

const MEBIBYTE_BYTES: u64 = 1024 * 1024;

/// Exact system-wide Windows commit counters sampled from `GetPerformanceInfo`.
///
/// Keeping the native byte values separate from the admission model prevents a
/// rounded display value from becoming resource authority. Admission receives
/// a conservative conversion: used commit rounds up while the limit rounds
/// down, so rounding can never manufacture headroom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemCommitSnapshot {
    total_bytes: u64,
    limit_bytes: u64,
}

impl SystemCommitSnapshot {
    fn from_pages(
        committed_pages: u64,
        commit_limit_pages: u64,
        page_size_bytes: u64,
    ) -> Result<Self, SystemCommitReadError> {
        if page_size_bytes == 0 || commit_limit_pages == 0 {
            return Err(SystemCommitReadError::InvalidSnapshot);
        }
        let total_bytes = committed_pages
            .checked_mul(page_size_bytes)
            .ok_or(SystemCommitReadError::CounterOverflow)?;
        let limit_bytes = commit_limit_pages
            .checked_mul(page_size_bytes)
            .ok_or(SystemCommitReadError::CounterOverflow)?;
        if total_bytes > limit_bytes {
            return Err(SystemCommitReadError::InvalidSnapshot);
        }
        Ok(Self {
            total_bytes,
            limit_bytes,
        })
    }

    pub fn admission_value(self) -> Result<SystemCommit, SystemCommitReadError> {
        if self.limit_bytes == 0 || self.total_bytes > self.limit_bytes {
            return Err(SystemCommitReadError::InvalidSnapshot);
        }
        let total_mb =
            self.total_bytes / MEBIBYTE_BYTES + u64::from(self.total_bytes % MEBIBYTE_BYTES != 0);
        let limit_mb = self.limit_bytes / MEBIBYTE_BYTES;
        if limit_mb == 0 {
            return Err(SystemCommitReadError::InvalidSnapshot);
        }
        Ok(SystemCommit { total_mb, limit_mb })
    }

    pub fn total_bytes(self) -> u64 {
        self.total_bytes
    }

    pub fn limit_bytes(self) -> u64 {
        self.limit_bytes
    }

    pub fn free_bytes(self) -> u64 {
        self.limit_bytes.saturating_sub(self.total_bytes)
    }

    #[cfg(test)]
    pub(crate) fn from_exact_bytes_for_test(
        total_bytes: u64,
        limit_bytes: u64,
    ) -> Result<Self, SystemCommitReadError> {
        if limit_bytes == 0 || total_bytes > limit_bytes {
            return Err(SystemCommitReadError::InvalidSnapshot);
        }
        Ok(Self {
            total_bytes,
            limit_bytes,
        })
    }
}

#[derive(Debug, Error)]
pub enum SystemCommitReadError {
    #[error("system-wide Windows commit counters are unavailable on this platform")]
    UnsupportedPlatform,
    #[error("system-wide Windows commit counters could not be read")]
    QueryFailed(#[source] io::Error),
    #[error("system-wide Windows commit counters are invalid")]
    InvalidSnapshot,
    #[error("system-wide Windows commit counters overflowed byte accounting")]
    CounterOverflow,
}

#[cfg(windows)]
pub fn read_system_commit() -> Result<SystemCommitSnapshot, SystemCommitReadError> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::ProcessStatus::{GetPerformanceInfo, PERFORMANCE_INFORMATION};

    // SAFETY: PERFORMANCE_INFORMATION is a plain C data structure whose `cb`
    // field is initialized to the exact structure size required by the API.
    // The pointer remains valid and uniquely borrowed for the duration of the
    // call, and no data is read unless the API reports success.
    let mut information: PERFORMANCE_INFORMATION = unsafe { zeroed() };
    information.cb = u32::try_from(size_of::<PERFORMANCE_INFORMATION>())
        .map_err(|_| SystemCommitReadError::CounterOverflow)?;
    if unsafe { GetPerformanceInfo(&mut information, information.cb) } == 0 {
        return Err(SystemCommitReadError::QueryFailed(
            io::Error::last_os_error(),
        ));
    }

    SystemCommitSnapshot::from_pages(
        information.CommitTotal as u64,
        information.CommitLimit as u64,
        information.PageSize as u64,
    )
}

#[cfg(not(windows))]
pub fn read_system_commit() -> Result<SystemCommitSnapshot, SystemCommitReadError> {
    Err(SystemCommitReadError::UnsupportedPlatform)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_counters_preserve_exact_system_commit_bytes() {
        let snapshot = SystemCommitSnapshot::from_pages(3, 10, 4096).unwrap();
        assert_eq!(snapshot.total_bytes, 12_288);
        assert_eq!(snapshot.limit_bytes, 40_960);
        assert_eq!(snapshot.free_bytes(), 28_672);
    }

    #[test]
    fn admission_conversion_never_rounds_headroom_up() {
        let snapshot = SystemCommitSnapshot {
            total_bytes: 8 * MEBIBYTE_BYTES + 1,
            limit_bytes: 20 * MEBIBYTE_BYTES + (MEBIBYTE_BYTES - 1),
        };
        assert_eq!(
            snapshot.admission_value().unwrap(),
            SystemCommit {
                total_mb: 9,
                limit_mb: 20,
            }
        );
    }

    #[test]
    fn malformed_or_overflowing_counters_fail_closed() {
        assert!(matches!(
            SystemCommitSnapshot::from_pages(1, 0, 4096),
            Err(SystemCommitReadError::InvalidSnapshot)
        ));
        assert!(matches!(
            SystemCommitSnapshot::from_pages(u64::MAX, u64::MAX, 2),
            Err(SystemCommitReadError::CounterOverflow)
        ));
        assert!(matches!(
            SystemCommitSnapshot {
                total_bytes: 2,
                limit_bytes: 1,
            }
            .admission_value(),
            Err(SystemCommitReadError::InvalidSnapshot)
        ));
    }
}
