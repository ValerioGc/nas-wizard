//! The installation once the choices are made. The work is `packages/post_wizard/install.sh`, run
//! as root: it downloads gateway and launcher with the token, installs them, configures the
//! launcher, creates the account and ends the first configuration. The wizard hands it the choices
//! (the token and the account on its input, never on its command line), follows the steps it
//! announces on its output and shows them. Then the handover, which is the server's: see `main`.
//!
//! The script calls this program back for what Rust already does well: `nas-wizard fetch`
//! downloads and checks a release, `nas-wizard complete` waits for the launcher and ends the
//! configuration on it.
//!
//! Without `WIZARD_MODE=real` the script runs with `--simulate`: the releases are still downloaded
//! and checked, into the state directory, but nothing is installed.

use crate::{
    account,
    config::Config,
    forge::{self, Wanted},
    http::error::ApiFailure,
    state::{AppState, Configuration, Language, Offer, Phase, Request, Snapshot, StepState, Theme},
};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
    process::Command,
};

const SCRIPT_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// What the certificate step leaves in the state directory, read once and removed.
const CA_FILE: &str = "ca.pem";
const LAUNCHER_TRIES: u32 = 60;
const SHOWN_LINES: usize = 12;

pub fn gateway_asset(version: &str) -> String {
    format!("nas-gateway-{version}-linux-x64.tar.gz")
}

pub fn ui_asset(version: &str) -> String {
    format!("nas-os-{version}-linux-x64.tar.gz")
}

/// What `nas-wizard fetch` downloads: the gateway or the launcher.
pub fn wanted<'a>(config: &'a Config, which: &str) -> Option<Wanted<'a>> {
    match which {
        "gateway" => Some(Wanted {
            repository: &config.gateway_repository,
            asset: gateway_asset,
        }),
        "ui" => Some(Wanted {
            repository: &config.ui_repository,
            asset: ui_asset,
        }),
        _ => None,
    }
}

/// Checks the choices and starts the installation.
pub async fn start(state: &AppState, input: Configuration) -> Result<Snapshot, ApiFailure> {
    let token = match input.token.as_deref().map(str::trim) {
        Some(token) if !token.is_empty() => {
            if !account::is_token(token) {
                return Err(ApiFailure::bad("that does not look like a token"));
            }
            Some(token.to_owned())
        }
        _ => None,
    };
    let nas_name = input.nas_name.trim().to_owned();
    if !account::is_nas_name(&nas_name) {
        return Err(ApiFailure::bad(
            "the name of the NAS takes letters, digits and dashes, up to 63",
        ));
    }
    let user = account::check(&input.username, &input.password).await?;

    let mut wizard = state.wizard.lock().await;
    if wizard.phase != Phase::Collecting {
        return Err(ApiFailure::conflict(
            "the wizard is installing already, or it is done",
        ));
    }
    wizard.request = Some(Request {
        username: input.username.trim().to_owned(),
        user,
        password: input.password,
        language: input.language,
        theme: input.theme,
        nas_name,
        token,
    });
    wizard.phase = Phase::Installing;
    tokio::spawn(run(state.clone()));
    Ok(state.snapshot(&wizard))
}

/// Starts again from the step that failed.
pub async fn retry(state: &AppState) -> Result<Snapshot, ApiFailure> {
    let mut wizard = state.wizard.lock().await;
    if wizard.phase != Phase::Failed {
        return Err(ApiFailure::conflict(
            "nothing failed: there is nothing to retry",
        ));
    }
    for step in wizard
        .steps
        .iter_mut()
        .filter(|step| step.state == StepState::Failed)
    {
        step.state = StepState::Pending;
        step.detail.clear();
    }
    wizard.phase = Phase::Installing;
    tokio::spawn(run(state.clone()));
    Ok(state.snapshot(&wizard))
}

