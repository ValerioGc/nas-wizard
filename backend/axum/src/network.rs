//! The network of the machine while the wizard runs: how it is connected, the wireless networks in
//! reach, and joining one of them. Read with `ip`, sysfs and `nmcli`, as the launcher does; joining
//! a network happens only with `WIZARD_MODE=real`.
//!
//! The wizard may run before the machine has any connection: an unreadable network is a state to
//! show, not an error.

use crate::http::error::ApiFailure;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::process::Command;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Lan,
    Wifi,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Connection {
    pub kind: LinkKind,
    pub connected: bool,
    pub ssid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WifiNetwork {
    pub ssid: String,
    pub signal: u8,
    pub security: String,
    pub known: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Networks {
    pub connection: Connection,
    pub wifi: Vec<WifiNetwork>,
    pub can_connect: bool,
    pub wifi_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WifiRequest {
    pub ssid: String,
    pub password: Option<String>,
}

async fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().await.ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The fields of a line of `nmcli -t`, which separates with `:` and escapes it with `\` inside a
/// value: an SSID may hold one.
pub fn fields(line: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut escaped = false;
    for character in line.chars() {
        match character {
            '\\' if !escaped => escaped = true,
            ':' if !escaped => out.push(String::new()),
            _ => {
                escaped = false;
                if let Some(last) = out.last_mut() {
                    last.push(character);
                }
            }
        }
    }
    out
}

async fn device(kind: &str) -> Option<String> {
    run("nmcli", &["-t", "-f", "DEVICE,TYPE", "device"])
        .await?
        .lines()
        .map(fields)
        .find(|row| row.get(1).map(String::as_str) == Some(kind))
        .and_then(|row| row.first().cloned())
        .filter(|name| !name.is_empty())
}

async fn known_networks() -> Vec<String> {
    run("nmcli", &["-t", "-f", "NAME,TYPE", "connection", "show"])
        .await
        .unwrap_or_default()
        .lines()
        .map(fields)
        .filter(|row| row.get(1).map(String::as_str) == Some("802-11-wireless"))
        .filter_map(|row| row.first().cloned())
        .collect()
}

/// The networks of a `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`, one per name,
/// with the strongest reading, strongest first.
pub fn parse_scan(listed: &str, known: &[String]) -> Vec<WifiNetwork> {
    let mut networks: Vec<WifiNetwork> = Vec::new();
    for row in listed.lines().map(fields) {
        let [_, ssid, signal, security] = &row[..] else {
            continue;
        };
        if ssid.is_empty() {
            continue;
        }
        let found = WifiNetwork {
            signal: signal.trim().parse().unwrap_or(0),
            security: if security.trim().is_empty() {
                "open".to_owned()
            } else {
                security.trim().to_owned()
            },
            known: known.iter().any(|name| name == ssid),
            ssid: ssid.clone(),
        };
        match networks.iter_mut().find(|other| other.ssid == found.ssid) {
            Some(other) => {
                other.known |= found.known;
                if found.signal > other.signal {
                    other.signal = found.signal;
                    other.security = found.security;
                }
            }
            None => networks.push(found),
        }
    }
    networks.sort_by_key(|network| std::cmp::Reverse(network.signal));
    networks
}

async fn scan(rescan: bool) -> Result<Vec<WifiNetwork>, String> {
    let Some(interface) = device("wifi").await else {
        return Err(
            if run("nmcli", &["-t", "general", "status"]).await.is_none() {
                "NetworkManager does not answer: nmcli is missing or the service is not running"
            } else {
                "no Wi-Fi device: NetworkManager manages none on this machine"
            }
            .to_owned(),
        );
    };
    if rescan {
        let _ = run("nmcli", &["device", "wifi", "rescan", "ifname", &interface]).await;
    }
    let listed = run(
        "nmcli",
        &[
            "-t",
            "-f",
            "IN-USE,SSID,SIGNAL,SECURITY",
            "device",
            "wifi",
            "list",
            "ifname",
            &interface,
        ],
    )
    .await
    .ok_or_else(|| format!("nmcli could not list the networks seen by {interface}"))?;
    Ok(parse_scan(&listed, &known_networks().await))
}

/// The interface of the default route, the one that takes the machine to the network.
async fn default_interface() -> Option<String> {
    let routes: Value = serde_json::from_str(&run("ip", &["-json", "route"]).await?).ok()?;
    routes.as_array()?.iter().find_map(|route| {
        (route.get("dst")?.as_str()? == "default")
            .then(|| route.get("dev")?.as_str().map(str::to_owned))?
    })
}

async fn ssid(interface: &str) -> Option<String> {
    let output = run(
        "nmcli",
        &["-t", "-f", "GENERAL.CONNECTION", "dev", "show", interface],
    )
    .await?;
    output
        .lines()
        .find_map(|line| fields(line).get(1).cloned())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && value != "--")
}

async fn connection() -> Connection {
    let Some(interface) = default_interface().await else {
        return Connection {
            kind: LinkKind::Lan,
            connected: false,
            ssid: None,
        };
    };
    let wireless = tokio::fs::metadata(format!("/sys/class/net/{interface}/wireless"))
        .await
        .is_ok();
    Connection {
        kind: if wireless {
            LinkKind::Wifi
        } else {
            LinkKind::Lan
        },
        connected: true,
        ssid: if wireless {
            ssid(&interface).await
        } else {
            None
        },
    }
}

pub async fn state(real: bool, rescan: bool) -> Networks {
    let (wifi, wifi_note) = match scan(rescan).await {
        Ok(found) => (found, None),
        Err(reason) => (Vec::new(), Some(reason)),
    };
    Networks {
        connection: connection().await,
        wifi,
        can_connect: real,
        wifi_note,
    }
}

/// What a request to join a network asks for, checked: the name and, when there is one, the
/// password, with the bounds of WPA.
pub fn checked(request: &WifiRequest) -> Result<(&str, Option<&str>), ApiFailure> {
    let ssid = request.ssid.trim();
    if ssid.is_empty() || ssid.len() > 32 {
        return Err(ApiFailure::bad("invalid network name"));
    }
    let password = request
        .password
        .as_deref()
        .map(str::trim)
        .filter(|secret| !secret.is_empty());
    if password.is_some_and(|secret| !(8..=64).contains(&secret.chars().count())) {
        return Err(ApiFailure::bad("the password of this network is too short"));
    }
    Ok((ssid, password))
}

pub async fn join(real: bool, request: &WifiRequest) -> Result<Networks, ApiFailure> {
    let (ssid, password) = checked(request)?;
    if !real {
        return Err(ApiFailure::unavailable(
            "network changes are disabled for this wizard (WIZARD_MODE)",
        ));
    }
    let interface = device("wifi")
        .await
        .ok_or_else(|| ApiFailure::unavailable("no wireless interface"))?;
    let mut arguments = vec!["device", "wifi", "connect", ssid, "ifname", &interface];
    if let Some(secret) = password {
        arguments.extend(["password", secret]);
    }
    let call = Command::new("nmcli").args(&arguments).output();
    match tokio::time::timeout(CONNECT_TIMEOUT, call).await {
        Ok(Ok(output)) if output.status.success() => Ok(state(real, false).await),
        Ok(Ok(output)) => {
            let reason = String::from_utf8_lossy(&output.stderr)
                .lines()
                .next()
                .unwrap_or("the command was refused")
                .trim()
                .to_owned();
            Err(if reason.contains("ecrets") {
                ApiFailure::bad("the network refused the password")
            } else {
                ApiFailure::unavailable(reason)
            })
        }
        Ok(Err(error)) => Err(ApiFailure::unavailable(error.to_string())),
        Err(_) => Err(ApiFailure::unavailable("nmcli did not answer")),
    }
}

#[cfg(test)]
#[path = "../../tests/network.rs"]
mod tests;
