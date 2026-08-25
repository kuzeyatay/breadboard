use breadboard_runtime_core::JobStore;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::time::Duration;

#[derive(Default)]
struct ShutdownState {
    requested: bool,
    accepting_work: bool,
    store: Option<Weak<JobStore>>,
}

/// One serialized gate coordinates parent disconnect, authenticated shutdown,
/// and the durable admission gate. This avoids a race where admission could be
/// reopened after another thread had already requested shutdown.
pub(crate) struct ShutdownCoordinator {
    state: Mutex<ShutdownState>,
    changed: Condvar,
}

impl Default for ShutdownCoordinator {
    fn default() -> Self {
        Self {
            state: Mutex::new(ShutdownState::default()),
            changed: Condvar::new(),
        }
    }
}

impl ShutdownCoordinator {
    pub(crate) fn attach_store(&self, store: &Arc<JobStore>) {
        let mut state = self.lock();
        store.set_accepting_work(false);
        state.store = Some(Arc::downgrade(store));
        state.accepting_work = false;
    }

    pub(crate) fn open_admission(&self) -> Result<(), ()> {
        let mut state = self.lock();
        if state.requested {
            return Err(());
        }
        let store = state.store.as_ref().and_then(Weak::upgrade).ok_or(())?;
        store.set_accepting_work(true);
        state.accepting_work = true;
        drop(state);
        self.changed.notify_all();
        Ok(())
    }

    /// Idempotently closes admission before any process-drain work begins.
    pub(crate) fn request_shutdown(&self) -> bool {
        let mut state = self.lock();
        let first_request = !state.requested;
        state.requested = true;
        state.accepting_work = false;
        if let Some(store) = state.store.as_ref().and_then(Weak::upgrade) {
            store.set_accepting_work(false);
        }
        drop(state);
        self.changed.notify_all();
        first_request
    }

    pub(crate) fn is_requested(&self) -> bool {
        self.lock().requested
    }

    pub(crate) fn is_accepting_work(&self) -> bool {
        self.lock().accepting_work
    }

    /// Linearizes the sole worker CreateProcess boundary against shutdown.
    /// Trusted launch preparation may happen before this call, but both the
    /// durable claim and process creation must occur inside `operation`.
    /// `request_shutdown` uses this same mutex, so it either closes acceptance
    /// before the claim exists or waits until the already-authorized launch has
    /// returned a classified authority-bearing outcome.
    pub(crate) fn with_worker_launch_gate<R>(&self, operation: impl FnOnce() -> R) -> Option<R> {
        let state = self.lock();
        if state.requested || !state.accepting_work {
            return None;
        }
        let result = operation();
        drop(state);
        Some(result)
    }

    /// Gives runtime-owned schedulers one bounded, non-spinning wait point.
    /// Admission opening and shutdown both wake the wait immediately; ordinary
    /// job submission is discovered on the bounded timeout because the HTTP
    /// adapter intentionally carries no process-scheduling authority.
    pub(crate) fn wait_for_dispatch_tick(&self, timeout: Duration) -> bool {
        let state = self.lock();
        if state.requested {
            return true;
        }
        let (state, _) = self
            .changed
            .wait_timeout(state, timeout)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.requested
    }

    fn lock(&self) -> MutexGuard<'_, ShutdownState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn shutdown_is_idempotent_and_cannot_be_reopened() {
        let coordinator = ShutdownCoordinator::default();
        assert!(coordinator.request_shutdown());
        assert!(!coordinator.request_shutdown());
        assert!(coordinator.open_admission().is_err());
        assert!(!coordinator.is_accepting_work());
    }

    #[test]
    fn shutdown_waits_for_an_already_authorized_launch_boundary() {
        let coordinator = Arc::new(ShutdownCoordinator::default());
        coordinator.lock().accepting_work = true;

        let (entered_tx, entered_rx) = mpsc::sync_channel(0);
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let launch_coordinator = Arc::clone(&coordinator);
        let launch = thread::spawn(move || {
            launch_coordinator.with_worker_launch_gate(|| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                42
            })
        });
        entered_rx.recv().unwrap();

        let (attempting_tx, attempting_rx) = mpsc::sync_channel(0);
        let (closed_tx, closed_rx) = mpsc::sync_channel(0);
        let shutdown_coordinator = Arc::clone(&coordinator);
        let closer = thread::spawn(move || {
            attempting_tx.send(()).unwrap();
            shutdown_coordinator.request_shutdown();
            closed_tx.send(()).unwrap();
        });
        attempting_rx.recv().unwrap();
        assert!(matches!(
            closed_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_tx.send(()).unwrap();
        assert_eq!(launch.join().unwrap(), Some(42));
        closed_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        closer.join().unwrap();
        assert!(coordinator.with_worker_launch_gate(|| ()).is_none());
    }
}