/// A line of the output of the script: a step that starts, a detail of the running one, a step
/// that ends, or anything else, which is output.
#[derive(Debug, PartialEq, Eq)]
pub enum Signal<'a> {
    Step(&'a str),
    Detail(&'a str),
    Done(&'a str),
    Output(&'a str),
}

pub fn signal(line: &str) -> Signal<'_> {
    let line = line.trim_end();
    if let Some(id) = line.strip_prefix("@@step ") {
        Signal::Step(id.trim())
    } else if let Some(detail) = line.strip_prefix("@@detail ") {
        Signal::Detail(detail.trim())
    } else if let Some(id) = line.strip_prefix("@@done ") {
        Signal::Done(id.trim())
    } else {
        Signal::Output(line)
    }
}

/// The last lines of an output, which say why a script stopped.
pub fn tail(output: &VecDeque<String>) -> String {
    output
        .iter()
        .filter(|line| !line.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

/// Runs what is left: the script from the first step not done yet, then the handover.
pub async fn run(state: AppState) {
    let (from, request) = {
        let mut wizard = state.wizard.lock().await;
        let Some(from) = wizard
            .steps
            .iter()
            .find(|step| step.state != StepState::Done)
            .map(|step| step.id)
        else {
            wizard.phase = Phase::Done;
            return;
        };
        let Some(request) = wizard.request.clone() else {
            wizard.phase = Phase::Failed;
            return;
        };
        (from, request)
    };

    if from != "handover" {
        if let Err(reason) = post_wizard(&state, from, &request).await {
            let mut wizard = state.wizard.lock().await;
            let running = wizard
                .steps
                .iter()
                .find(|step| step.state == StepState::Running)
                .or_else(|| {
                    wizard
                        .steps
                        .iter()
                        .find(|step| step.state != StepState::Done)
                })
                .map(|step| step.id);
            if let Some(id) = running {
                eprintln!("step {id}: failed: {reason}");
                wizard.mark(id, StepState::Failed, reason);
            }
            wizard.phase = Phase::Failed;
            return;
        }
    }

    let offer = offer_of(&state.config).await;
    let mut wizard = state.wizard.lock().await;
    if wizard.offer.is_none() {
        wizard.offer = Some(offer);
    }
    wizard.mark("handover", StepState::Pending, "");
    wizard.phase = Phase::Ready;
}

/// What the certificate step left, read and removed: the authority for HTTPS.
/// Nothing in a simulation, which installs no gateway.
async fn offer_of(config: &Config) -> Offer {
    let authority = config.state_dir.join(CA_FILE);
    let ca_pem = tokio::fs::read_to_string(&authority)
        .await
        .ok()
        .filter(|pem| pem.contains("BEGIN CERTIFICATE"));
    let _ = tokio::fs::remove_file(authority).await;
    Offer { ca_pem }
}

/// What the page offers to download, while it waits for the person to take it.
pub async fn offer(state: &AppState) -> Result<Offer, ApiFailure> {
    let wizard = state.wizard.lock().await;
    match (&wizard.offer, wizard.phase) {
        (Some(offer), Phase::Ready) => Ok(offer.clone()),
        _ => Err(ApiFailure::conflict("there is nothing to download yet")),
    }
}

/// The person took the certificates: the wizard hands the ports over to the gateway.
pub async fn finish(state: &AppState) -> Result<Snapshot, ApiFailure> {
    let mut wizard = state.wizard.lock().await;
    if wizard.phase != Phase::Ready {
        return Err(ApiFailure::conflict(
            "the installation is not at its end yet",
        ));
    }
    wizard.phase = Phase::Done;
    if state.config.real {
        wizard.mark("handover", StepState::Running, "");
        state.ask_handover();
    } else {
        wizard.mark("handover", StepState::Done, "simulated");
    }
    Ok(state.snapshot(&wizard))
}

fn arguments(config: &Config, from: &str, request: &Request) -> Vec<String> {
    let language = match request.language {
        Language::It => "it",
        Language::En => "en",
    };
    let theme = match request.theme {
        Theme::System => "system",
        Theme::Light => "light",
        Theme::Dark => "dark",
    };
    let mut arguments = vec![
        config.post_script.to_string_lossy().into_owned(),
        "--user".to_owned(),
        request.user.clone(),
        "--language".to_owned(),
        language.to_owned(),
        "--theme".to_owned(),
        theme.to_owned(),
        "--name".to_owned(),
        request.nas_name.clone(),
        "--wizard".to_owned(),
        config.binary.to_string_lossy().into_owned(),
        "--work".to_owned(),
        config.state_dir.to_string_lossy().into_owned(),
        "--from".to_owned(),
        from.to_owned(),
    ];
    if !config.real {
        arguments.push("--simulate".to_owned());
    }
    arguments
}

/// Follows one stream of the script, step by step, keeping its last lines.
async fn follow(
    stream: impl AsyncRead + Unpin,
    state: AppState,
    output: Arc<Mutex<VecDeque<String>>>,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        match signal(&line) {
            Signal::Step(id) => started(&state, &output, id).await,
            Signal::Detail(detail) => detailed(&state, detail).await,
            Signal::Done(id) => done(&state, id).await,
            Signal::Output(text) => keep(&output, text),
        }
    }
}

/// A step starts: the output kept so far belonged to the one before.
async fn started(state: &AppState, output: &Mutex<VecDeque<String>>, id: &str) {
    println!("step {id}: started");
    if let Ok(mut kept) = output.lock() {
        kept.clear();
    }
    state.wizard.lock().await.mark(id, StepState::Running, "");
}

/// A detail of the running step.
async fn detailed(state: &AppState, detail: &str) {
    let mut wizard = state.wizard.lock().await;
    if let Some(step) = wizard
        .steps
        .iter_mut()
        .find(|step| step.state == StepState::Running)
    {
        step.detail = detail.to_owned();
    }
}

/// A step ends, keeping its detail.
async fn done(state: &AppState, id: &str) {
    println!("step {id}: done");
    let mut wizard = state.wizard.lock().await;
    let detail = wizard
        .steps
        .iter()
        .find(|step| step.id == id)
        .map(|step| step.detail.clone())
        .unwrap_or_default();
    wizard.mark(id, StepState::Done, detail);
    // The account is there: its password has nothing left to do.
    if id != "account" {
        return;
    }
    if let Some(kept) = wizard.request.as_mut() {
        kept.password.clear();
    }
}

/// A line of output, kept among the last `SHOWN_LINES`.
fn keep(output: &Mutex<VecDeque<String>>, text: &str) {
    println!("{text}");
    let Ok(mut kept) = output.lock() else {
        return;
    };
    kept.push_back(text.to_owned());
    if kept.len() > SHOWN_LINES {
        kept.pop_front();
    }
}

/// Runs the script from `from`, with the token, the account name and the password on its input.
async fn post_wizard(state: &AppState, from: &str, request: &Request) -> Result<(), String> {
    let config = &state.config;
    let mut child = Command::new("bash")
        .args(arguments(config, from, request))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("cannot run {}: {error}", config.post_script.display()))?;
    if let Some(mut stdin) = child.stdin.take() {
        let input = format!(
            "{}\n{}\n{}\n",
            request.token.as_deref().unwrap_or_default(),
            request.username,
            request.password
        );
        stdin
            .write_all(input.as_bytes())
            .await
            .map_err(|error| format!("cannot hand the choices to the script: {error}"))?;
    }
    let output = Arc::new(Mutex::new(VecDeque::new()));
    let readers = (
        child
            .stdout
            .take()
            .map(|stream| tokio::spawn(follow(stream, state.clone(), output.clone()))),
        child
            .stderr
            .take()
            .map(|stream| tokio::spawn(follow(stream, state.clone(), output.clone()))),
    );
    let status = tokio::time::timeout(SCRIPT_TIMEOUT, child.wait())
        .await
        .map_err(|_| "the installation did not finish".to_owned())?
        .map_err(|error| format!("the installation stopped: {error}"))?;
    for reader in [readers.0, readers.1].into_iter().flatten() {
        let _ = reader.await;
    }
    let shown = output.lock().map(|kept| tail(&kept)).unwrap_or_default();
    if !status.success() {
        return Err(format!("exit {}\n{shown}", status.code().unwrap_or(-1)));
    }
    let wizard = state.wizard.lock().await;
    match wizard
        .steps
        .iter()
        .find(|step| step.id != "handover" && step.state != StepState::Done)
    {
        Some(step) => Err(format!("the script ended before step {}\n{shown}", step.id)),
        None => Ok(()),
    }
}

/// `nas-wizard fetch`: the latest release of the gateway or of the launcher, checked and unpacked
/// into `into`, with the token the script names in `WIZARD_TOKEN_PATH`. Answers with its version.
pub async fn fetch(config: &Config, which: &str, into: &Path) -> Result<String, String> {
    let wanted = wanted(config, which).ok_or_else(|| format!("nothing to fetch called {which}"))?;
    let token = crate::config::token_from(std::env::var_os("WIZARD_TOKEN_PATH").map(PathBuf::from));
    forge::fetch(config, &wanted, token.as_deref(), into).await
}

/// `nas-wizard complete`: the name of the NAS, language and theme to the launcher, on the loopback,
/// which ends the
/// first configuration. The launcher has just restarted to read the token: it is waited for.
/// Answers with a detail for the step, empty when there is nothing to add.
pub async fn complete(
    config: &Config,
    language: Language,
    theme: Theme,
    nas_name: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("cannot build the HTTP client: {error}"))?;
    let health = format!("http://{}/health", config.launcher);
    let mut answering = false;
    for _ in 0..LAUNCHER_TRIES {
        if client
            .get(&health)
            .send()
            .await
            .is_ok_and(|answer| answer.status().is_success())
        {
            answering = true;
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    if !answering {
        return Err("The launcher does not answer.".to_owned());
    }
    let answer = client
        .post(format!("http://{}/api/setup/complete", config.launcher))
        .json(&serde_json::json!({ "language": language, "theme": theme, "nasName": nas_name }))
        .send()
        .await
        .map_err(|error| format!("cannot reach the launcher: {error}"))?;
    match answer.status().as_u16() {
        200 => Ok(String::new()),
        409 => Ok("already configured".to_owned()),
        status => Err(format!(
            "the launcher answered {status}: {}",
            answer.text().await.unwrap_or_default()
        )),
    }
}

async fn command(program: &str, args: &[&str]) -> Result<(i32, String), String> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| format!("cannot run {program}: {error}"))?;
    Ok((
        output.status.code().unwrap_or(-1),
        format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ),
    ))
}

