//! The routes of the wizard. Before the gateway there is no account and no session: like the setup
//! page of a router, the wizard answers whoever reaches it first, and only until it ends.

use crate::{
    http::{error::ApiFailure, extract::ValidJson, interface},
    installer, network,
    state::{AppState, Configuration, Offer, Snapshot},
    token::{self, RepositoryAccess, TokenProbe},
};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};

async fn wizard(State(state): State<AppState>) -> Json<Snapshot> {
    Json(state.current().await)
}

async fn scan(State(state): State<AppState>) -> Json<network::Networks> {
    Json(network::state(state.config.real, true).await)
}

async fn join_wifi(
    State(state): State<AppState>,
    ValidJson(request): ValidJson<network::WifiRequest>,
) -> Result<Json<network::Networks>, ApiFailure> {
    network::join(state.config.real, &request).await.map(Json)
}

async fn check_token(
    State(state): State<AppState>,
    ValidJson(probe): ValidJson<TokenProbe>,
) -> Result<Json<Vec<RepositoryAccess>>, ApiFailure> {
    token::check(&state.config, probe).await.map(Json)
}

async fn install(
    State(state): State<AppState>,
    ValidJson(input): ValidJson<Configuration>,
) -> Result<(StatusCode, Json<Snapshot>), ApiFailure> {
    installer::start(&state, input)
        .await
        .map(|snapshot| (StatusCode::ACCEPTED, Json(snapshot)))
}

/// The HTTPS authority of the NAS, at the end only.
async fn certificate(State(state): State<AppState>) -> Result<Json<Offer>, ApiFailure> {
    installer::offer(&state).await.map(Json)
}

/// The certificates were taken: the wizard hands over to the gateway.
async fn finish(State(state): State<AppState>) -> Result<Json<Snapshot>, ApiFailure> {
    installer::finish(&state).await.map(Json)
}

async fn retry(State(state): State<AppState>) -> Result<(StatusCode, Json<Snapshot>), ApiFailure> {
    installer::retry(&state)
        .await
        .map(|snapshot| (StatusCode::ACCEPTED, Json(snapshot)))
}

/// The route the interface of the NAS asks once the gateway has taken the port: while the wizard
/// answers it, the NAS is not there yet.
async fn setup() -> ApiFailure {
    ApiFailure::unavailable("the wizard is still configuring the NAS")
}

async fn not_found() -> ApiFailure {
    ApiFailure(StatusCode::NOT_FOUND, "no such route".to_owned())
}

/// Keep the browser's origin, including a forwarded port, and do not cache setup across handover.
async fn setup_page() -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Redirect::temporary("/setup"),
    )
}

async fn page(State(state): State<AppState>, request: Request) -> Response {
    match &state.config.ui_dir {
        Some(root) => interface::serve(root, request.method(), request.uri().path()).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/wizard", get(wizard))
        .route("/wizard/network/scan", post(scan))
        .route("/wizard/network/wifi", post(join_wifi))
        .route("/wizard/token", post(check_token))
        .route("/wizard/install", post(install))
        .route("/wizard/retry", post(retry))
        .route("/wizard/certificate", get(certificate))
        .route("/wizard/finish", post(finish))
        .route("/setup", get(setup))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(4096));
    Router::new()
        .route("/", get(setup_page))
        .route("/setup", get(page))
        .nest("/api", api)
        .fallback(page)
        .with_state(state)
}

#[cfg(test)]
#[path = "../../../tests/http/routes.rs"]
mod tests;
