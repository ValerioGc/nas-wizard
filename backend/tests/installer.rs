use super::*;
use crate::{
    state::{Language, Phase, StepState, Theme},
    support::{config, Scratch},
};

fn configuration(username: &str, token: Option<&str>) -> Configuration {
    Configuration {
        username: username.to_owned(),
        password: "long enough".to_owned(),
        language: Language::It,
        theme: Theme::Dark,
        nas_name: "attic".to_owned(),
        token: token.map(str::to_owned),
    }
}

/// A `nas-wizard` that answers the script as the real one would, without a forge: `fetch` unpacks
/// nothing and says 9.9.9, writing down the token it was handed; `fetch ui` fails while a file
/// called `fail` lies beside it.
fn wizard(scratch: &Scratch) -> PathBuf {
    let path = scratch.0.join("nas-wizard");
    std::fs::write(
        &path,
        r#"#!/usr/bin/env bash
here=$(dirname "$0")
case $1 in
  fetch)
    if [[ $2 == ui && -f $here/fail ]]; then echo 'owner/ui refused the token' >&2; exit 1; fi
    mkdir -p "$4"
    cat "$WIZARD_TOKEN_PATH" >"$here/token-$2"
    echo 9.9.9
    ;;
  complete) echo ;;
esac
"#,
    )
    .expect("wizard");
    std::process::Command::new("chmod")
        .args(["+x"])
        .arg(&path)
        .status()
        .expect("chmod");
    path
}

fn state(scratch: &Scratch) -> AppState {
    let mut settings = config("http://127.0.0.1:1", &scratch.0.join("work"));
    settings.binary = wizard(scratch);
    AppState::new(settings)
}

