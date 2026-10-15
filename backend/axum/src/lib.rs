//! The wizard of nas-os: the first configuration of the machine, from the browser, before the
//! gateway and the launcher exist. It collects account, language, theme, network and token, then
//! downloads and installs the gateway and the launcher, configures them and hands port 80 to the
//! gateway.

pub mod account;
pub mod config;
pub mod discovery;
pub mod disks;
pub mod forge;
pub mod http;
pub mod installer;
pub mod network;
pub mod screen;
pub mod self_update;
pub mod state;
pub mod token;

#[cfg(test)]
#[path = "../../tests/support.rs"]
pub mod support;
