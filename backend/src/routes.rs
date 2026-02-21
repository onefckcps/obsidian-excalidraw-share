use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::storage::{DrawingMeta, DrawingStorage, FileSystemStorage};

#[derive(Clone)]
pub struct AppState {
    pub storage: FileSystemStorage,
    pub base_url: String,
}

type Storage = FileSystemStorage;

// ──────────────────────────────────────────────
// Request / Response types
// ──────────────────────────────────────────────

#[derive(Serialize)]
pub struct UploadResponse {
    pub id: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct ListResponse {
    pub drawings: Vec<DrawingMeta>,
}

// ──────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────

pub async fn upload_drawing(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<UploadResponse>), AppError> {
    let doc_type = body
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if doc_type != "excalidraw" {
        return Err(AppError::BadRequest(
            "Invalid document: missing or wrong 'type' field. Expected 'excalidraw'.".into(),
        ));
    }

    if !body.get("elements").map_or(false, |v| v.is_array()) {
        return Err(AppError::BadRequest(
            "Invalid document: missing 'elements' array.".into(),
        ));
    }

    let mut id = Uuid::new_v4()
        .to_string()
        .split('-')
        .next()
        .unwrap_or("unknown")
        .to_string();

    // Ensure uniqueness
    if state.storage.exists(&id).await? {
        id = Uuid::new_v4().to_string().replace('-', "")[..12].to_string();
    }

    state.storage.save(&id, &body).await?;

    let url = format!("{}/d/{}", state.base_url.trim_end_matches('/'), id);

    tracing::info!(id = %id, "Drawing uploaded");

    Ok((
        StatusCode::CREATED,
        Json(UploadResponse { id, url }),
    ))
}

pub async fn get_drawing(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.storage.load(&id).await?;
    Ok(Json(data))
}

pub async fn delete_drawing(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.storage.delete(&id).await?;
    tracing::info!(id = %id, "Drawing deleted");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_drawings(
    State(state): State<AppState>,
) -> Result<Json<ListResponse>, AppError> {
    let drawings = state.storage.list().await?;
    Ok(Json(ListResponse { drawings }))
}

pub async fn health() -> &'static str {
    "ok"
}
