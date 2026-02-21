use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Drawing not found")]
    NotFound,

    #[error("Unauthorized: invalid or missing API key")]
    Unauthorized,

    #[error("Invalid input: {0}")]
    BadRequest(String),

    #[error("Payload too large")]
    PayloadTooLarge,

    #[error("Storage error: {0}")]
    Storage(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;

        let (status, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::PayloadTooLarge => (StatusCode::PAYLOAD_TOO_LARGE, self.to_string()),
            AppError::Storage(e) => {
                tracing::error!("Storage error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
            AppError::Json(e) => {
                tracing::error!("JSON error: {e}");
                (StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}"))
            }
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
        };

        let body = axum::Json(ErrorResponse { error: message });
        (status, body).into_response()
    }
}
