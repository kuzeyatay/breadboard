//! Small, private diagnostics: never serialize paths, request contents or io::Error text.
use std::error::Error;
use std::io::{self, Write};

#[derive(Clone, Copy)]
pub(crate) enum ControllerOperation {
    Acquire,
    WorkerDependencyAcquire,
    Release,
    WorkerDependencyRelease,
    Retry,
    Drive,
    ShutdownDrain,
    ThreadCleanup,
}

impl ControllerOperation {
    fn label(self) -> &'static str {
        match self {
            Self::Acquire => "acquire",
            Self::WorkerDependencyAcquire => "worker-dependency-acquire",
            Self::Release => "release",
            Self::WorkerDependencyRelease => "worker-dependency-release",
            Self::Retry => "retry",
            Self::Drive => "drive",
            Self::ShutdownDrain => "shutdown-drain",
            Self::ThreadCleanup => "thread-cleanup",
        }
    }
}

pub(crate) fn controller_error(
    error: &(dyn Error + 'static),
    operation: ControllerOperation,
) -> String {
    let mut source = Some(error);
    // Bound traversal even for a malformed source chain. Ordinary non-I/O errors
    // keep their existing Display output and recovery/exit classification.
    for _ in 0..16 {
        let Some(current) = source else { break };
        if let Some(io) = current.downcast_ref::<io::Error>() {
            let code = io
                .raw_os_error()
                .map_or_else(|| "none".to_owned(), |code| code.to_string());
            return format!(
                "service controller I/O failure [operation={} kind={:?} os_code={code}]",
                operation.label(),
                io.kind()
            );
        }
        source = current.source();
    }
    error.to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShutdownOrigin {
    Internal,
    ParentChannel,
    AuthenticatedLifecycle,
}

impl ShutdownOrigin {
    fn label(self) -> &'static str {
        match self {
            Self::Internal => "internal",
            Self::ParentChannel => "parent-channel",
            Self::AuthenticatedLifecycle => "authenticated-lifecycle",
        }
    }
}

#[derive(Default)]
pub(crate) struct FirstShutdownOrigin(Option<ShutdownOrigin>);

impl FirstShutdownOrigin {
    // Called under the existing coordinator mutex; diagnostics do not control admission.
    pub(crate) fn record(&mut self, origin: ShutdownOrigin) {
        if self.0.is_none() {
            self.0 = Some(origin);
        }
    }
    pub(crate) fn get(&self) -> Option<ShutdownOrigin> {
        self.0
    }
}

pub(crate) fn write_shutdown_origin(mut writer: impl Write, origin: ShutdownOrigin) {
    // Diagnostic output failure must never alter shutdown or recovery behavior.
    let _ = writeln!(
        writer,
        "[runtime-shutdown] first-request origin={}",
        origin.label()
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt;

    #[derive(Debug)]
    struct Wrapped {
        message: &'static str,
        cause: Option<Box<dyn Error>>,
    }
    impl fmt::Display for Wrapped {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(self.message)
        }
    }
    impl Error for Wrapped {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            self.cause.as_deref()
        }
    }

    #[test]
    fn nested_io_retains_kind_and_os_code_without_wrapper_text() {
        let io = io::Error::from_raw_os_error(5);
        let kind = format!("{:?}", io.kind());
        let error = Wrapped {
            message: "SECRET/path/token",
            cause: Some(Box::new(Wrapped {
                message: "private request",
                cause: Some(Box::new(io)),
            })),
        };
        let result = controller_error(&error, ControllerOperation::Drive);
        assert_eq!(
            result,
            format!("service controller I/O failure [operation=drive kind={kind} os_code=5]")
        );
        assert!(result.len() < 192);
    }

    #[test]
    fn custom_io_text_is_never_emitted() {
        let error = io::Error::new(
            io::ErrorKind::PermissionDenied,
            "C:/secret/token request environment",
        );
        assert_eq!(controller_error(&error, ControllerOperation::ShutdownDrain),
            "service controller I/O failure [operation=shutdown-drain kind=PermissionDenied os_code=none]");
    }

    #[test]
    fn non_io_errors_keep_their_existing_message() {
        let error = Wrapped {
            message: "unchanged invariant failure",
            cause: None,
        };
        assert_eq!(
            controller_error(&error, ControllerOperation::Acquire),
            error.to_string()
        );
    }

    #[test]
    fn all_static_operations_fit_the_message_bound() {
        let error = io::Error::from_raw_os_error(i32::MIN);
        for operation in [
            ControllerOperation::Acquire,
            ControllerOperation::WorkerDependencyAcquire,
            ControllerOperation::Release,
            ControllerOperation::WorkerDependencyRelease,
            ControllerOperation::Retry,
            ControllerOperation::Drive,
            ControllerOperation::ShutdownDrain,
            ControllerOperation::ThreadCleanup,
        ] {
            assert!(controller_error(&error, operation).len() < 192);
        }
    }

    #[test]
    fn first_origin_wins_in_both_external_and_internal_orders() {
        for first in [
            ShutdownOrigin::Internal,
            ShutdownOrigin::ParentChannel,
            ShutdownOrigin::AuthenticatedLifecycle,
        ] {
            let mut record = FirstShutdownOrigin::default();
            record.record(first);
            for next in [
                ShutdownOrigin::Internal,
                ShutdownOrigin::ParentChannel,
                ShutdownOrigin::AuthenticatedLifecycle,
            ] {
                record.record(next);
                assert_eq!(record.get(), Some(first));
            }
        }
    }

    #[test]
    fn shutdown_log_has_only_the_static_origin() {
        let mut output = Vec::new();
        write_shutdown_origin(&mut output, ShutdownOrigin::AuthenticatedLifecycle);
        assert_eq!(
            output,
            b"[runtime-shutdown] first-request origin=authenticated-lifecycle\n"
        );
    }

    #[test]
    fn diagnostic_write_failure_is_ignored() {
        struct Failing;
        impl Write for Failing {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::from(io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        write_shutdown_origin(Failing, ShutdownOrigin::Internal);
    }
}
