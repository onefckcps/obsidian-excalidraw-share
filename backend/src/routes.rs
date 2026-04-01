use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::collab::{SessionInfo, SessionManager};
use crate::error::AppError;
use crate::storage::{DrawingMeta, DrawingStorage, FileSystemStorage};

#[derive(Clone)]
pub struct AppState {
    pub storage: FileSystemStorage,
    pub base_url: String,
    pub session_manager: SessionManager,
}


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

#[derive(Deserialize)]
pub struct UploadRequest {
    #[serde(flatten)]
    pub data: serde_json::Value,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

// ──────────────────────────────────────────────
// Collab Request / Response types
// ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StartCollabRequest {
    pub drawing_id: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 {
    7200 // 2 hours
}

#[derive(Serialize)]
pub struct StartCollabResponse {
    pub session_id: String,
    pub ws_url: String,
}

#[derive(Deserialize)]
pub struct StopCollabRequest {
    pub session_id: String,
    #[serde(default)]
    pub save: bool,
}

#[derive(Serialize)]
pub struct StopCollabResponse {
    pub saved: bool,
}

#[derive(Serialize)]
pub struct CollabStatusResponse {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participant_count: Option<usize>,
}

#[derive(Serialize)]
pub struct CollabSessionsResponse {
    pub sessions: Vec<SessionInfo>,
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
    let id = if let Some(req_id) = body.id {
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
) -> Json<PublicListResponse> {
    let drawings = state.storage.list().await.unwrap();
    let public_drawings: Vec<PublicDrawingMeta> = drawings
        .into_iter()
        .map(|d| PublicDrawingMeta {
            id: d.id,
            created_at: d.created_at,
            source_path: d.source_path,
        })
        .collect();
    Json(PublicListResponse { drawings: public_drawings })
}

pub async fn health() -> &'static str {
    "ok"
}

// ──────────────────────────────────────────────
// Collab Handlers
// ──────────────────────────────────────────────

/// Start a new collab session for a drawing (auth required).
pub async fn start_collab(
    State(state): State<AppState>,
    Json(body): Json<StartCollabRequest>,
) -> Result<(StatusCode, Json<StartCollabResponse>), AppError> {
    // Verify the drawing exists
    let drawing_data = state.storage.load(&body.drawing_id).await?;

    let session_id = state
        .session_manager
        .create_session(&body.drawing_id, &drawing_data, body.timeout_secs)
        .await?;

    let base = state.base_url.trim_end_matches('/');
    let ws_scheme = if base.starts_with("https") {
        "wss"
    } else {
        "ws"
    };
    let host = base
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let ws_url = format!("{ws_scheme}://{host}/ws/collab/{session_id}");

    tracing::info!(
        drawing_id = %body.drawing_id,
        session_id = %session_id,
        "Collab session started"
    );

    Ok((
        StatusCode::CREATED,
        Json(StartCollabResponse { session_id, ws_url }),
    ))
}

/// Stop a collab session, optionally saving changes (auth required).
pub async fn stop_collab(
    State(state): State<AppState>,
    Json(body): Json<StopCollabRequest>,
) -> Result<Json<StopCollabResponse>, AppError> {
    let result = state
        .session_manager
        .end_session(&body.session_id, body.save)
        .await?;

    if let Some((drawing_id, data)) = result {
        // Preserve the existing source_path from the stored drawing
        // (collab session data doesn't include _source_path)
        let source_path = match state.storage.load(&drawing_id).await {
            Ok(existing) => existing
                .get("_source_path")
                .and_then(|v| v.as_str())
                .map(String::from),
            Err(_) => None,
        };

        state
            .storage
            .save(&drawing_id, &data, source_path.as_deref())
            .await?;

        tracing::info!(
            drawing_id = %drawing_id,
            "Collab session changes saved to storage"
        );
    }

    Ok(Json(StopCollabResponse { saved: body.save }))
}

/// Get collab status for a drawing (public).
pub async fn collab_status(
    State(state): State<AppState>,
    Path(drawing_id): Path<String>,
) -> Json<CollabStatusResponse> {
    match state.session_manager.get_session_status(&drawing_id).await {
        Some((session_id, participant_count)) => Json(CollabStatusResponse {
            active: true,
            session_id: Some(session_id),
            participant_count: Some(participant_count),
        }),
        None => Json(CollabStatusResponse {
            active: false,
            session_id: None,
            participant_count: None,
        }),
    }
}

/// List all active collab sessions (auth required, for admin).
pub async fn list_collab_sessions(
    State(state): State<AppState>,
) -> Json<CollabSessionsResponse> {
    let sessions = state.session_manager.list_sessions().await;
    Json(CollabSessionsResponse { sessions })
}
