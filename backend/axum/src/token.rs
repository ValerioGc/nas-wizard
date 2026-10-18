//! Whether a token reads the releases the wizard has to download, repository by repository, so
//! the page can tell a mistyped token from one without permissions before anything is installed.

use crate::{
    account,
    config::Config,
    forge::{self, ForgeFailure},
    http::error::ApiFailure,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Ok,
    /// 401: the token is wrong or expired
    Refused,
    /// 403: the token has no permission there
    Forbidden,
    /// 404: no release, or a repository the token cannot see
    Missing,
    /// The forge did not answer
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepositoryAccess {
    pub repository: String,
    pub access: Access,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenProbe {
    #[serde(default)]
    pub token: Option<String>,
}

pub async fn check(
    config: &Config,
    probe: TokenProbe,
) -> Result<Vec<RepositoryAccess>, ApiFailure> {
    let token = probe
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty());
    if token.is_some_and(|token| !account::is_token(token)) {
        return Err(ApiFailure::bad("that does not look like a token"));
    }

    let mut answers = Vec::new();
    for repository in [&config.gateway_repository, &config.ui_repository] {
        let access = match forge::latest(config, repository, token).await {
            Ok(_) => Access::Ok,
            Err(ForgeFailure::Refused) => Access::Refused,
            Err(ForgeFailure::Forbidden) => Access::Forbidden,
            Err(ForgeFailure::Missing) => Access::Missing,
            Err(ForgeFailure::Unreachable(_)) => Access::Unreachable,
        };
        answers.push(RepositoryAccess {
            repository: repository.clone(),
            access,
        });
    }
    Ok(answers)
}
