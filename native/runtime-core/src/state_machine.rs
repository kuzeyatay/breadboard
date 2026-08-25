use breadboard_runtime_protocol::JobState;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
#[error("invalid job-state transition {from:?} -> {to:?}")]
pub struct StateTransitionError {
    pub from: JobState,
    pub to: JobState,
}

pub fn can_transition(from: JobState, to: JobState) -> bool {
    use JobState::*;
    matches!(
        (from, to),
        // A queued job may become resource-exhausted only when serialized
        // admission records a permanent denial before creating a reservation.
        (Queued, Admitted | Cancelling | ResourceExhausted)
            | (
                Admitted,
                Starting | Cancelling | ResourceExhausted | Interrupted
            )
            | (
                Starting,
                Running | Cancelling | Failed | ResourceExhausted | Interrupted | Uncertain
            )
            | (
                Running,
                Checkpointing | Cancelling | Failed | ResourceExhausted | Interrupted | Uncertain
            )
            | (
                Checkpointing,
                Running | Cancelling | Failed | ResourceExhausted | Interrupted | Uncertain
            )
            | (
                Cancelling,
                Cancelled | Failed | ResourceExhausted | Interrupted | Uncertain
            )
    )
}

/// Success is deliberately excluded from the general transition table. A
/// worker's `complete` line is only an intent; only the process owner may use
/// this transition after it has validated the durable result and observed the
/// complete owned process tree exit.
pub(crate) fn validate_completion_confirmation(from: JobState) -> Result<(), StateTransitionError> {
    if matches!(from, JobState::Running | JobState::Checkpointing) {
        Ok(())
    } else {
        Err(StateTransitionError {
            from,
            to: JobState::Succeeded,
        })
    }
}

pub fn validate_transition(from: JobState, to: JobState) -> Result<(), StateTransitionError> {
    if can_transition(from, to) {
        Ok(())
    } else {
        Err(StateTransitionError { from, to })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_states_cannot_transition() {
        for terminal in [
            JobState::Cancelled,
            JobState::Succeeded,
            JobState::Failed,
            JobState::ResourceExhausted,
            JobState::Interrupted,
            JobState::Uncertain,
        ] {
            assert!(!can_transition(terminal, JobState::Queued));
            assert!(!can_transition(terminal, JobState::Running));
        }
    }

    #[test]
    fn cancellation_requires_the_confirmed_terminal_step() {
        assert!(can_transition(JobState::Queued, JobState::Cancelling));
        assert!(can_transition(JobState::Admitted, JobState::Cancelling));
        assert!(can_transition(JobState::Running, JobState::Cancelling));
        assert!(can_transition(JobState::Cancelling, JobState::Cancelled));
        assert!(!can_transition(JobState::Queued, JobState::Cancelled));
        assert!(!can_transition(JobState::Admitted, JobState::Cancelled));
        assert!(!can_transition(JobState::Running, JobState::Cancelled));
    }

    #[test]
    fn permanent_admission_denial_can_terminalize_a_queued_job() {
        assert!(can_transition(
            JobState::Queued,
            JobState::ResourceExhausted
        ));
        assert!(!can_transition(JobState::Queued, JobState::Failed));
        assert!(!can_transition(JobState::Queued, JobState::Interrupted));
    }

    #[test]
    fn success_requires_the_completion_confirmation_path() {
        assert!(!can_transition(JobState::Running, JobState::Succeeded));
        assert!(!can_transition(
            JobState::Checkpointing,
            JobState::Succeeded
        ));
        assert!(validate_completion_confirmation(JobState::Running).is_ok());
        assert!(validate_completion_confirmation(JobState::Checkpointing).is_ok());
        assert!(validate_completion_confirmation(JobState::Cancelling).is_err());
    }
}
