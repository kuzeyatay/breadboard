use breadboard_runtime_core::JobStore;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

#[derive(Default)]
struct ShutdownState {
    requested: bool,
    accepting_work: bool,
    store: Option<Weak<JobStore>>,
}

/// One serialized gate coordinates parent disconnect, authenticated shutdown,
/// and the durable admission gate. This avoids a race where admission could be
/// reopened after another thread had already requested shutdown.
#[derive(Default)]
pub(crate) struct ShutdownCoordinator {
    state: Mutex<ShutdownState>,
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
        first_request
    }

    pub(crate) fn is_requested(&self) -> bool {
        self.lock().requested
    }

    pub(crate) fn is_accepting_work(&self) -> bool {
        self.lock().accepting_work
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

    #[test]
    fn shutdown_is_idempotent_and_cannot_be_reopened() {
        let coordinator = ShutdownCoordinator::default();
        assert!(coordinator.request_shutdown());
        assert!(!coordinator.request_shutdown());
        assert!(coordinator.open_admission().is_err());
        assert!(!coordinator.is_accepting_work());
    }
}
