//! `nas-wizard self-update --into <dir>`. 
//! The entry script asks it whether a newer wizard has been
//! released, before starting this one. A newer release is downloaded, checked and unpacked in a
//! directory of its own, whose path is printed. The script then runs its entry script instead.
//! It asks without a token, which the user gives only later, in the wizard: a private repository
//! answers that it has no release, and the wizard of the package goes on.

use crate::{
    config::Config,
    forge::{self, Wanted},
};
use std::path::{Path, PathBuf};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn wizard_asset(version: &str) -> String {
    format!("nas-wizard-{version}-linux-x64.tar.gz")
}

/// The directory of a newer wizard, or nothing when this one is the latest.
pub async fn run(config: &Config, into: &Path) -> Result<Option<PathBuf>, String> {
    let release = forge::latest(config, &config.wizard_repository, None)
        .await
        .map_err(|failure| failure.describe(&config.wizard_repository))?;
    if !forge::is_newer(&release.version, VERSION) {
        return Ok(None);
    }
    let directory = into.join(&release.version);
    let wanted = Wanted {
        repository: &config.wizard_repository,
        asset: wizard_asset,
    };
    forge::fetch(config, &wanted, None, &directory).await?;
    Ok(Some(directory))
}

#[cfg(test)]
#[path = "../tests/self_update.rs"]
mod tests;
