use super::*;

#[test]
fn the_account_follows_the_rules_of_the_gateway() {
    assert!(valid("admin", "long enough"));
    assert!(valid("mario.rossi", "long enough"));
    assert!(!valid("ab", "long enough"));
    assert!(!valid("9lives", "long enough"));
    assert!(!valid("ad min", "long enough"));
    assert!(!valid("admin", "short"));
}

#[test]
fn the_user_of_the_terminal_is_the_account_name_as_the_system_accepts_it() {
    assert_eq!(os_user("Valerio").as_deref(), Some("valerio"));
    assert_eq!(os_user("mario.rossi").as_deref(), Some("mario_rossi"));
    assert_eq!(os_user("_ops-1").as_deref(), Some("_ops-1"));
    for refused in [
        "",
        "9lives",
        "-dash",
        "nas",
        "NAS-OS",
        "root",
        &"a".repeat(33),
    ] {
        assert!(os_user(refused).is_none(), "{refused}");
    }
}

#[tokio::test]
async fn names_of_the_machine_are_refused_before_anything_is_installed() {
    for name in ["nas", "root", "nobody"] {
        let refused = check(name, "long enough").await.expect_err(name);
        assert_eq!(refused.0, axum::http::StatusCode::BAD_REQUEST, "{name}");
    }
    assert!(check("admin", "short").await.is_err());
}

#[test]
fn a_token_is_one_word_of_printable_characters() {
    assert!(is_token(" ghp_abc123 "));
    assert!(!is_token(""));
    assert!(!is_token("two words"));
    assert!(!is_token(&"x".repeat(513)));
}

#[test]
fn a_name_of_the_nas_is_one_the_launcher_takes_as_a_hostname() {
    for good in ["nas", "attic", "nas-2", "N4S"] {
        assert!(is_nas_name(good), "{good}");
    }
    let too_long = "a".repeat(64);
    for bad in [
        "",
        "-nas",
        "nas-",
        "the attic",
        "nas.local",
        too_long.as_str(),
    ] {
        assert!(!is_nas_name(bad), "{bad}");
    }
}
