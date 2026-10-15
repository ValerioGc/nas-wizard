//! What the wizard reads from its environment, once, at the start.
//!
//! On the NAS the entry script starts it as the unit `nas-wizard` with `WIZARD_MODE=real`, port 80
//! and the state directory of the unit. In development every switch is off: the wizard downloads
//! the releases, but installs nothing and changes no network.
//!
//! The token is not here: the user gives it in the page, and it travels from there to the script
//! that runs after the wizard, on its input.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Config {
    /// Whether the wizard installs and changes the network for real (`WIZARD_MODE=real`)
    pub real: bool,
    /// The API of GitHub, or a forge that answers like it in the tests (`NAS_GITHUB_API`)
    pub github_api: String,
    pub gateway_repository: String,
    pub ui_repository: String,
    pub wizard_repository: String,
    /// Where the releases are downloaded and unpacked
    pub state_dir: PathBuf,
    /// The built interface of the wizard, served on every path that is not the API
    pub ui_dir: Option<PathBuf>,
    /// Where the launcher answers once installed, on the loopback
    pub launcher: String,
    /// Where the gateway answers once started
    pub gateway: String,
    /// The script that turns the machine into the NAS once the choices are made
    pub post_script: PathBuf,
    /// This program, which the script calls back to download the releases and to end the
    /// configuration on the launcher
    pub binary: PathBuf,
    /// The step of the data disks is shown (`WIZARD_DISKS_MODE=real`), off until tried
    pub disks: bool,
    /// Encryption is offered in that step (`WIZARD_ENCRYPTION_MODE=real`)
    pub encryption: bool,
    /// The launcher once installed, whose root code prepares the disks
    pub launcher_binary: PathBuf,
}

fn variable(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.to_owned())
}

/// A token in a file, trimmed: what the script after the wizard hands to `nas-wizard fetch`.
pub fn token_from(path: Option<PathBuf>) -> Option<String> {
    let token = std::fs::read_to_string(path?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

/// The script after the wizard: beside the binary in the release package
/// (`wizard/bin/nas-wizard` and `packages/post_wizard/install.sh`), in the repository in a
/// development build.
fn post_script(binary: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../system/packages/post_wizard/install.sh");
    }
    packaged_script(binary)
}

/// The script after the wizard in the release package, three folders above the binary.
fn packaged_script(binary: &Path) -> PathBuf {
    binary
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new("/"))
        .join("packages/post_wizard/install.sh")
}

impl Config {
    pub fn from_env() -> Self {
        let state_dir = std::env::var_os("WIZARD_STATE_DIR")
            .or_else(|| std::env::var_os("STATE_DIRECTORY"))
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if cfg!(debug_assertions) {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data")
                } else {
                    PathBuf::from("/var/lib/nas-wizard")
                }
            });
        let binary = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("nas-wizard"));
        Self {
            real: std::env::var("WIZARD_MODE").is_ok_and(|mode| mode == "real"),
            github_api: variable("NAS_GITHUB_API", "https://api.github.com"),
            gateway_repository: variable("WIZARD_GATEWAY_REPOSITORY", "ValerioGc/nas-gateway"),
            ui_repository: variable("WIZARD_UI_REPOSITORY", "ValerioGc/nas-launcher"),
            wizard_repository: variable("WIZARD_REPOSITORY", "ValerioGc/nas-wizard"),
            state_dir,
            ui_dir: std::env::var_os("WIZARD_UI_DIR").map(PathBuf::from),
            launcher: variable("WIZARD_LAUNCHER", "127.0.0.1:3000"),
            gateway: variable("WIZARD_GATEWAY", "127.0.0.1:80"),
            post_script: std::env::var_os("WIZARD_POST_SCRIPT")
                .map(PathBuf::from)
                .unwrap_or_else(|| post_script(&binary)),
            binary,
            disks: std::env::var("WIZARD_DISKS_MODE").is_ok_and(|mode| mode == "real"),
            encryption: std::env::var("WIZARD_ENCRYPTION_MODE").is_ok_and(|mode| mode == "real"),
            launcher_binary: std::env::var_os("WIZARD_LAUNCHER_BINARY").map_or_else(
                || PathBuf::from("/usr/local/bin/nas-os-axum"),
                PathBuf::from,
            ),
        }
    }
}

#[cfg(test)]
#[path = "../../tests/config.rs"]
mod tests;
