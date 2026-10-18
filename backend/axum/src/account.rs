//! The account of the NAS and the user of the terminal named after it.
//!
//! The wizard checks both before installing anything, so a name that would be refused halfway is
//! refused at once.

use crate::http::error::ApiFailure;
use std::time::Duration;
use tokio::process::Command;

const TERMINAL_COMMENT: &str = "nas-os terminal";

const RESERVED: [&str; 3] = ["nas", "nas-os", "root"];

pub fn valid(username: &str, password: &str) -> bool {
    (3..=25).contains(&username.len())
        && username
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        && (8..=128).contains(&password.chars().count())
}

pub fn os_user(account: &str) -> Option<String> {
    let name = account.trim().to_ascii_lowercase().replace('.', "_");
    let valid = (1..=32).contains(&name.len())
        && name.starts_with(|c: char| c.is_ascii_lowercase() || c == '_')
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        && !RESERVED.contains(&name.as_str());
    valid.then_some(name)
}

pub async fn user_available(name: &str) -> bool {
    let Ok(Ok(output)) = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("getent")
            .args(["passwd", name])
            .kill_on_drop(true)
            .output(),
    )
    .await
    else {
        return false;
    };
    if output.status.code() == Some(2) {
        return true;
    }
    output.status.success()
        && String::from_utf8_lossy(&output.stdout).split(':').nth(4) == Some(TERMINAL_COMMENT)
}

pub async fn check(username: &str, password: &str) -> Result<String, ApiFailure> {
    let username = username.trim();
    if !valid(username, password) {
        return Err(ApiFailure::bad(
            "the name takes 3 to 25 letters, digits, dots, dashes or underscores, the password 8 to 128 characters",
        ));
    }
    let user = os_user(username)
        .ok_or_else(|| ApiFailure::bad("the account name cannot name a user of the system"))?;
    if !user_available(&user).await {
        return Err(ApiFailure::bad(
            "the account name belongs to a user of the system",
        ));
    }
    Ok(user)
}

pub fn is_nas_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=63).contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
}

pub fn is_token(value: &str) -> bool {
    let value = value.trim();
    (1..=512).contains(&value.len()) && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

#[cfg(test)]
#[path = "../tests/account.rs"]
mod tests;
