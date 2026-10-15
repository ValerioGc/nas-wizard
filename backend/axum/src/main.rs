//! `nas-wizard` serves the wizard. The other commands are for the scripts around it:
//!
//! - `self-update --into <dir>`, for the entry script: a newer wizard, unpacked in a directory of
//!   its own printed on the output (0), this one is the latest (3), or it could not tell (1);
//! - `fetch <gateway|ui> --into <dir>`, for the script after the wizard: the latest release,
//!   checked and unpacked, with the token in `WIZARD_TOKEN_PATH`; its version on the output;
//! - `complete --language <it|en> --theme <system|light|dark> --name <name>`, for the same
//!   script: the end of the first configuration on the launcher; a detail for the step on the
//!   output;
//! - `disks <file>`, for the same script: the empty data disks chosen in the page, prepared by the
//!   root code of the launcher just installed; a detail for each disk on the output;
//! - `screen`, for `nas-os-screen.service`: the interface on a monitor connected to the NAS, while
//!   one is (see `screen`).

use nas_wizard_axum::{
    config::Config,
    discovery, disks,
    http::routes,
    installer, screen, self_update,
    state::{AppState, Language, Theme},
};
use std::{
    future::Future,
    net::{IpAddr, Ipv4Addr},
    path::PathBuf,
    process::ExitCode,
};
use tokio::signal::unix::{signal, SignalKind};
use tokio::{net::TcpListener, sync::watch};

async fn stopped() {
    let terminate = async {
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                terminate.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate => {}
    }
}

/// Where the wizard listens: `WIZARD_ADDRESS` and `WIZARD_PORT`, the loopback and 3006 without them.
fn listen_on(address: Option<String>, port: Option<String>) -> (IpAddr, u16) {
    (
        address
            .and_then(|value| value.parse().ok())
            .unwrap_or(IpAddr::from([127, 0, 0, 1])),
        port.and_then(|value| value.parse().ok()).unwrap_or(3006),
    )
}

/// The port of the monitor connected to the NAS, on the loopback (`WIZARD_SCREEN_PORT`): the
/// base firewall lets only the browser of the screen reach it. None without it.
fn screen_port(port: Option<String>) -> Option<u16> {
    port.and_then(|value| value.parse().ok())
}

