use super::*;

#[test]
fn a_colon_inside_a_name_stays_in_the_name() {
    assert_eq!(
        fields(r"*:Casa\:5G:70:WPA2"),
        ["*", "Casa:5G", "70", "WPA2"]
    );
}

#[test]
fn the_same_network_is_listed_once_with_its_strongest_reading() {
    let listed = " :Home:40:WPA2\n*:Home:80:WPA3\n :Cafe:60:\n :::\n";
    let networks = parse_scan(listed, &["Cafe".to_owned()]);

    assert_eq!(
        networks,
        [
            WifiNetwork {
                ssid: "Home".to_owned(),
                signal: 80,
                security: "WPA3".to_owned(),
                known: false,
            },
            WifiNetwork {
                ssid: "Cafe".to_owned(),
                signal: 60,
                security: "open".to_owned(),
                known: true,
            },
        ]
    );
}

#[test]
fn a_request_to_join_keeps_to_the_bounds_of_a_network() {
    let request = |ssid: &str, password: Option<&str>| WifiRequest {
        ssid: ssid.to_owned(),
        password: password.map(str::to_owned),
    };

    assert_eq!(
        checked(&request(" Home ", Some("long enough"))).expect("valid"),
        ("Home", Some("long enough"))
    );
    assert_eq!(
        checked(&request("Home", Some("  "))).expect("open"),
        ("Home", None)
    );
    assert!(checked(&request("", None)).is_err());
    assert!(checked(&request(&"x".repeat(33), None)).is_err());
    assert!(checked(&request("Home", Some("short"))).is_err());
}

#[tokio::test]
async fn no_network_is_joined_unless_the_wizard_is_real() {
    let refused = join(
        false,
        &WifiRequest {
            ssid: "Home".to_owned(),
            password: None,
        },
    )
    .await
    .expect_err("refused");

    assert_eq!(refused.0, axum::http::StatusCode::SERVICE_UNAVAILABLE);
    assert!(refused.1.contains("WIZARD_MODE"));
}

#[tokio::test]
async fn reads_the_network_of_the_machine_whatever_it_has() {
    let networks = state(false, false).await;

    assert!(!networks.can_connect);
    assert!(networks.connection.connected || networks.connection.ssid.is_none());
    match &networks.wifi_note {
        Some(note) => assert!(networks.wifi.is_empty() && !note.is_empty()),
        None => assert!(networks.wifi.iter().all(|network| !network.ssid.is_empty())),
    }
}
