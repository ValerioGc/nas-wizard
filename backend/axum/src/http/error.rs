use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;

/// Body shared by every failed response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ApiError {
    pub error: String,
}

/// Typed failure of a handler or of a service.
#[derive(Debug, PartialEq, Eq)]
pub struct ApiFailure(pub StatusCode, pub String);

impl ApiFailure {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self(StatusCode::CONFLICT, message.into())
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self(StatusCode::SERVICE_UNAVAILABLE, message.into())
    }
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> axum::response::Response {
        (self.0, Json(ApiError { error: self.1 })).into_response()
    }
}
