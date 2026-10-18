use super::*;
use crate::support::Scratch;

#[test]
fn the_token_is_read_trimmed_and_an_empty_one_is_none() {
    let scratch = Scratch::new();
    let file = scratch.0.join("token");

    std::fs::write(&file, "  ghp_secret\n").expect("token");
    assert_eq!(
        token_from(Some(file.clone())).as_deref(),
        Some("ghp_secret")
    );

    std::fs::write(&file, "\n").expect("token");
    assert_eq!(token_from(Some(file)), None);
    assert_eq!(token_from(Some(scratch.0.join("missing"))), None);
    assert_eq!(token_from(None), None);
}

#[test]
fn a_variable_left_empty_takes_the_default() {
    assert_eq!(
        variable("NAS_WIZARD_TEST_UNSET_VARIABLE", "fallback"),
        "fallback"
    );
}

#[test]
fn reads_its_settings_from_the_environment_or_their_defaults() {
    let config = Config::from_env();
    assert!(config.github_api.starts_with("http"));
    assert!(!config.wizard_repository.is_empty());
    assert!(config
        .post_script
        .ends_with("packages/post_wizard/install.sh"));
}

#[test]
fn finds_the_script_after_the_wizard_in_the_release_package() {
    assert_eq!(
        packaged_script(Path::new("/opt/nas/wizard/bin/nas-wizard")),
        PathBuf::from("/opt/nas/packages/post_wizard/install.sh")
    );
    assert_eq!(
        packaged_script(Path::new("nas-wizard")),
        PathBuf::from("/packages/post_wizard/install.sh")
    );
}
