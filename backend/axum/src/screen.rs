//! The screen of the NAS: the interface on a monitor connected to it, and only while one is.
//!
//! `nas-wizard screen` runs as root from `nas-os-screen.service`, a few megabytes for as long as
//! the machine is on. It watches the video outputs and the keyboards and mice. A monitor connected
//! starts `nas-os-screen-browser.service`, the browser on the monitor (`cog`, a few hundred
//! megabytes). A monitor unplugged stops it; so do the minutes without a key or the mouse that the
//! power settings name, after which the screen goes dark and the monitor into standby. The browser
//! keeps nothing between two starts: a key or the mouse brings it back on the sign-in page.
//!
//! The browser draws on tty1 and holds the screen while it runs, so it runs only while tty1 is the
//! console in front: Ctrl+Alt+F2 (to F6) stops it and leaves the screen to the text console of
//! that terminal, Ctrl+Alt+F1 brings the interface back. The kernel switches the console on its
//! own, since the browser leaves the keyboard to it.

use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// The unit of the browser on the monitor.
pub const BROWSER: &str = "nas-os-screen-browser.service";
/// The console the browser draws on.
pub const CONSOLE: &str = "tty1";
/// Without a choice in the settings, the screen goes dark after ten minutes untouched.
pub const DEFAULT_MINUTES: u64 = 10;
const MAX_MINUTES: u64 = 240;
/// How often the outputs, the input devices and the minutes are looked at again.
const TICK: Duration = Duration::from_secs(1);
/// One `struct input_event` of the kernel on a 64-bit machine.
const EVENT_SIZE: usize = 24;

/// Where the screen reads what it needs: the sysfs of the outputs and of the framebuffers, the
/// input devices and the minutes the launcher writes.
#[derive(Debug, Clone)]
pub struct Paths {
    pub outputs: PathBuf,
    pub inputs: PathBuf,
    pub framebuffers: PathBuf,
    pub minutes: PathBuf,
    /// The name of the console in front.
    pub console: PathBuf,
}

impl Paths {
    /// The ones of the machine; the minutes beside the database of the launcher, or
    /// `NAS_SCREEN_MINUTES`.
    pub fn system() -> Self {
        Self {
            outputs: PathBuf::from("/sys/class/drm"),
            inputs: PathBuf::from("/dev/input"),
            framebuffers: PathBuf::from("/sys/class/graphics"),
            minutes: std::env::var_os("NAS_SCREEN_MINUTES").map_or_else(
                || PathBuf::from("/var/lib/nas-os/screen-off-minutes"),
                PathBuf::from,
            ),
            console: PathBuf::from("/sys/class/tty/tty0/active"),
        }
    }
}

/// Where the screen stands: nothing to show, the interface shown, or dark until touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Dark,
    Showing,
    Standby,
}

/// What the screen does on a change of state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// A monitor came: the browser starts.
    Show,
    /// The monitor went, or another console came in front: the browser stops and the screen is
    /// left lit to that console.
    Hide,
    /// Nothing was touched for long enough: the browser stops and the screen goes dark.
    Sleep,
    /// Something was touched in standby: the screen lights up and the browser starts again.
    Wake,
}

/// What follows `state`, with a monitor `connected` or not, and nothing touched for `idle`, when
/// the screen goes dark after `limit`.
pub fn next(
    state: State,
    connected: bool,
    idle: Duration,
    limit: Duration,
) -> (State, Option<Step>) {
    match (state, connected) {
        (State::Dark, true) => (State::Showing, Some(Step::Show)),
        (State::Dark, false) => (State::Dark, None),
        (State::Showing, false) => (State::Dark, Some(Step::Hide)),
        (State::Showing, true) if idle >= limit => (State::Standby, Some(Step::Sleep)),
        (State::Showing, true) => (State::Showing, None),
        (State::Standby, false) => (State::Dark, Some(Step::Hide)),
        (State::Standby, true) if idle < limit => (State::Showing, Some(Step::Wake)),
        (State::Standby, true) => (State::Standby, None),
    }
}

/// Whether a monitor is connected to any output: `card0-HDMI-A-1/status`, `card0-DP-2/status` and
/// the like say `connected`. The outputs of no monitor (writeback) are left out.
pub fn connected(outputs: &Path) -> bool {
    let Ok(entries) = fs::read_dir(outputs) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        name.starts_with("card")
            && name.contains('-')
            && !name.contains("Writeback")
            && fs::read_to_string(entry.path().join("status"))
                .is_ok_and(|status| status.trim() == "connected")
    })
}

/// Whether the console of the browser is the one in front. A machine without consoles has it in
/// front always.
pub fn in_front(console: &Path) -> bool {
    fs::read_to_string(console).map_or(true, |active| active.trim() == CONSOLE)
}

