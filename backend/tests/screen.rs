use super::*;
use crate::support::Scratch;

const MINUTE: Duration = Duration::from_secs(60);

/// The sysfs, the devices and the minutes of a machine of the test.
fn machine(scratch: &Scratch) -> Paths {
    let paths = Paths {
        outputs: scratch.0.join("drm"),
        inputs: scratch.0.join("input"),
        framebuffers: scratch.0.join("graphics"),
        minutes: scratch.0.join("screen-off-minutes"),
        console: scratch.0.join("active"),
    };
    for folder in [&paths.outputs, &paths.inputs, &paths.framebuffers] {
        fs::create_dir_all(folder).expect("folder");
    }
    paths
}

fn output(paths: &Paths, name: &str, status: &str) {
    let folder = paths.outputs.join(name);
    fs::create_dir_all(&folder).expect("output");
    fs::write(folder.join("status"), format!("{status}\n")).expect("status");
}

#[test]
fn shows_hides_and_puts_the_screen_in_standby_as_the_monitor_and_the_hands_say() {
    use State::*;
    let limit = 10 * MINUTE;
    let now = Duration::ZERO;
    assert_eq!(next(Dark, false, now, limit), (Dark, None));
    assert_eq!(next(Dark, true, now, limit), (Showing, Some(Step::Show)));
    assert_eq!(next(Showing, true, MINUTE, limit), (Showing, None));
    assert_eq!(
        next(Showing, true, limit, limit),
        (Standby, Some(Step::Sleep))
    );
    assert_eq!(
        next(Showing, false, MINUTE, limit),
        (Dark, Some(Step::Hide))
    );
    assert_eq!(next(Standby, true, 11 * MINUTE, limit), (Standby, None));
    assert_eq!(next(Standby, true, now, limit), (Showing, Some(Step::Wake)));
    assert_eq!(next(Standby, false, now, limit), (Dark, Some(Step::Hide)));
}

#[test]
fn sees_a_monitor_on_any_output_but_a_writeback() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    assert!(!connected(&paths.outputs));
    assert!(!connected(&scratch.0.join("nowhere")));

    output(&paths, "card0-HDMI-A-1", "disconnected");
    output(&paths, "card0-Writeback-1", "connected");
    output(&paths, "version", "connected");
    assert!(!connected(&paths.outputs));

    output(&paths, "card0-DP-2", "connected");
    assert!(connected(&paths.outputs));
}

#[test]
fn draws_only_while_its_console_is_in_front() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    assert!(in_front(&paths.console));
    fs::write(&paths.console, "tty1\n").expect("console");
    assert!(in_front(&paths.console));
    fs::write(&paths.console, "tty2\n").expect("console");
    assert!(!in_front(&paths.console));
}

#[test]
fn reads_the_minutes_of_the_settings_within_their_bounds() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    assert_eq!(limit(&paths.minutes), 10 * MINUTE);
    for (written, minutes) in [
        ("5\n", 5),
        ("240", 240),
        ("0", 10),
        ("999", 10),
        ("soon", 10),
    ] {
        fs::write(&paths.minutes, written).expect("minutes");
        assert_eq!(limit(&paths.minutes), minutes * MINUTE, "{written}");
    }
}

#[test]
fn powers_the_framebuffers_down_and_up_again() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    fs::create_dir_all(paths.framebuffers.join("fb0")).expect("framebuffer");
    fs::create_dir_all(paths.framebuffers.join("fbcon")).expect("console");
    fs::write(paths.framebuffers.join("fb0/blank"), "0").expect("blank");

    blank(&paths.framebuffers, true);
    assert_eq!(
        fs::read_to_string(paths.framebuffers.join("fb0/blank")).expect("blank"),
        "4"
    );
    blank(&paths.framebuffers, false);
    assert_eq!(
        fs::read_to_string(paths.framebuffers.join("fb0/blank")).expect("blank"),
        "0"
    );
    blank(&scratch.0.join("nowhere"), true);
}

#[test]
fn counts_any_event_of_an_input_device_as_a_touch() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    let start = Instant::now();
    let activity = Activity::new(start - 5 * MINUTE);
    let reading = Arc::new(Mutex::new(HashSet::new()));
    fs::write(paths.inputs.join("event0"), [1_u8; EVENT_SIZE]).expect("event");
    fs::write(paths.inputs.join("mice"), [1_u8; EVENT_SIZE]).expect("not an event device");

    watch_inputs(&paths.inputs, &activity, &reading);
    for _ in 0..200 {
        if activity.idle(Instant::now()) < MINUTE {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(activity.idle(Instant::now()) < MINUTE);
    watch_inputs(&scratch.0.join("nowhere"), &activity, &reading);
}

#[test]
fn ticks_through_a_monitor_coming_standby_waking_and_going() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    fs::write(&paths.minutes, "1").expect("minutes");
    let steps = Arc::new(Mutex::new(Vec::new()));
    let seen = steps.clone();
    let start = Instant::now();
    let mut screen = Screen::new(paths.clone(), start, move |step| {
        seen.lock().expect("steps").push(step);
    });

    assert_eq!(screen.tick(start), None);
    output(&paths, "card0-HDMI-A-1", "connected");
    assert_eq!(screen.tick(start + 5 * MINUTE), Some(Step::Show));
    assert_eq!(
        screen.tick(start + 5 * MINUTE + Duration::from_secs(30)),
        None
    );
    assert_eq!(screen.tick(start + 6 * MINUTE), Some(Step::Sleep));
    assert_eq!(screen.state(), State::Standby);
    screen.activity().touch(start + 7 * MINUTE);
    assert_eq!(screen.tick(start + 7 * MINUTE), Some(Step::Wake));
    output(&paths, "card0-HDMI-A-1", "disconnected");
    assert_eq!(screen.tick(start + 8 * MINUTE), Some(Step::Hide));
    assert_eq!(
        *steps.lock().expect("steps"),
        [Step::Show, Step::Sleep, Step::Wake, Step::Hide]
    );
}

#[test]
fn leaves_the_screen_to_the_text_console_and_takes_it_back() {
    let scratch = Scratch::new();
    let paths = machine(&scratch);
    output(&paths, "card0-HDMI-A-1", "connected");
    fs::write(&paths.console, "tty1\n").expect("console");
    let start = Instant::now();
    let mut screen = Screen::new(paths.clone(), start, |_| {});

    assert_eq!(screen.tick(start), Some(Step::Show));
    fs::write(&paths.console, "tty2\n").expect("Ctrl+Alt+F2");
    assert_eq!(screen.tick(start + MINUTE), Some(Step::Hide));
    assert_eq!(screen.tick(start + 30 * MINUTE), None);
    fs::write(&paths.console, "tty1\n").expect("Ctrl+Alt+F1");
    assert_eq!(screen.tick(start + 31 * MINUTE), Some(Step::Show));
    assert_eq!(screen.tick(start + 42 * MINUTE), Some(Step::Sleep));
    fs::write(&paths.console, "tty3\n").expect("Ctrl+Alt+F3 in standby");
    assert_eq!(screen.tick(start + 43 * MINUTE), Some(Step::Hide));
    assert_eq!(screen.state(), State::Dark);
}
