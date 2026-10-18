use super::*;
use crate::support::Scratch;
use axum::body::to_bytes;

fn root() -> Scratch {
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("index.html"), "<main>wizard</main>").expect("index");
    std::fs::create_dir_all(scratch.0.join("assets")).expect("assets");
    std::fs::write(scratch.0.join("assets/app.js"), "run()").expect("script");
    scratch
}

async fn body(response: Response) -> String {
    String::from_utf8_lossy(&to_bytes(response.into_body(), 1024).await.expect("body")).into_owned()
}

#[tokio::test]
async fn a_route_of_the_page_is_its_index_and_an_asset_is_itself() {
    let scratch = root();

    let page = serve(&scratch.0, &Method::GET, "/token").await;
    assert_eq!(page.status(), StatusCode::OK);
    assert_eq!(page.headers()[header::CACHE_CONTROL], "no-cache");
    assert_eq!(body(page).await, "<main>wizard</main>");

    let script = serve(&scratch.0, &Method::GET, "/assets/app.js").await;
    assert_eq!(
        script.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    assert_eq!(body(script).await, "run()");
}

#[tokio::test]
async fn nothing_outside_the_directory_or_missing_is_served() {
    let scratch = root();

    for path in ["/../secret", "/assets/missing.js"] {
        let response = serve(&scratch.0, &Method::GET, path).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
    let posted = serve(&scratch.0, &Method::POST, "/").await;
    assert_eq!(posted.status(), StatusCode::METHOD_NOT_ALLOWED);
}