async fn finished(state: &AppState) -> Snapshot {
    for _ in 0..500 {
        let snapshot = state.current().await;
        if snapshot.phase != Phase::Installing {
            return snapshot;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the installation did not finish");
}

#[test]
fn the_script_announces_its_steps_on_its_output() {
    assert_eq!(signal("@@step install_ui"), Signal::Step("install_ui"));
    assert_eq!(
        signal("@@detail version 1.2.3\n"),
        Signal::Detail("version 1.2.3")
    );
    assert_eq!(signal("@@done install_ui"), Signal::Done("install_ui"));
    assert_eq!(signal("== Binary"), Signal::Output("== Binary"));
}

#[test]
fn a_failure_shows_the_last_lines_of_its_output() {
    let output: VecDeque<String> = ["", "first", "second"].map(str::to_owned).into();
    assert_eq!(tail(&output), "first\nsecond");
}

#[test]
fn neither_the_token_nor_the_password_goes_on_the_command_line() {
    let scratch = Scratch::new();
    let request = Request {
        username: "Owner".to_owned(),
        user: "owner".to_owned(),
        password: "long enough".to_owned(),
        language: Language::En,
        theme: Theme::Light,
        nas_name: "attic".to_owned(),
        token: Some("ghp_secret".to_owned()),
    };
    let arguments = arguments(
        &config("http://127.0.0.1:1", &scratch.0),
        "install_ui",
        &request,
    );
    let line = arguments.join(" ");

    assert!(line.contains("--user owner --language en --theme light --name attic"));
    assert!(!arguments
        .iter()
        .any(|value| ["--mtls", "--device", "--icon"].contains(&value.as_str())));
    assert!(line.contains("--from install_ui"));
    assert!(line.ends_with("--simulate"));
    assert!(!line.contains("ghp_secret"));
    assert!(!line.contains("long enough"));
}

#[tokio::test]
async fn the_script_after_the_wizard_runs_every_step_and_the_wizard_follows_it() {
    let scratch = Scratch::new();
    let state = state(&scratch);

    let started = start(&state, configuration("Owner.Home", Some("ghp_x")))
        .await
        .expect("started");
    assert_eq!(started.phase, Phase::Installing);
    let ready = finished(&state).await;

    // Everything but the handover, which waits for the HTTPS authority to be offered.
    assert_eq!(ready.phase, Phase::Ready);
    let (last, before) = ready.steps.split_last().expect("steps");
    assert!(before.iter().all(|step| step.state == StepState::Done));
    assert_eq!(last.id, "handover");
    assert_eq!(last.state, StepState::Pending);
    assert_eq!(ready.steps[0].detail, "version 9.9.9");
    assert_eq!(ready.steps[1].detail, "version 9.9.9");
    assert_eq!(ready.steps[3].detail, "simulated");
    assert_eq!(ready.steps[6].id, "certificate");

    let offered = offer(&state).await.expect("an offer");
    assert_eq!(offered.ca_pem, None, "a simulation installs no gateway");
    let done = finish(&state).await.expect("finished");
    assert_eq!(done.phase, Phase::Done);
    assert_eq!(done.steps[8].detail, "simulated");
    assert!(finish(&state).await.is_err(), "only once");
    assert!(offer(&state).await.is_err());
    assert_eq!(
        std::fs::read_to_string(scratch.0.join("token-gateway")).expect("token"),
        "ghp_x"
    );
    let wizard = state.wizard.lock().await;
    let request = wizard.request.as_ref().expect("request");
    assert_eq!(request.user, "owner_home");
    assert!(
        request.password.is_empty(),
        "the password goes once the account is there"
    );
}

#[tokio::test]
async fn a_step_that_fails_stops_the_installation_until_a_retry_from_it() {
    let scratch = Scratch::new();
    let state = state(&scratch);
    std::fs::write(scratch.0.join("fail"), "").expect("fail");

    start(&state, configuration("owner", None))
        .await
        .expect("started");
    let failed = finished(&state).await;

    assert_eq!(failed.phase, Phase::Failed);
    assert_eq!(failed.steps[0].state, StepState::Done);
    assert_eq!(failed.steps[1].state, StepState::Failed);
    assert!(failed.steps[1]
        .detail
        .contains("owner/ui refused the token"));
    assert!(failed.steps[2..]
        .iter()
        .all(|step| step.state == StepState::Pending));
    assert_eq!(
        start(&state, configuration("owner", None))
            .await
            .expect_err("busy")
            .0,
        axum::http::StatusCode::CONFLICT
    );

    std::fs::remove_file(scratch.0.join("fail")).expect("fail");
    std::fs::remove_file(scratch.0.join("token-gateway")).expect("token");
    assert_eq!(retry(&state).await.expect("retry").phase, Phase::Installing);
    let done = finished(&state).await;

    assert_eq!(done.phase, Phase::Ready);
    assert!(
        !scratch.0.join("token-gateway").exists(),
        "the retry starts from the step that failed"
    );
}

#[tokio::test]
async fn nothing_starts_with_a_name_or_a_token_that_would_be_refused() {
    let scratch = Scratch::new();
    let state = state(&scratch);

    assert!(start(&state, configuration("root", None)).await.is_err());
    assert!(start(&state, configuration("owner", Some("two words")))
        .await
        .is_err());
    assert_eq!(state.current().await.phase, Phase::Collecting);
    assert_eq!(
        retry(&state).await.expect_err("nothing failed").0,
        axum::http::StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn fetch_knows_the_gateway_and_the_launcher_only() {
    let scratch = Scratch::new();
    let settings = config("http://127.0.0.1:1", &scratch.0);

    assert!(wanted(&settings, "gateway").is_some());
    assert!(wanted(&settings, "ui").is_some());
    assert!(fetch(&settings, "wizard", &scratch.0).await.is_err());
}

#[tokio::test]
async fn the_offer_holds_only_the_https_authority_and_removes_the_work_file() {
    let scratch = Scratch::new();
    let state = state(&scratch);
    let work = scratch.0.join("work");
    std::fs::create_dir_all(&work).expect("work");
    let pem = "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n";
    std::fs::write(work.join("ca.pem"), pem).expect("ca");

    let offer = offer_of(&state.config).await;
    assert_eq!(
        serde_json::to_value(&offer).expect("offer"),
        serde_json::json!({"caPem": pem})
    );
    assert!(!work.join("ca.pem").exists());
    assert!(offer_of(&state.config).await.ca_pem.is_none());

    std::fs::write(work.join("ca.pem"), "not a certificate").expect("invalid ca");
    assert!(offer_of(&state.config).await.ca_pem.is_none());
    assert!(!work.join("ca.pem").exists());
}

/// A launcher on the loopback that is up and answers the end of the configuration with `status`.
async fn launcher(status: u16) -> String {
    use axum::{
        http::StatusCode,
        routing::{get, post},
        Router,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address").to_string();
    let router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route(
            "/api/setup/complete",
            post(move || async move { (StatusCode::from_u16(status).expect("status"), "refused") }),
        );
    tokio::spawn(async move { axum::serve(listener, router).await.expect("launcher") });
    address
}

#[tokio::test]
async fn ends_the_configuration_on_the_launcher_once_it_answers() {
    let scratch = Scratch::new();
    let mut settings = config("http://127.0.0.1:1", &scratch.0);

    settings.launcher = launcher(200).await;
    let done = complete(&settings, Language::En, Theme::Light, "attic").await;
    assert_eq!(done, Ok(String::new()));

    settings.launcher = launcher(409).await;
    let again = complete(&settings, Language::It, Theme::System, "attic").await;
    assert_eq!(again, Ok("already configured".to_owned()));

    settings.launcher = launcher(500).await;
    let refused = complete(&settings, Language::It, Theme::Dark, "attic").await;
    assert!(refused.unwrap_err().contains("500: refused"));
}

#[tokio::test]
async fn fetches_the_gateway_and_cleans_up_what_it_downloaded() {
    let forge = crate::support::forge(vec![crate::support::Package::new(
        "owner/gateway",
        "1.2.3",
        gateway_asset("1.2.3"),
    )])
    .await;
    let scratch = Scratch::new();
    let settings = config(&forge.api, &scratch.0);

    let version = fetch(&settings, "gateway", &scratch.0.join("gateway")).await;
    assert_eq!(version, Ok("1.2.3".to_owned()));
    assert!(scratch.0.join("gateway/packages/README.md").is_file());
    assert!(fetch(&settings, "printer", &scratch.0.join("printer"))
        .await
        .unwrap_err()
        .contains("nothing to fetch"));
    assert_eq!(ui_asset("1.2.3"), "nas-os-1.2.3-linux-x64.tar.gz");

    clean(&settings).await;
    assert!(!scratch.0.join("gateway").exists());
}
