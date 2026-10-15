//! What the tests of the wizard share: a forge that answers like GitHub on the loopback, with real
//! packages, and a state directory of their own for each test.

use crate::config::Config;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// A directory of its own, gone with the test that made it.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "nas-wizard-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch directory");
        Self(path)
    }
}

impl Default for Scratch {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Checksum {
    Right,
    Wrong,
    Missing,
}

/// A release of a repository: its version, the name of its package, the files inside it and the
/// checksum published beside it. `status` other than 200 is what the latest release answers.
#[derive(Clone)]
pub struct Package {
    pub repository: &'static str,
    pub version: &'static str,
    pub asset: String,
    pub files: Vec<(&'static str, &'static str)>,
    pub checksum: Checksum,
    pub status: u16,
}

impl Package {
    pub fn new(repository: &'static str, version: &'static str, asset: String) -> Self {
        Self {
            repository,
            version,
            asset,
            files: vec![("packages/README.md", "package")],
            checksum: Checksum::Right,
            status: 200,
        }
    }
}

#[derive(Clone, Default)]
struct Served {
    packages: Vec<Package>,
    archives: Vec<(String, Vec<u8>)>,
    seen: Arc<Mutex<Vec<Option<String>>>>,
    base: String,
}

pub struct Forge {
    pub api: String,
    /// The Authorization header of every request, in order
    pub seen: Arc<Mutex<Vec<Option<String>>>>,
    _scratch: Scratch,
}

fn archive(scratch: &Scratch, package: &Package) -> Vec<u8> {
    let root = scratch.0.join(&package.asset).with_extension("d");
    for (path, content) in &package.files {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().expect("parent")).expect("package directory");
        std::fs::write(file, content).expect("package file");
    }
    let target = scratch.0.join(&package.asset);
    let status = std::process::Command::new("tar")
        .arg("-czf")
        .arg(&target)
        .arg("-C")
        .arg(&root)
        .arg(".")
        .status()
        .expect("tar");
    assert!(status.success());
    std::fs::read(target).expect("archive")
}

fn sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn latest(
    State(served): State<Served>,
    Path((owner, name)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    served.seen.lock().expect("lock").push(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned),
    );
    let repository = format!("{owner}/{name}");
    let Some(package) = served
        .packages
        .iter()
        .find(|package| package.repository == repository)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if package.status != 200 {
        return StatusCode::from_u16(package.status)
            .expect("status")
            .into_response();
    }
    let mut assets = vec![serde_json::json!({
        "name": package.asset,
        "url": format!("{}/assets/{}", served.base, package.asset),
    })];
    if package.checksum != Checksum::Missing {
        assets.push(serde_json::json!({
            "name": format!("{}.sha256", package.asset),
            "url": format!("{}/assets/{}.sha256", served.base, package.asset),
        }));
    }
    Json(serde_json::json!({ "tag_name": format!("v{}", package.version), "assets": assets }))
        .into_response()
}

async fn asset(State(served): State<Served>, Path(file): Path<String>) -> Response {
    if let Some((_, bytes)) = served.archives.iter().find(|(name, _)| *name == file) {
        return bytes.clone().into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

pub async fn forge(packages: Vec<Package>) -> Forge {
    let scratch = Scratch::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let base = format!("http://{}", listener.local_addr().expect("address"));
    let mut archives = Vec::new();
    for package in &packages {
        let bytes = archive(&scratch, package);
        let declared = match package.checksum {
            Checksum::Wrong => "0".repeat(64),
            _ => sha256(&bytes),
        };
        archives.push((
            format!("{}.sha256", package.asset),
            format!("{declared}  {}\n", package.asset).into_bytes(),
        ));
        archives.push((package.asset.clone(), bytes));
    }
    let seen = Arc::new(Mutex::new(Vec::new()));
    let served = Served {
        packages,
        archives,
        seen: seen.clone(),
        base: base.clone(),
    };
    let router = Router::new()
        .route("/repos/{owner}/{name}/releases/latest", get(latest))
        .route("/assets/{file}", get(asset))
        .with_state(served);
    tokio::spawn(async move { axum::serve(listener, router).await.expect("forge") });
    Forge {
        api: base,
        seen,
        _scratch: scratch,
    }
}

/// A wizard that installs nothing, against `api`, with its state in `state_dir`.
pub fn config(api: &str, state_dir: &std::path::Path) -> Config {
    Config {
        real: false,
        github_api: api.to_owned(),
        gateway_repository: "owner/gateway".to_owned(),
        ui_repository: "owner/ui".to_owned(),
        wizard_repository: "owner/wizard".to_owned(),
        state_dir: state_dir.to_owned(),
        ui_dir: None,
        launcher: "127.0.0.1:1".to_owned(),
        gateway: "127.0.0.1:1".to_owned(),
        post_script: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../system/packages/post_wizard/install.sh"),
        binary: PathBuf::from("nas-wizard"),
        disks: false,
        encryption: false,
        launcher_binary: PathBuf::from("/nonexistent/nas-os-axum"),
    }
}