/// Port 80 to the gateway: started, and asked whether it answers. A gateway that does not is
/// stopped again, so the wizard can take the port back and say so.
pub async fn hand_over(config: &Config) -> Result<(), String> {
    match command("systemctl", &["start", "nas-os-gateway"]).await? {
        (0, _) => {}
        (code, output) => {
            return Err(format!(
                "the gateway did not start (exit {code})\n{}",
                output.trim()
            ))
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("cannot build the HTTP client: {error}"))?;
    let health = format!("http://{}/health", config.gateway);
    for _ in 0..30 {
        if client
            .get(&health)
            .send()
            .await
            .is_ok_and(|answer| answer.status().is_success())
        {
            // The unit of the wizard stays on the machine, for a factory reset to start it again,
            // but a reboot from now on starts the gateway, not the wizard.
            let _ = command("systemctl", &["disable", "nas-wizard.service"]).await;
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let _ = command("systemctl", &["stop", "nas-os-gateway"]).await;
    Err("The gateway does not answer.".to_owned())
}

/// What the wizard downloaded, gone once the NAS runs without it.
pub async fn clean(config: &Config) {
    let _ = tokio::fs::remove_dir_all(config.state_dir.join("gateway")).await;
    let _ = tokio::fs::remove_dir_all(config.state_dir.join("ui")).await;
}

#[cfg(test)]
#[path = "../../tests/installer.rs"]
mod tests;
