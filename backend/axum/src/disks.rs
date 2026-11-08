//! The data disks of the first configuration.
//! The empty whole internal disks the person may have initialized, read from lsblk.
//! The wizard only proposes them. Once the launcher is installed,
//! `nas-wizard disks` hands each choice to its root code (`nas-os-axum --initialize-storage`),
//! which checks the disk again, its identity included, before it erases anything.
//!
//! The step is on by default and `WIZARD_DISKS_MODE=off` hides it. The wizard never encrypts a
//! disk. It runs on plain HTTP, where no password of a disk may travel, so the person encrypts a
//! data disk later in the app Dischi, over HTTPS, with the keys they choose.

use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

const MAX_CHOICES: usize = 16;
const COLUMNS: &str = "NAME,PATH,TYPE,SIZE,FSTYPE,PARTTYPE,MOUNTPOINTS,RO,RM,TRAN,MODEL,SERIAL,WWN";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub device: String,
    pub size: u64,
    pub model: Option<String>,
    /// WWN, serial and size, as the launcher reads them
    pub identity: String,
    /// No partition and no filesystem
    pub empty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub enabled: bool,
    pub disks: Vec<Disk>,
}

/// An empty disk the person chose to initialize.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Choice {
    pub device: String,
    pub identity: String,
}

#[derive(Debug, Deserialize)]
struct Listed {
    blockdevices: Vec<Block>,
}

#[derive(Debug, Deserialize)]
struct Block {
    name: Option<String>,
    path: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    size: Option<u64>,
    fstype: Option<String>,
    parttype: Option<String>,
    mountpoints: Option<Vec<Option<String>>>,
    ro: Option<bool>,
    rm: Option<bool>,
    tran: Option<String>,
    model: Option<String>,
    serial: Option<String>,
    wwn: Option<String>,
    children: Option<Vec<Block>>,
}

fn system_mount(path: &str) -> bool {
    ["/", "/boot", "/efi", "/usr", "/var", "/home", "/etc"]
        .iter()
        .any(|mount| path == *mount || (*mount != "/" && path.starts_with(&format!("{mount}/"))))
}

/// The block or one below it holds the system: mounted where the system lives, or swap.
fn holds_system(block: &Block) -> bool {
    block.fstype.as_deref() == Some("swap")
        || block
            .mountpoints
            .iter()
            .flatten()
            .flatten()
            .any(|path| system_mount(path))
        || block.children.iter().flatten().any(holds_system)
}

fn text(value: Option<&String>) -> String {
    value
        .map(|value| value.trim().to_owned())
        .unwrap_or_default()
}

/// The internal whole disks of a listing, without the one of the system.
pub fn parse(json: &str) -> Result<Vec<Disk>, String> {
    let listed: Listed =
        serde_json::from_str(json).map_err(|_| "unreadable list of the disks".to_owned())?;
    Ok(listed
        .blockdevices
        .into_iter()
        .filter(|block| {
            block.kind == "disk"
                && !block.ro.unwrap_or(false)
                && !block.rm.unwrap_or(false)
                && !matches!(block.tran.as_deref(), Some("usb" | "mmc" | "firewire"))
                && !holds_system(block)
        })
        .filter_map(|block| {
            let device = block.name.clone()?;
            if block.path.as_deref() != Some(format!("/dev/{device}").as_str()) {
                return None;
            }
            let size = block.size.unwrap_or_default();
            let empty = block.children.as_ref().is_none_or(Vec::is_empty)
                && block.fstype.as_deref().is_none_or(str::is_empty)
                && block.parttype.is_none();
            Some(Disk {
                identity: format!(
                    "{}/{}/{size}",
                    text(block.wwn.as_ref()),
                    text(block.serial.as_ref())
                ),
                model: block.model.filter(|model| !model.trim().is_empty()),
                device,
                size,
                empty,
            })
        })
        .collect())
}

/// The disks of the machine, when the step is on.
pub async fn offer(config: &Config) -> Offer {
    let disks = if config.disks {
        listed().await.unwrap_or_default()
    } else {
        Vec::new()
    };
    Offer {
        enabled: config.disks,
        disks,
    }
}

async fn listed() -> Result<Vec<Disk>, String> {
    let result = Command::new("lsblk")
        .args(["--json", "--tree", "--bytes", "--output", COLUMNS])
        .output()
        .await
        .map_err(|error| format!("lsblk: {error}"))?;
    if !result.status.success() {
        return Err("lsblk failed".to_owned());
    }
    parse(&String::from_utf8_lossy(&result.stdout))
}

/// The choices of the page, against the disks listed now: each an empty disk, once, with the
/// identity it has.
pub fn check(choices: &[Choice], offer: &Offer) -> Result<(), String> {
    if choices.is_empty() {
        return Ok(());
    }
    if !offer.enabled {
        return Err("the disks are not prepared by the wizard on this machine".to_owned());
    }
    if choices.len() > MAX_CHOICES {
        return Err("too many disks".to_owned());
    }
    for (index, choice) in choices.iter().enumerate() {
        if choices[..index]
            .iter()
            .any(|other| other.device == choice.device)
        {
            return Err(format!("{} is chosen twice", choice.device));
        }
        let Some(disk) = offer.disks.iter().find(|disk| disk.device == choice.device) else {
            return Err(format!(
                "{} is not a data disk of this machine",
                choice.device
            ));
        };
        if !disk.empty || disk.identity != choice.identity {
            return Err(format!(
                "{} is not the empty disk that was listed",
                choice.device
            ));
        }
    }
    Ok(())
}

/// The name of the volume a disk gets.
pub fn label(device: &str) -> String {
    format!("Data-{device}").chars().take(16).collect()
}

/// The request of the root code of the launcher for one choice.
pub fn request(choice: &Choice) -> serde_json::Value {
    serde_json::json!({
        "device": choice.device,
        "label": label(&choice.device),
        "identity": choice.identity,
    })
}

/// Prepares each disk of the file with the launcher installed at `launcher`, and says which.
pub async fn prepare(file: &Path, launcher: &Path, work: &Path) -> Result<Vec<String>, String> {
    let text = tokio::fs::read_to_string(file)
        .await
        .map_err(|error| format!("cannot read the disks: {error}"))?;
    let choices: Vec<Choice> =
        serde_json::from_str(&text).map_err(|_| "invalid list of disks".to_owned())?;
    let mut done = Vec::new();
    for choice in &choices {
        initialize(launcher, work, &request(choice)).await?;
        done.push(choice.device.clone());
    }
    Ok(done)
}

async fn initialize(
    launcher: &Path,
    work: &Path,
    request: &serde_json::Value,
) -> Result<(), String> {
    let file = work.join("disk-initialize.json");
    tokio::fs::write(&file, request.to_string())
        .await
        .map_err(|error| error.to_string())?;
    let status = Command::new(launcher)
        .arg("--initialize-storage")
        .arg(&file)
        .status()
        .await;
    let _ = tokio::fs::remove_file(&file).await;
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(format!("{} was not initialized", request["device"])),
    }
}

#[cfg(test)]
#[path = "../tests/disks.rs"]
mod tests;
