use super::*;
use crate::support::{config, Scratch};
use axum::{
    body::{to_bytes, Body},
    http::header,
};
use tower::ServiceExt;

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    body: &str,
) -> (StatusCode, serde_json::Value) {
    let request = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
        .expect("request");
    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("body");
    (status, serde_json::from_slice(&bytes).unwrap_or_default())
}

fn app(scratch: &Scratch) -> Router {
    router(AppState::new(config("http://127.0.0.1:1", &scratch.0)))
}

#[tokio::test]
async fn the_root_redirects_to_setup_on_the_same_origin_without_caching() {
    let scratch = Scratch::new();
    let app = app(&scratch);
    for method in ["GET", "HEAD"] {
        for path in ["/", "/?setup"] {
            let response = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .method(method)
                        .uri(path)
                        .header(header::HOST, "localhost:8080")
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("response");

            assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
            assert_eq!(response.headers()[header::LOCATION], "/setup");
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        }
    }
    let (status, _) = call(&app, "POST", "/", "").await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn setup_serves_the_wizard_and_assets_and_api_keep_their_routes() {
    let scratch = Scratch::new();
    let index = "<html>wizard</html>";
    std::fs::write(scratch.0.join("index.html"), index).expect("index");
    std::fs::create_dir(scratch.0.join("assets")).expect("assets");
    std::fs::write(scratch.0.join("assets/app.js"), "run()").expect("script");
    let mut config = config("http://127.0.0.1:1", &scratch.0);
    config.ui_dir = Some(scratch.0.clone());
    let app = router(AppState::new(config));

    for (path, content, mime) in [
        ("/setup", index, "text/html; charset=utf-8"),
        ("/setup/", index, "text/html; charset=utf-8"),
        ("/assets/app.js", "run()", "text/javascript; charset=utf-8"),
    ] {
        let response = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri(path)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(response.headers()[header::CONTENT_TYPE], mime);
        assert!(!response.headers().contains_key(header::LOCATION));
        let bytes = to_bytes(response.into_body(), 1024).await.expect("body");
        assert_eq!(bytes.as_ref(), content.as_bytes());
    }
    let (status, body) = call(&app, "GET", "/api/wizard", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["phase"], "collecting");
    let (status, _) = call(&app, "GET", "/api/setup", "").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn the_page_reads_where_the_wizard_is_and_never_a_secret() {
    let scratch = Scratch::new();
    let (status, body) = call(&app(&scratch), "GET", "/api/wizard", "").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["phase"], "collecting");
    assert_eq!(body["simulated"], true);
    assert!(body.get("tokenGiven").is_none());
    assert_eq!(body["steps"].as_array().expect("steps").len(), 10);
    assert!(!body.to_string().contains("password"));
}

#[tokio::test]
async fn the_certificates_are_offered_and_the_end_confirmed_only_at_the_end() {
    let scratch = Scratch::new();
    let app = app(&scratch);

    let (status, _) = call(&app, "GET", "/api/wizard/certificate", "").await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(&app, "POST", "/api/wizard/finish", "").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn the_nas_is_not_there_while_the_wizard_answers() {
    let scratch = Scratch::new();
    let (status, body) = call(&app(&scratch), "GET", "/api/setup", "").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body["error"].as_str().expect("error").contains("wizard"));
    let (status, _) = call(&app(&scratch), "GET", "/api/unknown", "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn every_request_is_checked_before_it_is_kept() {
    let scratch = Scratch::new();
    let app = app(&scratch);

    let (status, body) = call(
        &app,
        "POST",
        "/api/wizard/install",
        r#"{"username":"owner","password":"long enough","language":"fr","theme":"dark"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]
        .as_str()
        .expect("error")
        .contains("unknown variant"));

    let (status, _) = call(
        &app,
        "POST",
        "/api/wizard/token",
        r#"{"token":"two words"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(&app, "POST", "/api/wizard/network/wifi", r#"{"ssid":""}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(&app, "POST", "/api/wizard/retry", "").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn the_token_check_says_how_each_repository_answered() {
    let scratch = Scratch::new();
    let (status, body) = call(&app(&scratch), "POST", "/api/wizard/token", "{}").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["repository"], "owner/gateway");
    assert_eq!(body[0]["access"], "unreachable");
    assert_eq!(body[1]["repository"], "owner/ui");
}

#[tokio::test]
async fn a_name_of_the_nas_that_cannot_be_a_hostname_is_refused() {
    let scratch = Scratch::new();
    let (status, body) = call(
        &app(&scratch),
        "POST",
        "/api/wizard/install",
        r#"{"username":"owner","password":"long enough","language":"it","theme":"system","nasName":"the attic"}"#,
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]
        .as_str()
        .expect("error")
        .contains("name of the NAS"));
}

#[tokio::test]
async fn an_installation_is_accepted_and_runs_on_its_own() {
    let scratch = Scratch::new();
    let (status, body) = call(
        &app(&scratch),
        "POST",
        "/api/wizard/install",
        r#"{"username":"owner","password":"long enough","language":"it","theme":"system"}"#,
    )
    .await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["phase"], "installing");
}

#[tokio::test]
async fn the_wizard_refuses_device_and_mtls_settings_even_from_an_old_client() {
    let scratch = Scratch::new();
    let app = app(&scratch);
    for (field, value) in [
        ("mtls", serde_json::json!(true)),
        ("deviceName", serde_json::json!("Notebook")),
        ("deviceIcon", serde_json::json!("laptop")),
    ] {
        let mut configuration = serde_json::json!({
            "username": "owner", "password": "long enough", "language": "it", "theme": "system"
        });
        configuration[field] = value;
        let (status, body) = call(
            &app,
            "POST",
            "/api/wizard/install",
            &configuration.to_string(),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body["error"]
            .as_str()
            .expect("error")
            .contains("unknown field"));
        let (_, state) = call(&app, "GET", "/api/wizard", "").await;
        assert_eq!(state["phase"], "collecting");
    }
}