/// The minutes untouched after which the screen goes dark, from 1 to 240, ten when the launcher
/// wrote none or something else.
pub fn limit(minutes: &Path) -> Duration {
    let minutes = fs::read_to_string(minutes)
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .filter(|minutes| (1..=MAX_MINUTES).contains(minutes))
        .unwrap_or(DEFAULT_MINUTES);
    Duration::from_secs(minutes * 60)
}

/// Turns the framebuffers off (powered down, the monitor goes into standby) or on again. A machine
/// without them stays as it is.
pub fn blank(framebuffers: &Path, dark: bool) {
    let Ok(entries) = fs::read_dir(framebuffers) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with("fb") {
            let _ = fs::write(entry.path().join("blank"), if dark { "4" } else { "0" });
        }
    }
}

/// The last time a key, a button or the mouse was touched.
#[derive(Clone)]
pub struct Activity(Arc<Mutex<Instant>>);

impl Activity {
    pub fn new(now: Instant) -> Self {
        Self(Arc::new(Mutex::new(now)))
    }

    pub fn touch(&self, now: Instant) {
        if let Ok(mut last) = self.0.lock() {
            *last = now;
        }
    }

    pub fn idle(&self, now: Instant) -> Duration {
        self.0
            .lock()
            .map_or(Duration::ZERO, |last| now.saturating_duration_since(*last))
    }
}

/// Reads every input device not read yet, each on a thread of its own that counts any event as a
/// touch and ends with its device. Keyboards and mice plugged later are found at the next call.
pub fn watch_inputs(inputs: &Path, activity: &Activity, reading: &Arc<Mutex<HashSet<PathBuf>>>) {
    let Ok(entries) = fs::read_dir(inputs) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_name().to_string_lossy().starts_with("event") {
            continue;
        }
        let Ok(mut opened) = reading.lock() else {
            return;
        };
        if !opened.insert(path.clone()) {
            continue;
        }
        drop(opened);
        let (activity, reading) = (activity.clone(), reading.clone());
        std::thread::spawn(move || {
            if let Ok(mut device) = fs::File::open(&path) {
                let mut event = [0_u8; EVENT_SIZE];
                while matches!(device.read(&mut event), Ok(read) if read > 0) {
                    activity.touch(Instant::now());
                }
            }
            if let Ok(mut opened) = reading.lock() {
                opened.remove(&path);
            }
        });
    }
}

/// The screen, ticking once a second; `act` carries out each step.
pub struct Screen<Act: FnMut(Step)> {
    paths: Paths,
    state: State,
    activity: Activity,
    reading: Arc<Mutex<HashSet<PathBuf>>>,
    act: Act,
}

impl<Act: FnMut(Step)> Screen<Act> {
    pub fn new(paths: Paths, now: Instant, act: Act) -> Self {
        Self {
            paths,
            state: State::Dark,
            activity: Activity::new(now),
            reading: Arc::new(Mutex::new(HashSet::new())),
            act,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }

    pub fn activity(&self) -> &Activity {
        &self.activity
    }

    /// Looks at the outputs, the console in front, the inputs and the minutes once, and does what
    /// follows.
    pub fn tick(&mut self, now: Instant) -> Option<Step> {
        watch_inputs(&self.paths.inputs, &self.activity, &self.reading);
        let (state, step) = next(
            self.state,
            connected(&self.paths.outputs) && in_front(&self.paths.console),
            self.activity.idle(now),
            limit(&self.paths.minutes),
        );
        self.state = state;
        if let Some(step) = step {
            // A monitor that just came, or the screen lit up again, counts from now.
            if matches!(step, Step::Show | Step::Wake) {
                self.activity.touch(now);
            }
            (self.act)(step);
        }
        step
    }
}

fn systemctl(verb: &str) {
    match Command::new("systemctl").args([verb, BROWSER]).status() {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!("systemctl {verb} {BROWSER} ended with {status}"),
        Err(error) => eprintln!("systemctl {verb} {BROWSER}: {error}"),
    }
}

/// What each step does on the machine.
pub fn carry_out(framebuffers: &Path, step: Step) {
    println!("screen: {step:?}");
    match step {
        Step::Show | Step::Wake => {
            blank(framebuffers, false);
            systemctl("start");
        }
        Step::Hide => {
            systemctl("stop");
            blank(framebuffers, false);
        }
        Step::Sleep => {
            systemctl("stop");
            blank(framebuffers, true);
        }
    }
}

/// `nas-wizard screen`: never ends on its own. It starts with the screen lit, in case it stopped
/// in standby.
pub fn run(paths: Paths) {
    let framebuffers = paths.framebuffers.clone();
    blank(&framebuffers, false);
    let mut screen = Screen::new(paths, Instant::now(), move |step| {
        carry_out(&framebuffers, step);
    });
    loop {
        screen.tick(Instant::now());
        std::thread::sleep(TICK);
    }
}

#[cfg(test)]
#[path = "../../tests/screen.rs"]
mod tests;
