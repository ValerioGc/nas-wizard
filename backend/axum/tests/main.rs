use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::Notify;

static NEXT: AtomicUsize = AtomicUsize::new(0);

fn offline() -> (Config, PathBuf) {
    let state_dir = std::env::temp_dir().join(format!(
        "nas-wizard-main-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&state_dir).expect("state directory");
    let config = Config {
        real: false,
        github_api: "http://127.0.0.1:1".to_owned(),
        gateway_repository: "owner/gateway".to_owned(),
        ui_repository: "owner/ui".to_owned(),
        wizard_repository: "owner/wizard".to_owned(),
        state_dir: state_dir.clone(),
        ui_dir: None,
        launcher: "127.0.0.1:1".to_owned(),
        gateway: "127.0.0.1:1".to_owned(),
        post_script: PathBuf::from("/nonexistent/install.sh"),
        binary: PathBuf::from("nas-wizard"),
        disks: false,
        encryption: false,
        launcher_binary: PathBuf::from("/nonexistent/nas-os-axum"),
    };
    (config, state_dir)
}

fn arguments(list: &[&str]) -> Vec<String> {
    list.iter().map(|argument| (*argument).to_owned()).collect()
}

#[tokio::test]
async fn answers_the_commands_of_the_scripts_and_serves_without_one() {
    let (config, state_dir) = offline();
    let into = state_dir.join("into").to_string_lossy().into_owned();
    let run = |list: &[&str]| {
        let list = arguments(list);
        let config = config.clone();
        async move { command(&list, &config).await }
    };

    assert_eq!(run(&[]).await, None);
    assert_eq!(run(&["--version"]).await, Some(ExitCode::SUCCESS));
    assert_eq!(run(&["--help"]).await, Some(ExitCode::from(2)));
    for wrong in [
        [
            "complete",
            "--language",
            "fr",
            "--theme",
            "dark",
            "--name",
            "nas",
        ],
        [
            "complete",
            "--language",
            "it",
            "--theme",
            "blue",
            "--name",
            "nas",
        ],
        [
            "complete",
            "--language",
            "it",
            "--theme",
            "dark",
            "--name",
            "-bad-",
        ],
    ] {
        assert_eq!(run(&wrong).await, Some(ExitCode::from(2)), "{wrong:?}");
    }
    for unreachable in [
        vec!["self-update", "--into", into.as_str()],
        vec!["fetch", "gateway", "--into", into.as_str()],
    ] {
        assert_eq!(
            run(&unreachable).await,
            Some(ExitCode::FAILURE),
            "{unreachable:?}"
        );
    }
    std::fs::remove_dir_all(state_dir).expect("remove state directory");
}

#[test]
fn listens_where_it_is_told_or_on_the_loopback() {
    assert_eq!(
        listen_on(Some("0.0.0.0".to_owned()), Some("80".to_owned())),
        (IpAddr::from([0, 0, 0, 0]), 80)
    );
    assert_eq!(
        listen_on(Some("nowhere".to_owned()), Some("port".to_owned())),
        (IpAddr::from([127, 0, 0, 1]), 3006)
    );
    assert_eq!(listen_on(None, None), (IpAddr::from([127, 0, 0, 1]), 3006));
}

#[tokio::test]
async fn serves_until_it_is_stopped() {
    let (config, state_dir) = offline();
    let stop = Arc::new(Notify::new());
    let signal = stop.clone();
    let stopper = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        signal.notify_one();
    });
    let served = serve(
        AppState::new(config),
        (IpAddr::from([127, 0, 0, 1]), 0),
        Some(0),
        || {
            let stop = stop.clone();
            async move { stop.notified().await }
        },
    )
    .await;
    assert!(served.is_ok());
    stopper.await.expect("stopper");
    std::fs::remove_dir_all(state_dir).expect("remove state directory");
}

#[test]
fn listens_for_the_screen_only_where_it_is_told() {
    assert_eq!(screen_port(Some("8081".to_owned())), Some(8081));
    assert_eq!(screen_port(Some("screen".to_owned())), None);
    assert_eq!(screen_port(None), None);
}
