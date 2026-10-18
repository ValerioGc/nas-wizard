//! The wizard of nas-os

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
#[path = "../tests/support.rs"]
pub mod support;
