//! Keeps runtime retention level with the scheduler, inside the runtime owner.
//!
//! Every recurring schedule tick is a durable job, about 10,000 a day on a real
//! install, nearly all verified no-ops. Retention used to run only when the
//! desktop relayed an OS-idle tick through the dashboard (two minutes without
//! input, then a request cut off after ten seconds), so it fell weeks behind:
//! one install held 273,000 tick folders and 541,000 job rows. The pass itself
//! is already bounded (about 200 ms, yields to any foreground job, and only
//! retires verified scheduler no-ops and settled status probes), so the owner
//! runs it on its own cadence and storage stays bounded on every machine.
use crate::shutdown::ShutdownCoordinator;
use breadboard_runtime_core::{JobStore, RuntimePaths, StorageMaintenanceReport};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Startup belongs to services and recovery; retention waits its turn.
const STARTUP_DELAY: Duration = Duration::from_secs(60);
/// While a pass keeps retiring work, the next slice follows almost at once.
const BACKLOG_DELAY: Duration = Duration::from_secs(1);
/// A person's job is running; check back without competing with it.
const BUSY_DELAY: Duration = Duration::from_secs(15);
/// Nothing retired. That is usually "caught up" (new ticks only become
/// eligible an hour after they finish) but can also be a slice whose budget went
/// to archiving, so check back soon: one bounded pass per 10 s is ~1.5% of a core.
const IDLE_DELAY: Duration = Duration::from_secs(10);
const STOP_POLL: Duration = Duration::from_millis(250);

pub(crate) struct RetentionPacer {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

/// How long to wait after a pass, from what it reported.
pub(crate) fn next_delay(report: &StorageMaintenanceReport) -> Duration {
    if report.busy {
        BUSY_DELAY
    } else if report.jobs_pruned + report.directories_removed + report.events_archived > 0 {
        BACKLOG_DELAY
    } else {
        IDLE_DELAY
    }
}

impl RetentionPacer {
    pub(crate) fn start(
        store: Arc<JobStore>,
        paths: RuntimePaths,
        shutdown: Arc<ShutdownCoordinator>,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("runtime-retention".into())
            .spawn(move || {
                let mut wait = STARTUP_DELAY;
                loop {
                    let until = Instant::now() + wait;
                    while Instant::now() < until {
                        if stopping.load(Ordering::Acquire) || shutdown.is_requested() {
                            return;
                        }
                        thread::sleep(STOP_POLL);
                    }
                    // Closed admission is shutdown or a lifecycle quiesce (the
                    // data-location move copies the store); never prune under it.
                    if !shutdown.is_accepting_work() {
                        wait = BUSY_DELAY;
                        continue;
                    }
                    wait = match store.storage_maintenance(&paths) {
                        Ok(report) => next_delay(&report),
                        // A locked or briefly unavailable store retries later;
                        // the dashboard's idle path remains as before.
                        Err(_) => IDLE_DELAY,
                    };
                }
            })
            .ok();
        Self { stop, thread }
    }

    pub(crate) fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for RetentionPacer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backlog_comes_straight_back_busy_and_caught_up_back_off() {
        let mut report = StorageMaintenanceReport::default();
        assert_eq!(next_delay(&report), IDLE_DELAY);
        report.directories_removed = 3;
        assert_eq!(next_delay(&report), BACKLOG_DELAY);
        report.busy = true;
        assert_eq!(next_delay(&report), BUSY_DELAY);
        let archived = StorageMaintenanceReport { events_archived: 1, ..Default::default() };
        assert_eq!(next_delay(&archived), BACKLOG_DELAY);
        // Inspecting without retiring anything is not a backlog.
        let inspected = StorageMaintenanceReport { inspected: 256, protected: 256, ..Default::default() };
        assert_eq!(next_delay(&inspected), IDLE_DELAY);
    }
}
