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
    pub persistent_collab: bool,
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
    pub persistent: bool,
}

#[derive(Serialize)]
pub struct CollabSessionsResponse {
    pub sessions: Vec<SessionInfo>,
}

// ──────────────────────────────────────────────
// Persistent Collab Request / Response types
// ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EnablePersistentCollabRequest {
    pub drawing_id: String,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Serialize)]
pub struct EnablePersistentCollabResponse {
    pub enabled: bool,
    pub drawing_id: String,
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct DisablePersistentCollabRequest {
    pub drawing_id: String,
}

#[derive(Serialize)]
pub struct DisablePersistentCollabResponse {
    pub disabled: bool,
    pub drawing_id: String,
}

#[derive(Serialize)]
pub struct ActivatePersistentCollabResponse {
    pub session_id: String,
    pub password_required: bool,
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

    // Extract persistent collab info before stripping
    let persistent_collab = response_data.get("_persistent_collab")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let persistent_version = response_data.get("_persistent_collab_version")
        .and_then(|v| v.as_u64());

    if let Some(obj) = response_data.as_object_mut() {
        obj.remove("_password_hash");
        obj.remove("_source_path");
        obj.remove("_persistent_collab");
        obj.remove("_persistent_collab_version");
        obj.remove("_persistent_collab_password_hash");

        // Expose persistent collab info (without underscore prefix)
        if persistent_collab {
            obj.insert("persistent_collab".to_string(), serde_json::Value::Bool(true));
            if let Some(v) = persistent_version {
                obj.insert("persistent_collab_version".to_string(), serde_json::json!(v));
            }
        }
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
            persistent_collab: d.persistent_collab,
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
    let (active, session_id, participant_count, password_required, persistent) =
        state.session_manager.get_session_status_extended(&drawing_id).await;

    if active {
        Json(CollabStatusResponse {
            active: true,
            session_id,
            participant_count: Some(participant_count),
            password_required: Some(password_required),
            persistent,
        })
    } else {
        Json(CollabStatusResponse {
            active: false,
            session_id: None,
            participant_count: None,
            password_required: None,
            persistent,
        })
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

// ──────────────────────────────────────────────
// Persistent Collab Handlers
// ──────────────────────────────────────────────

/// Enable persistent collab for a drawing (auth required).
/// Creates a persistent session that auto-saves and survives server restarts.
pub async fn enable_persistent_collab(
    State(state): State<AppState>,
    Json(body): Json<EnablePersistentCollabRequest>,
) -> Result<(StatusCode, Json<EnablePersistentCollabResponse>), AppError> {
    // 1. Verify drawing exists
    let drawing_data = state.storage.load(&body.drawing_id).await?;

    // 2. Hash password if provided
    let password_hash = match &body.password {
        Some(pw) if !pw.is_empty() => {
            let hash = password::hash_password(pw)
                .map_err(|e| AppError::Internal(format!("Failed to hash password: {e}")))?;
            Some(hash)
        }
        _ => None,
    };

    // 3. Update drawing JSON: set _persistent_collab = true, store password hash
    let mut data = drawing_data.clone();
    if let Some(obj) = data.as_object_mut() {
        obj.insert("_persistent_collab".to_string(), serde_json::Value::Bool(true));
        if let Some(ph) = &password_hash {
            obj.insert(
                "_persistent_collab_password_hash".to_string(),
                serde_json::Value::String(ph.clone()),
            );
        } else {
            obj.remove("_persistent_collab_password_hash");
        }
        if !obj.contains_key("_persistent_collab_version") {
            obj.insert("_persistent_collab_version".to_string(), serde_json::json!(0));
        }
    }

    // 4. Save updated drawing (preserve source_path and password_hash)
    let source_path = data.get("_source_path").and_then(|v| v.as_str()).map(String::from);
    let pw_hash = data.get("_password_hash").and_then(|v| v.as_str()).map(String::from);
    state.storage.save(&body.drawing_id, &data, source_path.as_deref(), pw_hash.as_deref()).await?;

    // 5. Register in session manager
    state.session_manager.register_persistent_drawing(body.drawing_id.clone()).await;

    // 6. Create persistent session (if not already active)
    let session_id = match state.session_manager.get_session_for_drawing(&body.drawing_id).await {
        Some(existing_id) => existing_id,
        None => {
            state.session_manager.create_persistent_session(
                &body.drawing_id, &drawing_data, password_hash,
            ).await?
        }
    };

    tracing::info!(drawing_id = %body.drawing_id, "Persistent collab enabled");

    Ok((StatusCode::OK, Json(EnablePersistentCollabResponse {
        enabled: true,
        drawing_id: body.drawing_id,
        session_id,
    })))
}

/// Disable persistent collab for a drawing (auth required).
/// Ends any active session (saving changes) and removes persistent collab metadata.
pub async fn disable_persistent_collab(
    State(state): State<AppState>,
    Json(body): Json<DisablePersistentCollabRequest>,
) -> Result<Json<DisablePersistentCollabResponse>, AppError> {
    // 1. End active session if exists (save to disk)
    if let Some(session_id) = state.session_manager.get_session_for_drawing(&body.drawing_id).await {
        let result = state.session_manager.end_session(&session_id, true).await;
        // Save session data to disk if end_session returned it
        if let Ok(Some((drawing_id, data))) = result {
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
            let _ = state.storage.save(
                &drawing_id, &data, source_path.as_deref(), password_hash.as_deref(),
            ).await;
        }
    }

    // 2. Remove _persistent_collab from drawing JSON
    let data = state.storage.load(&body.drawing_id).await?;
    let mut updated = data;
    if let Some(obj) = updated.as_object_mut() {
        obj.insert("_persistent_collab".to_string(), serde_json::Value::Bool(false));
        obj.remove("_persistent_collab_password_hash");
        obj.remove("_persistent_collab_version");
    }
    let source_path = updated.get("_source_path").and_then(|v| v.as_str()).map(String::from);
    let pw_hash = updated.get("_password_hash").and_then(|v| v.as_str()).map(String::from);
    state.storage.save(&body.drawing_id, &updated, source_path.as_deref(), pw_hash.as_deref()).await?;

    // 3. Unregister from session manager
    state.session_manager.unregister_persistent_drawing(&body.drawing_id).await;

    tracing::info!(drawing_id = %body.drawing_id, "Persistent collab disabled");

    Ok(Json(DisablePersistentCollabResponse {
        disabled: true,
        drawing_id: body.drawing_id,
    }))
}

/// Activate a persistent collab session on demand (public, no auth).
/// Creates the session if it doesn't exist yet (lazy activation).
/// Returns the session_id for WebSocket connection.
pub async fn activate_persistent_collab(
    State(state): State<AppState>,
    Path(drawing_id): Path<String>,
) -> Result<Json<ActivatePersistentCollabResponse>, AppError> {
    // 1. Check if session already exists
    if let Some(session_id) = state.session_manager.get_session_for_drawing(&drawing_id).await {
        let (active, _, _, pw_req, _) =
            state.session_manager.get_session_status_extended(&drawing_id).await;
        if active {
            return Ok(Json(ActivatePersistentCollabResponse {
                session_id,
                password_required: pw_req,
            }));
        }
    }

    // 2. Verify drawing has persistent collab enabled
    let has_persistent = state.storage.get_persistent_collab_status(&drawing_id).await?;
    if !has_persistent {
        return Err(AppError::NotFound);
    }

    // 3. Load drawing and create persistent session
    let drawing_data = state.storage.load(&drawing_id).await?;
    let password_hash = drawing_data.get("_persistent_collab_password_hash")
        .and_then(|v| v.as_str())
        .map(String::from);

    // Handle race condition: create_persistent_session may fail with SessionAlreadyExists
    // if two visitors arrive simultaneously
    let session_id = match state.session_manager.create_persistent_session(
        &drawing_id, &drawing_data, password_hash.clone(),
    ).await {
        Ok(id) => id,
        Err(AppError::SessionAlreadyExists) => {
            // Another request created the session concurrently — return the existing one
            state.session_manager.get_session_for_drawing(&drawing_id).await
                .ok_or(AppError::Internal("Race condition: session disappeared".to_string()))?
        }
        Err(e) => return Err(e),
    };

    tracing::info!(
        drawing_id = %drawing_id,
        session_id = %session_id,
        "Persistent collab session activated on demand"
    );

    Ok(Json(ActivatePersistentCollabResponse {
        session_id,
        password_required: password_hash.is_some(),
    }))
}
