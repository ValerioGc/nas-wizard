use super::*;
use crate::support::{config, forge, Package, Scratch};

#[tokio::test]
async fn downloads_a_newer_wizard_into_a_folder_of_its_own() {
    let forge = forge(vec![Package::new(
        "owner/wizard",
        "99.0.0",
        wizard_asset("99.0.0"),
    )])
    .await;
    let scratch = Scratch::new();

    let directory = run(&config(&forge.api, &scratch.0), &scratch.0)
        .await
        .expect("a newer wizard")
        .expect("its folder");
    assert_eq!(directory, scratch.0.join("99.0.0"));
    assert!(directory.join("packages/README.md").is_file());
    assert_eq!(forge.seen.lock().expect("lock")[0], None);
}

#[tokio::test]
async fn keeps_this_wizard_when_it_is_the_latest_or_none_can_be_read() {
    let latest = forge(vec![Package::new(
        "owner/wizard",
        VERSION,
        wizard_asset(VERSION),
    )])
    .await;
    let scratch = Scratch::new();
    assert_eq!(
        run(&config(&latest.api, &scratch.0), &scratch.0).await,
        Ok(None)
    );

    let missing = forge(Vec::new()).await;
    assert!(run(&config(&missing.api, &scratch.0), &scratch.0)
        .await
        .is_err());
}
