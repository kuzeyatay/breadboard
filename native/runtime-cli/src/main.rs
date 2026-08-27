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
        std::process::exit(error.exit_code());
    }
}
