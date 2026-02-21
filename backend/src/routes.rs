use axum::{
    extract::{Path, Query, State},
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

#[derive(Serialize)]
pub struct PublicListResponse {
    pub drawings: Vec<PublicDrawingMeta>,
}

#[derive(Serialize)]
pub struct PublicDrawingMeta {
    pub id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub source_path: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct UploadRequest {
    #[serde(flatten)]
    pub data: serde_json::Value,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

// ──────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────

pub async fn upload_drawing(
    State(state): State<AppState>,
    Json(body): Json<UploadRequest>,
) -> Result<(StatusCode, Json<UploadResponse>), AppError> {
    let doc_type = body
        .data
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if doc_type != "excalidraw" {
        return Err(AppError::BadRequest(
            "Invalid document: missing or wrong 'type' field. Expected 'excalidraw'.".into(),
        ));
    }

    if !body.data.get("elements").map_or(false, |v| v.is_array()) {
        return Err(AppError::BadRequest(
            "Invalid document: missing 'elements' array.".into(),
        ));
    }

    let mut is_update = false;
    let mut id = if let Some(req_id) = body.id {
        // Only allow using a specific ID if the user wants to update an existing drawing
        is_update = true;
        req_id
    } else {
        let new_id = Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("unknown")
            .to_string();

        // Ensure uniqueness for new IDs
        if state.storage.exists(&new_id).await? {
            Uuid::new_v4().to_string().replace('-', "")[..12].to_string()
        } else {
            new_id
        }
    };

    state.storage.save(&id, &body.data, body.source_path.as_deref()).await?;

    let url = format!("{}/d/{}", state.base_url.trim_end_matches('/'), id);

    if is_update {
        tracing::info!(id = %id, source_path = ?body.source_path, "Drawing updated");
    } else {
        tracing::info!(id = %id, source_path = ?body.source_path, "Drawing uploaded");
    }

    Ok((
        if is_update { StatusCode::OK } else { StatusCode::CREATED },
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

pub async fn list_drawings_public(
    State(state): State<AppState>,
) -> Result<Json<PublicListResponse>, AppError> {
    let drawings = state.storage.list().await?;
    let public_drawings: Vec<PublicDrawingMeta> = drawings
        .into_iter()
        .map(|d| PublicDrawingMeta {
            id: d.id,
            created_at: d.created_at,
            source_path: d.source_path,
        })
        .collect();
    Ok(Json(PublicListResponse { drawings: public_drawings }))
}

pub async fn health() -> &'static str {
    "ok"
}
