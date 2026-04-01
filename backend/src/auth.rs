use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
    extract::State,
};
use subtle::ConstantTimeEq;

/// Wrapper type to store the API key in Axum state.
#[derive(Clone)]
pub struct ApiKey(pub String);

/// Middleware that validates the `Authorization: Bearer <key>` header
/// against the configured API key using constant-time comparison
/// to prevent timing attacks.
pub async fn api_key_middleware(
    State(api_key): State<ApiKey>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    match auth_header {
        Some(value) if value.starts_with("Bearer ") => {
            let token = value[7..].as_bytes();
            let key = api_key.0.as_bytes();
            // Constant-time comparison: prevents timing side-channel attacks.
            // Length check leaks key length but not content (acceptable trade-off).
            if token.len() == key.len() && token.ct_eq(key).into() {
                Ok(next.run(request).await)
            } else {
                tracing::warn!("Invalid API key attempt");
                Err(StatusCode::UNAUTHORIZED)
            }
        }
        _ => {
            tracing::warn!("Missing or malformed Authorization header");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}
