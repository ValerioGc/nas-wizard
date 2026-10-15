//! Where the wizard is: collecting the choices, installing, done, or stopped on a step that failed.
//! It lives in memory only. A wizard that stops halfway is run again from the entry script, and
//! every step can be repeated: the installers are, the account and the end of the configuration
//! take "already done" for done. The steps before the handover are those of
//! `packages/post_wizard/install.sh`, which announces them as it goes.

use crate::{config::Config, disks::Choice};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::{Mutex, Notify};

/// The steps of the installation, in order. `handover` is the last: once the HTTPS authority was
/// offered, the wizard leaves the ports to the gateway and ends.
pub const STEPS: [&str; 10] = [
    "download_gateway",
    "download_ui",
    "install_gateway",
    "install_ui",
    "configure",
    "disks",
    "account",
    "certificate",
    "complete",
    "handover",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Collecting,
    Installing,
    /// Every step but the handover is done: the page offers the HTTPS authority and waits for the
    /// person to proceed.
    Ready,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepState {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Step {
    pub id: &'static str,
    pub state: StepState,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    It,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

/// What the page sends once the choices are made.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    pub username: String,
    pub password: String,
    pub language: Language,
    pub theme: Theme,
    /// The name of the NAS, its hostname once the launcher has it.
    #[serde(default = "default_nas_name", rename = "nasName")]
    pub nas_name: String,
    /// The token of the private releases; none reads public releases only.
    #[serde(default)]
    pub token: Option<String>,
    /// The empty data disks to initialize.
    #[serde(default)]
    pub disks: Vec<Choice>,
}

fn default_nas_name() -> String {
    "nas".to_owned()
}

/// The choices, checked, kept for the steps. The password goes once the account is created.
#[derive(Debug, Clone)]
pub struct Request {
    pub username: String,
    pub user: String,
    pub password: String,
    pub language: Language,
    pub theme: Theme,
    pub nas_name: String,
    pub token: Option<String>,
    pub disks: Vec<Choice>,
}

/// What the page offers at the end: the authority of the NAS to trust for HTTPS.
/// Kept in memory until the wizard ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub ca_pem: Option<String>,
}

#[derive(Debug)]
pub struct Wizard {
    pub phase: Phase,
    pub steps: Vec<Step>,
    pub request: Option<Request>,
    pub offer: Option<Offer>,
}

impl Default for Wizard {
    fn default() -> Self {
        Self {
            phase: Phase::Collecting,
            steps: STEPS
                .iter()
                .map(|id| Step {
                    id,
                    state: StepState::Pending,
                    detail: String::new(),
                })
                .collect(),
            request: None,
            offer: None,
        }
    }
}

impl Wizard {
    pub fn mark(&mut self, id: &str, state: StepState, detail: impl Into<String>) {
        if let Some(step) = self.steps.iter_mut().find(|step| step.id == id) {
            step.state = state;
            step.detail = detail.into();
        }
    }
}

/// What the page reads: never the password, never the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: Phase,
    pub steps: Vec<Step>,
    pub simulated: bool,
    pub version: &'static str,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub wizard: Arc<Mutex<Wizard>>,
    /// Woken once every step but the handover is done, for the server to step aside.
    pub handover: Arc<Notify>,
    pub handing_over: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self {
            config: Arc::new(config),
            wizard: Arc::new(Mutex::new(Wizard::default())),
            handover: Arc::new(Notify::new()),
            handing_over: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn snapshot(&self, wizard: &Wizard) -> Snapshot {
        Snapshot {
            phase: wizard.phase,
            steps: wizard.steps.clone(),
            simulated: !self.config.real,
            version: env!("CARGO_PKG_VERSION"),
        }
    }

    pub async fn current(&self) -> Snapshot {
        let wizard = self.wizard.lock().await;
        self.snapshot(&wizard)
    }

    pub fn ask_handover(&self) {
        self.handing_over.store(true, Ordering::SeqCst);
        self.handover.notify_one();
    }

    pub fn handing_over(&self) -> bool {
        self.handing_over.load(Ordering::SeqCst)
    }
}
