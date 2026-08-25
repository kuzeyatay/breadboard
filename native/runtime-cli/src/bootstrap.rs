use crate::shutdown::ShutdownCoordinator;
use breadboard_runtime_protocol::{
    parse_runtime_bootstrap_message, ProtocolError, RuntimeBootstrapMessage,
    MAX_PROTOCOL_LINE_BYTES,
};
use std::io::{self, BufRead, Read};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use thiserror::Error;

const BOOTSTRAP_DEADLINE: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub(crate) enum BootstrapError {
    #[error("bootstrap stdin closed before one complete line was received")]
    UnexpectedEof,
    #[error("bootstrap line exceeds the protocol byte limit")]
    Oversized,
    #[error("bootstrap line is not valid UTF-8")]
    InvalidUtf8,
    #[error("bootstrap protocol is invalid: {0}")]
    InvalidProtocol(#[from] ProtocolError),
    #[error("reading private bootstrap stdin failed: {0}")]
    Io(#[from] io::Error),
    #[error("starting the parent-disconnect watcher failed: {0}")]
    Watcher(io::Error),
    #[error("the private bootstrap reader stopped unexpectedly")]
    ReaderStopped,
    #[error("the private bootstrap record was not received before the startup deadline")]
    Deadline,
}

/// Reads one and only one newline-terminated bootstrap record without allowing
/// an unbounded `read_line` allocation. UTF-8 is checked before JSON parsing.
pub(crate) fn read_bootstrap<R: BufRead>(
    reader: &mut R,
) -> Result<RuntimeBootstrapMessage, BootstrapError> {
    let mut line = Vec::with_capacity(1024);
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Err(BootstrapError::UnexpectedEof);
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        let content = if newline.is_some() { take - 1 } else { take };
        if line.len().saturating_add(content) > MAX_PROTOCOL_LINE_BYTES {
            return Err(BootstrapError::Oversized);
        }
        line.extend_from_slice(&available[..content]);
        reader.consume(take);
        if newline.is_some() {
            break;
        }
    }

    if line.last() == Some(&b'\r') {
        line.pop();
    }
    std::str::from_utf8(&line).map_err(|_| BootstrapError::InvalidUtf8)?;
    parse_runtime_bootstrap_message(&line).map_err(BootstrapError::from)
}

/// Owns one buffered stdin reader from bootstrap through parent disconnect.
/// Keeping the same reader matters: recreating it after the handshake could
/// discard bytes it had already buffered beyond the first newline.
pub(crate) fn start_parent_stdin_reader(
    shutdown: Arc<ShutdownCoordinator>,
) -> Result<
    (
        mpsc::Receiver<Result<RuntimeBootstrapMessage, BootstrapError>>,
        JoinHandle<()>,
    ),
    BootstrapError,
> {
    let (bootstrap_sender, bootstrap_receiver) = mpsc::sync_channel(1);
    let handle = thread::Builder::new()
        .name("runtime-parent-watch".into())
        .spawn(move || {
            let stdin = io::stdin();
            let mut input = io::BufReader::new(stdin.lock());
            let bootstrap = read_bootstrap(&mut input);
            let valid = bootstrap.is_ok();
            if bootstrap_sender.send(bootstrap).is_err() || !valid {
                return;
            }
            let mut unexpected = [0_u8; 1];
            let _ = input.read(&mut unexpected);
            shutdown.request_shutdown();
        })
        .map_err(BootstrapError::Watcher)?;
    Ok((bootstrap_receiver, handle))
}

pub(crate) fn receive_bootstrap(
    receiver: mpsc::Receiver<Result<RuntimeBootstrapMessage, BootstrapError>>,
) -> Result<RuntimeBootstrapMessage, BootstrapError> {
    match receiver.recv_timeout(BOOTSTRAP_DEADLINE) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(BootstrapError::Deadline),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(BootstrapError::ReaderStopped),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn valid_bootstrap() -> Vec<u8> {
        br#"{"type":"runtime-bootstrap","protocolVersion":1,"mode":"lean","appRoot":"C:\\Breadboard\\app","runtimeRoot":"C:\\Breadboard\\runtime","dataRoot":"C:\\Breadboard\\data","configRoot":"C:\\Breadboard\\config"}
"#
        .to_vec()
    }

    #[test]
    fn accepts_exactly_one_bounded_bootstrap_line() {
        let mut input = Cursor::new(valid_bootstrap());
        assert!(read_bootstrap(&mut input).is_ok());
    }

    #[test]
    fn rejects_eof_without_a_complete_line() {
        let mut bytes = valid_bootstrap();
        bytes.pop();
        let mut input = Cursor::new(bytes);
        assert!(matches!(
            read_bootstrap(&mut input),
            Err(BootstrapError::UnexpectedEof)
        ));
    }

    #[test]
    fn rejects_invalid_utf8_before_json() {
        let mut input = Cursor::new(vec![0xff, b'\n']);
        assert!(matches!(
            read_bootstrap(&mut input),
            Err(BootstrapError::InvalidUtf8)
        ));
    }

    #[test]
    fn rejects_an_oversized_line_without_waiting_for_eof() {
        let mut bytes = vec![b'a'; MAX_PROTOCOL_LINE_BYTES + 1];
        bytes.push(b'\n');
        let mut input = Cursor::new(bytes);
        assert!(matches!(
            read_bootstrap(&mut input),
            Err(BootstrapError::Oversized)
        ));
    }
}
