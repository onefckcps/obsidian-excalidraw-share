use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::collab::{SessionInfo, SessionManager};
use crate::error::AppError;
use crate::password;
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
    pub password_protected: bool,
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
    pub password_protected: bool,
}

#[derive(Deserialize)]
pub struct UploadRequest {
    #[serde(flatten)]
    pub data: serde_json::Value,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    /// Optional password for the drawing. Empty string removes password.
    #[serde(default)]
    pub password: Option<String>,
}

// ──────────────────────────────────────────────
// Collab Request / Response types
// ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StartCollabRequest {
    pub drawing_id: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Optional password for the collab session
    #[serde(default)]
    pub password: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_required: Option<bool>,
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
        // Validate the ID format to prevent abuse
        let valid = !req_id.is_empty()
            && req_id.len() <= 64
            && req_id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_');
        if !valid {
            return Err(AppError::BadRequest(
                "Invalid ID: must be 1-64 alphanumeric characters, hyphens, or underscores.".into(),
            ));
        }
        is_update = true;
        req_id
    } else {
        let new_id = Uuid::new_v4()
            .to_string()
            .replace('-', "")
            .chars()
            .take(16)
            .collect::<String>();

        // Ensure uniqueness for new IDs
        if state.storage.exists(&new_id).await? {
            Uuid::new_v4()
                .to_string()
                .replace('-', "")
                .chars()
                .take(16)
                .collect::<String>()
        } else {
            new_id
        }
    };

    // Handle password: hash if provided, preserve existing if not specified on update
    let password_hash = match &body.password {
        Some(pw) if pw.is_empty() => None, // Empty string = remove password
        Some(pw) => {
            let hash = password::hash_password(pw)
                .map_err(|e| AppError::Internal(format!("Failed to hash password: {e}")))?;
            Some(hash)
        }
        None if is_update => {
            // Preserve existing password hash on update when no password field is sent
            state.storage.load(&id).await.ok()
                .and_then(|existing| existing.get("_password_hash")
                    .and_then(|v| v.as_str())
                    .map(String::from))
        }
        None => None,
    };

    state.storage.save(&id, &body.data, body.source_path.as_deref(), password_hash.as_deref()).await?;

    let url = format!("{}/d/{}", state.base_url.trim_end_matches('/'), id);
    let password_protected = password_hash.is_some();

    if is_update {
        tracing::info!(id = %id, source_path = ?body.source_path, password_protected, "Drawing updated");
    } else {
        tracing::info!(id = %id, source_path = ?body.source_path, password_protected, "Drawing uploaded");
    }

    Ok((
        if is_update { StatusCode::OK } else { StatusCode::CREATED },
        Json(UploadResponse { id, url, password_protected }),
    ))
}

#[derive(Deserialize)]
pub struct ViewQuery {
    #[serde(default)]
    pub key: Option<String>,
}

pub async fn get_drawing(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ViewQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.storage.load(&id).await?;

    // Check if drawing is password-protected
    let password_hash = data.get("_password_hash")
        .and_then(|v| v.as_str());

    if let Some(hash) = password_hash {
        match &query.key {
            None => return Err(AppError::PasswordRequired),
            Some(key) => {
                let valid = password::verify_password(key, hash)
                    .map_err(|e| AppError::Internal(format!("Password verification error: {e}")))?;
                if !valid {
                    return Err(AppError::InvalidPassword);
                }
            }
        }
    }

    // Strip internal metadata fields from the response
    let mut response_data = data;
    if let Some(obj) = response_data.as_object_mut() {
        obj.remove("_password_hash");
        obj.remove("_source_path");
    }

    Ok(Json(response_data))
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
            password_protected: d.password_protected,
        })
        .collect();
    Ok(Json(PublicListResponse { drawings: public_drawings }))
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

    // Clamp timeout to a reasonable range (5 min – 24 hours)
    const MIN_TIMEOUT: u64 = 300;
    const MAX_TIMEOUT: u64 = 86400;
    let timeout = body.timeout_secs.clamp(MIN_TIMEOUT, MAX_TIMEOUT);

    // Hash the collab password if provided
    let collab_password_hash = match &body.password {
        Some(pw) if !pw.is_empty() => {
            let hash = password::hash_password(pw)
                .map_err(|e| AppError::Internal(format!("Failed to hash password: {e}")))?;
            Some(hash)
        }
        _ => None,
    };

    let session_id = state
        .session_manager
        .create_session(&body.drawing_id, &drawing_data, timeout, collab_password_hash)
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
        // Preserve the existing source_path and password_hash from the stored drawing
        // (collab session data doesn't include _source_path or _password_hash)
        let (source_path, password_hash) = match state.storage.load(&drawing_id).await {
            Ok(existing) => (
                existing.get("_source_path")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                existing.get("_password_hash")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            ),
            Err(_) => (None, None),
        };

        state
            .storage
            .save(&drawing_id, &data, source_path.as_deref(), password_hash.as_deref())
            .await?;

        tracing::info!(
            drawing_id = %drawing_id,
            "Collab session changes saved to storage"
        );
    }

    Ok(Json(StopCollabResponse { saved: body.save }))
}

/// Get collab status for a drawing (public).
/// The session_id is exposed so the frontend viewer can join via WebSocket.
/// Security relies on session IDs being full 128-bit UUIDs (unguessable).
pub async fn collab_status(
    State(state): State<AppState>,
    Path(drawing_id): Path<String>,
) -> Json<CollabStatusResponse> {
    match state.session_manager.get_session_status(&drawing_id).await {
        Some((session_id, participant_count, password_required)) => Json(CollabStatusResponse {
            active: true,
            session_id: Some(session_id),
            participant_count: Some(participant_count),
            password_required: Some(password_required),
        }),
        None => Json(CollabStatusResponse {
            active: false,
            session_id: None,
            participant_count: None,
            password_required: None,
        }),
    }
}

#[derive(Deserialize)]
pub struct VerifyCollabPasswordRequest {
    pub session_id: String,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Serialize)]
pub struct VerifyCollabPasswordResponse {
    pub valid: bool,
}

/// Verify a collab session password (public, used before WebSocket connection).
pub async fn verify_collab_password(
    State(state): State<AppState>,
    Json(body): Json<VerifyCollabPasswordRequest>,
) -> Result<Json<VerifyCollabPasswordResponse>, AppError> {
    let valid = state
        .session_manager
        .verify_session_password(&body.session_id, body.password.as_deref())
        .await?;

    if !valid {
        return Err(if body.password.is_some() {
            AppError::InvalidPassword
        } else {
            AppError::PasswordRequired
        });
    }

    Ok(Json(VerifyCollabPasswordResponse { valid: true }))
}

/// List all active collab sessions (auth required, for admin).
pub async fn list_collab_sessions(
    State(state): State<AppState>,
) -> Json<CollabSessionsResponse> {
    let sessions = state.session_manager.list_sessions().await;
    Json(CollabSessionsResponse { sessions })
}
