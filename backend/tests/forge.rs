use super::*;
use crate::support::{config, forge as fake, Checksum, Package, Scratch};

fn gateway(version: &'static str) -> Package {
    Package::new(
        "owner/gateway",
        version,
        format!("nas-gateway-{version}-linux-x64.tar.gz"),
    )
}

fn wanted() -> Wanted<'static> {
    Wanted {
        repository: "owner/gateway",
        asset: |version| format!("nas-gateway-{version}-linux-x64.tar.gz"),
    }
}

#[test]
fn versions_compare_part_by_part() {
    assert_eq!(version(" v1.2.3 "), "1.2.3");
    assert!(is_newer("0.1.10", "0.1.9"));
    assert!(is_newer("1.0.0", "0.9.9"));
    assert!(!is_newer("0.1.9", "0.1.9"));
    assert!(!is_newer("0.1.8", "0.1.9"));
}

#[tokio::test]
async fn the_latest_package_is_checked_and_unpacked() {
    let mut package = gateway("0.2.0");
    package.files = vec![("packages/gateway_installation/install.sh", "#!/bin/bash\n")];
    let forge = fake(vec![package]).await;
    let scratch = Scratch::new();
    let into = scratch.0.join("gateway");

    let version = fetch(
        &config(&forge.api, &scratch.0),
        &wanted(),
        Some("ghp_x"),
        &into,
    )
    .await
    .expect("fetched");

    assert_eq!(version, "0.2.0");
    assert!(into
        .join("packages/gateway_installation/install.sh")
        .is_file());
    assert!(!scratch
        .0
        .join("nas-gateway-0.2.0-linux-x64.tar.gz")
        .exists());
}

#[tokio::test]
async fn the_token_goes_with_the_request_for_the_release() {
    let forge = fake(vec![gateway("0.2.0")]).await;
    let scratch = Scratch::new();

    fetch(
        &config(&forge.api, &scratch.0),
        &wanted(),
        Some("ghp_x"),
        &scratch.0.join("gateway"),
    )
    .await
    .expect("fetched");

    let seen = forge.seen.lock().expect("lock").clone();
    assert_eq!(seen, [Some("Bearer ghp_x".to_owned())]);
}

#[tokio::test]
async fn a_package_that_does_not_match_its_checksum_is_refused() {
    let mut package = gateway("0.2.0");
    package.checksum = Checksum::Wrong;
    let forge = fake(vec![package]).await;
    let scratch = Scratch::new();
    let into = scratch.0.join("gateway");

    let refused = fetch(&config(&forge.api, &scratch.0), &wanted(), None, &into)
        .await
        .expect_err("refused");

    assert!(refused.contains("checksum"));
    assert!(!into.exists());
}

#[tokio::test]
async fn a_release_without_a_checksum_is_refused() {
    let mut unsigned = gateway("0.2.0");
    unsigned.checksum = Checksum::Missing;
    let forge = fake(vec![unsigned]).await;
    let scratch = Scratch::new();
    let settings = config(&forge.api, &scratch.0);

    let refused = fetch(&settings, &wanted(), None, &scratch.0.join("a"))
        .await
        .expect_err("no checksum");
    assert!(refused.contains("publishes no checksum"));
}

#[tokio::test]
async fn the_forge_says_why_a_release_cannot_be_read() {
    let mut refused = gateway("0.2.0");
    refused.status = 401;
    let mut forbidden = Package::new("owner/ui", "0.2.0", "ui.tar.gz".to_owned());
    forbidden.status = 403;
    let forge = fake(vec![refused, forbidden]).await;
    let scratch = Scratch::new();
    let settings = config(&forge.api, &scratch.0);

    assert_eq!(
        latest(&settings, "owner/gateway", None)
            .await
            .expect_err("401"),
        ForgeFailure::Refused
    );
    assert_eq!(
        latest(&settings, "owner/ui", None).await.expect_err("403"),
        ForgeFailure::Forbidden
    );
    assert_eq!(
        latest(&settings, "owner/none", None)
            .await
            .expect_err("404"),
        ForgeFailure::Missing
    );
    assert!(matches!(
        latest(
            &config("http://127.0.0.1:1", &scratch.0),
            "owner/none",
            None
        )
        .await,
        Err(ForgeFailure::Unreachable(_))
    ));
    assert!(matches!(
        latest(&settings, "owner/bad name", None).await,
        Err(ForgeFailure::Unreachable(_))
    ));
}

#[test]
fn the_token_never_leaves_the_origin_of_the_forge() {
    let settings = config("https://api.github.com", std::path::Path::new("/tmp"));

    assert_eq!(
        for_forge(
            &settings,
            "https://api.github.com/repos/a/b/releases/assets/1",
            Some("t")
        ),
        Some("t")
    );
    assert_eq!(
        for_forge(&settings, "https://objects.example.com/asset", Some("t")),
        None
    );
}
