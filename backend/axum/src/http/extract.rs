//! JSON extraction that preserves serde validation errors in the API error format.

use crate::http::error::ApiFailure;
use axum::{
    extract::{rejection::JsonRejection, FromRequest, Request},
    Json,
};
use serde::de::DeserializeOwned;

pub struct ValidJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiFailure;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(ValidJson(value)),
            Err(rejection) => Err(ApiFailure::bad(describe(&rejection))),
        }
    }
}

fn describe(rejection: &JsonRejection) -> String {
    match rejection {
        JsonRejection::JsonDataError(error) => {
            let text = error.body_text();
            text.split_once(": ")
                .map(|(_, detail)| detail.to_owned())
                .unwrap_or(text)
        }
        JsonRejection::JsonSyntaxError(_) => "malformed JSON body".to_owned(),
        JsonRejection::MissingJsonContentType(_) => "application/json required".to_owned(),
        _ => "invalid request body".to_owned(),
    }
}
