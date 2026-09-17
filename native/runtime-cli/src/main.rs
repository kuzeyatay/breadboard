mod bootstrap;
mod control;
mod durable_job_control;
mod host;
mod service_engine;
mod shutdown;
mod streaming_body;
mod worker_dispatcher;

fn main() {
    if std::env::args_os().count() != 1 {
        eprintln!("breadboard-runtime: command-line arguments are not accepted");
        std::process::exit(64);
    }

    if let Err(error) = host::run_authoritative_host() {
        eprintln!("breadboard-runtime: {error}");
        // The top-level message names the subsystem; the chain beneath it is
        // the only record of what actually went wrong before the generation
        // exits. Every layer already keeps its text bounded and non-secret.
        let mut source = std::error::Error::source(&error);
        let mut depth = 1;
        while let Some(cause) = source {
            eprintln!("breadboard-runtime:   caused by [{depth}]: {cause}");
            source = cause.source();
            depth += 1;
        }
        std::process::exit(error.exit_code());
    }
}
