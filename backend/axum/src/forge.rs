//! The wizard downloads the gateway and the launcher with it, and itself, when the entry
//! script asks whether a newer wizard exists.
//!
//! The token goes only to the origin of the API (`NAS_GITHUB_API`). The asset endpoints are there,
//! and a redirect to the download host leaves it behind.

use crate::config::Config;
use serde::Deserialize;
use std::{path::Path, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};

const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
const UNPACK_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_ASSET: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct Asset {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct Release {
    pub version: String,
    pub assets: Vec<Asset>,
}

impl Release {
    pub fn asset(&self, name: &str) -> Option<&Asset> {
        self.assets.iter().find(|asset| asset.name == name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgeFailure {
    /// 401: the token is wrong or expired
    Refused,
    /// 403: the token has no permission on the repository
    Forbidden,
    /// 404: no release, or a repository the token cannot see
    Missing,
    /// The forge did not answer, or answered something else
    Unreachable(String),
}

impl ForgeFailure {
    pub fn describe(&self, repository: &str) -> String {
        match self {
            Self::Refused => format!("{repository} refused the token"),
            Self::Forbidden => format!("the token has no permission on {repository}"),
            Self::Missing => format!("{repository} has no release, or the token cannot see it"),
            Self::Unreachable(reason) => reason.clone(),
        }
    }
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("nas-wizard/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| format!("cannot build the HTTP client: {error}"))
}

fn for_forge<'a>(config: &Config, url: &str, token: Option<&'a str>) -> Option<&'a str> {
    let origin = |address: &str| reqwest::Url::parse(address).ok().map(|url| url.origin());
    let target = origin(url)?;
    (origin(&config.github_api).as_ref() == Some(&target))
        .then_some(token)
        .flatten()
}

fn authorise(request: reqwest::RequestBuilder, token: Option<&str>) -> reqwest::RequestBuilder {
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

pub fn version(tag: &str) -> String {
    tag.trim().trim_start_matches('v').to_owned()
}

/// Whether `candidate` comes after `installed`, part by part.
pub fn is_newer(candidate: &str, installed: &str) -> bool {
    let parts = |value: &str| {
        value
            .split(['.', '-', '+'])
            .map(|piece| piece.parse::<u64>().ok())
            .collect::<Vec<_>>()
    };
    let (left, right) = (parts(candidate), parts(installed));
    for index in 0..left.len().max(right.len()) {
        let one = left.get(index).copied().flatten().unwrap_or(0);
        let other = right.get(index).copied().flatten().unwrap_or(0);
        if one != other {
            return one > other;
        }
    }
    false
}

pub async fn latest(
    config: &Config,
    repository: &str,
    token: Option<&str>,
) -> Result<Release, ForgeFailure> {
    if repository.is_empty() || repository.contains(['?', '#', ' ']) {
        return Err(ForgeFailure::Unreachable(format!(
            "invalid repository: {repository}"
        )));
    }
    let client = client().map_err(ForgeFailure::Unreachable)?;
    let url = format!("{}/repos/{repository}/releases/latest", config.github_api);
    let request = authorise(
        client
            .get(&url)
            .timeout(CHECK_TIMEOUT)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json"),
        for_forge(config, &url, token),
    );
    let answer = request.send().await.map_err(|error| {
        ForgeFailure::Unreachable(format!("cannot reach {repository}: {error}"))
    })?;
    match answer.status().as_u16() {
        401 => return Err(ForgeFailure::Refused),
        403 => return Err(ForgeFailure::Forbidden),
        404 => return Err(ForgeFailure::Missing),
        status if !(200..300).contains(&status) => {
            return Err(ForgeFailure::Unreachable(format!(
                "{repository} answered {status}"
            )))
        }
        _ => {}
    }
    let release: GithubRelease = answer.json().await.map_err(|error| {
        ForgeFailure::Unreachable(format!("unreadable answer from {repository}: {error}"))
    })?;
    Ok(Release {
        version: version(&release.tag_name),
        assets: release.assets,
    })
}

pub async fn download(
    config: &Config,
    url: &str,
    destination: &Path,
    token: Option<&str>,
) -> Result<u64, String> {
    use futures_util::StreamExt;

    let client = client()?;
    let request = authorise(
        client
            .get(url)
            .timeout(DOWNLOAD_TIMEOUT)
            .header(reqwest::header::ACCEPT, "application/octet-stream"),
        for_forge(config, url, token),
    );
    let answer = request
        .send()
        .await
        .map_err(|error| format!("cannot download the package: {error}"))?;
    if !answer.status().is_success() {
        return Err(format!("the package answered {}", answer.status().as_u16()));
    }
    if answer.content_length().is_some_and(|size| size > MAX_ASSET) {
        return Err("the package is larger than the wizard will fetch".to_owned());
    }

    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|error| format!("cannot write {}: {error}", destination.display()))?;
    let mut written: u64 = 0;
    let mut stream = answer.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("the download stopped: {error}"))?;
        written += chunk.len() as u64;
        if written > MAX_ASSET {
            return Err("the package is larger than the wizard will fetch".to_owned());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("cannot write {}: {error}", destination.display()))?;
    }
    file.flush()
        .await
        .map_err(|error| format!("cannot write {}: {error}", destination.display()))?;
    Ok(written)
}

/// SHA-256 of a file, in hexadecimal.
pub async fn digest(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("cannot read the package: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("cannot read the package: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

async fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let _ = tokio::fs::remove_dir_all(into).await;
    tokio::fs::create_dir_all(into)
        .await
        .map_err(|error| format!("cannot create {}: {error}", into.display()))?;
    let extract = Command::new("tar")
        .arg("--extract")
        .arg("--auto-compress")
        .arg("--no-same-owner")
        .arg("--file")
        .arg(archive)
        .arg("--directory")
        .arg(into)
        .output();
    match tokio::time::timeout(UNPACK_TIMEOUT, extract).await {
        Ok(Ok(output)) if output.status.success() => Ok(()),
        Ok(Ok(output)) => Err(String::from_utf8_lossy(&output.stderr)
            .lines()
            .next()
            .unwrap_or("tar refused the package")
            .trim()
            .to_owned()),
        Ok(Err(error)) => Err(format!("cannot run tar: {error}")),
        Err(_) => Err("unpacking did not finish".to_owned()),
    }
}

pub struct Wanted<'a> {
    pub repository: &'a str,
    pub asset: fn(&str) -> String,
}

/// Downloads the latest package of a repository, checks it against the checksum published beside
/// it and unpacks it into `into`.
pub async fn fetch(
    config: &Config,
    wanted: &Wanted<'_>,
    token: Option<&str>,
    into: &Path,
) -> Result<String, String> {
    let release = latest(config, wanted.repository, token)
        .await
        .map_err(|failure| failure.describe(wanted.repository))?;
    let name = (wanted.asset)(&release.version);
    let package = release
        .asset(&name)
        .ok_or_else(|| format!("the release {} has no {name}", release.version))?;
    let published = release
        .asset(&format!("{name}.sha256"))
        .ok_or_else(|| format!("the release {} publishes no checksum", release.version))?;

    tokio::fs::create_dir_all(&config.state_dir)
        .await
        .map_err(|error| format!("cannot create {}: {error}", config.state_dir.display()))?;
    let archive = config.state_dir.join(&name);
    let sums = config.state_dir.join(format!("{name}.sha256"));
    download(config, &package.url, &archive, token).await?;
    download(config, &published.url, &sums, token).await?;
    let declared = tokio::fs::read_to_string(&sums)
        .await
        .map_err(|error| format!("cannot read the checksum: {error}"))?
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let _ = tokio::fs::remove_file(&sums).await;
    let actual = digest(&archive).await?;
    if declared != actual {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err("the package does not match its published checksum".to_owned());
    }
    let unpacked = unpack(&archive, into).await;
    let _ = tokio::fs::remove_file(&archive).await;
    unpacked.map(|()| release.version)
}

#[cfg(test)]
#[path = "../tests/forge.rs"]
mod tests;