/// Serves until `stopped` completes, or until the installation is done and the gateway can take
/// the port, and the one of the screen with it. A gateway that does not answer gives the ports
/// back to the wizard, which says so.
async fn serve<Stop, Stopped>(
    state: AppState,
    (address, port): (IpAddr, u16),
    screen: Option<u16>,
    stopped: Stop,
) -> Result<(), Box<dyn std::error::Error>>
where
    Stop: Fn() -> Stopped,
    Stopped: Future<Output = ()> + Send + 'static,
{
    loop {
        let listener = TcpListener::bind((address, port)).await?;
        println!("wizard listening on http://{address}:{port}");
        let screen_listener = match screen {
            Some(screen) => Some(TcpListener::bind((Ipv4Addr::LOCALHOST, screen)).await?),
            None => None,
        };
        let discovery = discovery::start(false, port, false).await;
        if state.config.real {
            discovery::firewall(true).await;
        }
        let handover = state.handover.clone();
        let stopped = stopped();
        let (stop, stopping) = watch::channel(false);
        tokio::spawn(async move {
            tokio::select! {
                () = stopped => {}
                () = handover.notified() => {
                    // Long enough for the page to read that everything is done.
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            }
            let _ = stop.send(true);
        });
        let until = |mut stopping: watch::Receiver<bool>| async move {
            let _ = stopping.wait_for(|stop| *stop).await;
        };
        let router = routes::router(state.clone());
        let page =
            axum::serve(listener, router.clone()).with_graceful_shutdown(until(stopping.clone()));
        match screen_listener {
            Some(screen_listener) => {
                let monitor =
                    axum::serve(screen_listener, router).with_graceful_shutdown(until(stopping));
                tokio::try_join!(async { page.await }, async { monitor.await })?;
            }
            None => page.await?,
        }

        // Release UDP before starting the gateway, which takes over the same discovery port, and
        // close it: from now on the launcher opens it, when the security center says so.
        discovery::stop(discovery).await;
        if state.config.real {
            discovery::firewall(false).await;
        }
        if !state.handing_over() {
            return Ok(());
        }
        println!("handing port {port} over to the gateway");
        match installer::hand_over(&state.config).await {
            Ok(()) => {
                installer::clean(&state.config).await;
                println!("the gateway answers: the wizard is done");
                return Ok(());
            }
            Err(reason) => {
                eprintln!("handover failed: {reason}");
                state
                    .handing_over
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                let mut wizard = state.wizard.lock().await;
                wizard.mark(
                    "handover",
                    nas_wizard_axum::state::StepState::Failed,
                    reason,
                );
                wizard.phase = nas_wizard_axum::state::Phase::Failed;
            }
        }
    }
}

async fn self_update(config: &Config, into: PathBuf) -> ExitCode {
    match self_update::run(config, &into).await {
        Ok(Some(directory)) => {
            println!("{}", directory.display());
            ExitCode::SUCCESS
        }
        Ok(None) => {
            eprintln!("nas-wizard {} is the latest", self_update::VERSION);
            ExitCode::from(3)
        }
        Err(reason) => {
            eprintln!("cannot look for a newer wizard: {reason}");
            ExitCode::FAILURE
        }
    }
}

async fn fetch(config: &Config, which: &str, into: PathBuf) -> ExitCode {
    match installer::fetch(config, which, &into).await {
        Ok(version) => {
            println!("{version}");
            ExitCode::SUCCESS
        }
        Err(reason) => {
            eprintln!("{reason}");
            ExitCode::FAILURE
        }
    }
}

async fn complete(config: &Config, language: &str, theme: &str, name: &str) -> ExitCode {
    let language = match language {
        "it" => Language::It,
        "en" => Language::En,
        other => {
            eprintln!("unknown language: {other}");
            return ExitCode::from(2);
        }
    };
    let theme = match theme {
        "system" => Theme::System,
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        other => {
            eprintln!("unknown theme: {other}");
            return ExitCode::from(2);
        }
    };
    if !nas_wizard_axum::account::is_nas_name(name) {
        eprintln!("not a name for the NAS: {name}");
        return ExitCode::from(2);
    }
    match installer::complete(config, language, theme, name).await {
        Ok(detail) => {
            println!("{detail}");
            ExitCode::SUCCESS
        }
        Err(reason) => {
            eprintln!("{reason}");
            ExitCode::FAILURE
        }
    }
}

/// What a command of the scripts answers, or `None` without one: then the wizard serves.
async fn command(arguments: &[String], config: &Config) -> Option<ExitCode> {
    let code = match arguments {
        [] => return None,
        [command, flag, into] if command == "self-update" && flag == "--into" => {
            self_update(config, PathBuf::from(into)).await
        }
        [command, which, flag, into] if command == "fetch" && flag == "--into" => {
            fetch(config, which, PathBuf::from(into)).await
        }
        [command, language_flag, language, theme_flag, theme, name_flag, name]
            if command == "complete"
                && language_flag == "--language"
                && theme_flag == "--theme"
                && name_flag == "--name" =>
        {
            complete(config, language, theme, name).await
        }
        [command, file] if command == "disks" => {
            match disks::prepare(
                &PathBuf::from(file),
                &config.launcher_binary,
                &config.state_dir,
            )
            .await
            {
                Ok(done) => {
                    for device in done {
                        println!("@@detail {device} ready");
                    }
                    ExitCode::SUCCESS
                }
                Err(reason) => {
                    eprintln!("{reason}");
                    ExitCode::FAILURE
                }
            }
        }
        [command] if command == "screen" => {
            // It watches the monitor for as long as the machine runs.
            let _ = tokio::task::spawn_blocking(|| screen::run(screen::Paths::system())).await;
            ExitCode::FAILURE
        }
        [flag] if flag == "--version" => {
            println!("{}", self_update::VERSION);
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!(
                "usage: nas-wizard [self-update --into <dir> | fetch <gateway|ui> --into <dir> \
                 | complete --language <it|en> --theme <system|light|dark> --name <name> \
                 | disks <file> | screen | --version]"
            );
            ExitCode::from(2)
        }
    };
    Some(code)
}

#[tokio::main]
async fn main() -> Result<ExitCode, Box<dyn std::error::Error>> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let config = Config::from_env();
    if let Some(code) = command(&arguments, &config).await {
        return Ok(code);
    }
    let address = listen_on(
        std::env::var("WIZARD_ADDRESS").ok(),
        std::env::var("WIZARD_PORT").ok(),
    );
    let screen = screen_port(std::env::var("WIZARD_SCREEN_PORT").ok());
    serve(AppState::new(config), address, screen, stopped).await?;
    Ok(ExitCode::SUCCESS)
}

#[cfg(test)]
#[path = "../../tests/main.rs"]
mod tests;
