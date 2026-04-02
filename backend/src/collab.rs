use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

use crate::error::AppError;
use crate::storage::DrawingStorage;

// ──────────────────────────────────────────────
// WebSocket message types
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    SceneUpdate {
        elements: serde_json::Value,
    },
    SceneDelta {
        elements: serde_json::Value,
        seq: u64,
    },
    PointerUpdate {
        x: f64,
        y: f64,
        button: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool: Option<String>,
        #[serde(rename = "scrollX")]
        scroll_x: Option<f64>,
        #[serde(rename = "scrollY")]
        scroll_y: Option<f64>,
        zoom: Option<f64>,
    },
    SetName {
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Snapshot {
        elements: serde_json::Value,
        #[serde(rename = "appState")]
        app_state: serde_json::Value,
        files: serde_json::Value,
        collaborators: Vec<CollaboratorInfo>,
    },
    SceneUpdate {
        elements: serde_json::Value,
        from: String,
    },
    SceneDelta {
        elements: serde_json::Value,
        from: String,
        seq: u64,
    },
    FullSync {
        elements: serde_json::Value,
        #[serde(rename = "appState")]
        app_state: serde_json::Value,
        files: serde_json::Value,
        seq: u64,
    },
    PointerUpdate {
        x: f64,
        y: f64,
        button: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool: Option<String>,
        #[serde(rename = "userId")]
        user_id: String,
        name: String,
        #[serde(rename = "colorIndex")]
        color_index: u8,
        #[serde(rename = "scrollX", skip_serializing_if = "Option::is_none")]
        scroll_x: Option<f64>,
        #[serde(rename = "scrollY", skip_serializing_if = "Option::is_none")]
        scroll_y: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        zoom: Option<f64>,
    },
    UserJoined {
        #[serde(rename = "userId")]
        user_id: String,
        name: String,
        collaborators: Vec<CollaboratorInfo>,
    },
    UserLeft {
        #[serde(rename = "userId")]
        user_id: String,
        name: String,
        collaborators: Vec<CollaboratorInfo>,
    },
    SessionEnded {
        saved: bool,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollaboratorInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "colorIndex")]
    pub color_index: u8,
}

// ──────────────────────────────────────────────
// Session types
// ──────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Participant {
    pub user_id: String,
    pub name: String,
    pub color_index: u8,
}

#[derive(Debug)]
pub struct CollabSession {
    pub session_id: String,
    pub drawing_id: String,
    pub created_at: DateTime<Utc>,
    pub timeout_secs: u64,
    /// Indexed element storage: id -> element JSON
    pub element_map: HashMap<String, serde_json::Value>,
    /// Insertion order of element IDs
    pub element_order: Vec<String>,
    /// Monotonically increasing sequence number for delta tracking
    pub scene_seq: u64,
    /// Original appState from the drawing
    pub app_state: serde_json::Value,
    /// Original files from the drawing
    pub files: serde_json::Value,
    /// Connected participants
    pub participants: HashMap<String, Participant>,
    /// Next color index to assign to a new participant
    pub next_color_index: u8,
    /// Broadcast channel for sending messages to all connected clients
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
    /// Optional password hash for session access control
    pub password_hash: Option<String>,
}

impl CollabSession {
    pub fn collaborator_list(&self) -> Vec<CollaboratorInfo> {
        self.participants
            .values()
            .map(|p| CollaboratorInfo {
                id: p.user_id.clone(),
                name: p.name.clone(),
                color_index: p.color_index,
            })
            .collect()
    }

    /// Reconstruct the elements array from the indexed structure.
    pub fn elements_as_array(&self) -> serde_json::Value {
        let elements: Vec<serde_json::Value> = self
            .element_order
            .iter()
            .filter_map(|id| self.element_map.get(id).cloned())
            .collect();
        serde_json::Value::Array(elements)
    }
}

/// Parse an elements JSON array into an indexed (element_map, element_order) pair.
fn parse_elements_into_map(
    elements: &serde_json::Value,
) -> (HashMap<String, serde_json::Value>, Vec<String>) {
    let mut element_map = HashMap::new();
    let mut element_order = Vec::new();

    if let Some(arr) = elements.as_array() {
        for el in arr {
            if let Some(id) = el.get("id").and_then(|v| v.as_str()) {
                element_map.insert(id.to_string(), el.clone());
                element_order.push(id.to_string());
            }
        }
    }

    (element_map, element_order)
}

/// Admin-facing session info (serializable)
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub drawing_id: String,
    pub created_at: DateTime<Utc>,
    pub participant_count: usize,
    pub participants: Vec<CollaboratorInfo>,
    pub password_required: bool,
}

// ──────────────────────────────────────────────
// Session Manager
// ──────────────────────────────────────────────

#[derive(Clone)]
pub struct SessionManager {
    /// session_id -> CollabSession
    sessions: Arc<RwLock<HashMap<String, CollabSession>>>,
    /// drawing_id -> session_id (for quick lookup)
    drawing_sessions: Arc<RwLock<HashMap<String, String>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            drawing_sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new collaboration session for a drawing.
    /// Returns the session_id. Fails if a session already exists for this drawing.
    pub async fn create_session(
        &self,
        drawing_id: &str,
        drawing_data: &serde_json::Value,
        timeout_secs: u64,
        password_hash: Option<String>,
    ) -> Result<String, AppError> {
        let mut drawing_sessions = self.drawing_sessions.write().await;

        if drawing_sessions.contains_key(drawing_id) {
            return Err(AppError::SessionAlreadyExists);
        }

        // Use full UUID (128 bits of entropy) for session IDs
        let session_id = Uuid::new_v4().to_string().replace('-', "");

        let elements = drawing_data
            .get("elements")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));

        let app_state = drawing_data
            .get("appState")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let files = drawing_data
            .get("files")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        // Parse elements into indexed structure
        let (element_map, element_order) = parse_elements_into_map(&elements);

        // Create broadcast channel with generous buffer
        let (broadcast_tx, _) = broadcast::channel(256);

        let session = CollabSession {
            session_id: session_id.clone(),
            drawing_id: drawing_id.to_string(),
            created_at: Utc::now(),
            timeout_secs,
            element_map,
            element_order,
            scene_seq: 0,
            app_state,
            files,
            participants: HashMap::new(),
            next_color_index: 0,
            broadcast_tx,
            password_hash,
        };

        drawing_sessions.insert(drawing_id.to_string(), session_id.clone());
        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        tracing::info!(
            session_id = %session_id,
            drawing_id = %drawing_id,
            "Collab session created"
        );

        Ok(session_id)
    }

    /// End a session. If save=true, returns (drawing_id, scene_data) for persistence.
    pub async fn end_session(
        &self,
        session_id: &str,
        save: bool,
    ) -> Result<Option<(String, serde_json::Value)>, AppError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.remove(session_id).ok_or(AppError::SessionNotFound)?;

        let drawing_id = session.drawing_id.clone();

        self.drawing_sessions
            .write()
            .await
            .remove(&drawing_id);

        // Notify all connected clients
        let _ = session
            .broadcast_tx
            .send(ServerMessage::SessionEnded { saved: save });

        tracing::info!(
            session_id = %session_id,
            drawing_id = %drawing_id,
            save = save,
            "Collab session ended"
        );

        if save {
            // Reconstruct the full drawing data from indexed structure
            let data = serde_json::json!({
                "type": "excalidraw",
                "version": 2,
                "elements": session.elements_as_array(),
                "appState": session.app_state,
                "files": session.files,
            });
            Ok(Some((drawing_id, data)))
        } else {
            Ok(None)
        }
    }

    /// Check if a drawing has an active session.
    #[allow(dead_code)]
    pub async fn get_session_for_drawing(&self, drawing_id: &str) -> Option<String> {
        self.drawing_sessions
            .read()
            .await
            .get(drawing_id)
            .cloned()
    }

    /// Get session status for a drawing (public info).
    /// Returns (session_id, participant_count, password_required).
    pub async fn get_session_status(&self, drawing_id: &str) -> Option<(String, usize, bool)> {
        let drawing_sessions = self.drawing_sessions.read().await;
        if let Some(session_id) = drawing_sessions.get(drawing_id) {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(session_id) {
                return Some((
                    session_id.clone(),
                    session.participants.len(),
                    session.password_hash.is_some(),
                ));
            }
        }
        None
    }

    /// Verify a password against a session's password hash.
    /// Returns Ok(true) if valid, Ok(false) if invalid, Err if session not found.
    pub async fn verify_session_password(
        &self,
        session_id: &str,
        password: Option<&str>,
    ) -> Result<bool, AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id).ok_or(AppError::SessionNotFound)?;

        match &session.password_hash {
            None => Ok(true), // No password required
            Some(hash) => match password {
                None => Ok(false), // Password required but not provided
                Some(pw) => crate::password::verify_password(pw, hash)
                    .map_err(|e| AppError::Internal(format!("Password verification error: {e}"))),
            },
        }
    }

    /// Add a participant to a session. Returns the broadcast receiver and snapshot data.
    pub async fn join_session(
        &self,
        session_id: &str,
        user_id: &str,
        name: &str,
    ) -> Result<
        (
            broadcast::Receiver<ServerMessage>,
            ServerMessage,
        ),
        AppError,
    > {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(AppError::SessionNotFound)?;

        if session.participants.len() >= 20 {
            return Err(AppError::SessionFull);
        }

        let color_index = session.next_color_index;
        session.next_color_index = session.next_color_index.wrapping_add(1);

        let participant = Participant {
            user_id: user_id.to_string(),
            name: name.to_string(),
            color_index,
        };

        session
            .participants
            .insert(user_id.to_string(), participant);

        let snapshot = ServerMessage::Snapshot {
            elements: session.elements_as_array(),
            app_state: session.app_state.clone(),
            files: session.files.clone(),
            collaborators: session.collaborator_list(),
        };

        let rx = session.broadcast_tx.subscribe();

        // Notify others about the new participant
        let join_msg = ServerMessage::UserJoined {
            user_id: user_id.to_string(),
            name: name.to_string(),
            collaborators: session.collaborator_list(),
        };
        let _ = session.broadcast_tx.send(join_msg);

        tracing::info!(
            session_id = %session_id,
            user_id = %user_id,
            name = %name,
            "Participant joined collab session"
        );

        Ok((rx, snapshot))
    }

    /// Remove a participant from a session.
    pub async fn leave_session(&self, session_id: &str, user_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            let name = session
                .participants
                .get(user_id)
                .map(|p| p.name.clone())
                .unwrap_or_default();

            session.participants.remove(user_id);

            let leave_msg = ServerMessage::UserLeft {
                user_id: user_id.to_string(),
                name: name.clone(),
                collaborators: session.collaborator_list(),
            };
            let _ = session.broadcast_tx.send(leave_msg);

            tracing::info!(
                session_id = %session_id,
                user_id = %user_id,
                name = %name,
                "Participant left collab session"
            );
        }
    }

    /// Update the scene elements for a session and broadcast to others.
    /// Uses version-based merging to prevent deletion flickering:
    /// each element is identified by its "id" field, and the highest
    /// "version" wins. This ensures that isDeleted=true updates are
    /// not overwritten by stale updates from other clients.
    pub async fn update_scene(
        &self,
        session_id: &str,
        user_id: &str,
        elements: serde_json::Value,
    ) -> Result<(), AppError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(AppError::SessionNotFound)?;

        // Apply all incoming elements to the indexed structure
        if let Some(arr) = elements.as_array() {
            for el in arr {
                if let Some(id) = el.get("id").and_then(|v| v.as_str()) {
                    let incoming_version =
                        el.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
                    let should_update = match session.element_map.get(id) {
                        Some(existing) => {
                            let existing_version = existing
                                .get("version")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            incoming_version >= existing_version
                        }
                        None => {
                            session.element_order.push(id.to_string());
                            true
                        }
                    };
                    if should_update {
                        session.element_map.insert(id.to_string(), el.clone());
                    }
                }
            }
        }

        session.scene_seq += 1;

        // Broadcast full state for backward compatibility
        let update_msg = ServerMessage::SceneUpdate {
            elements: session.elements_as_array(),
            from: user_id.to_string(),
        };
        let _ = session.broadcast_tx.send(update_msg);

        Ok(())
    }

    /// Update the scene with only changed (delta) elements and broadcast the delta.
    pub async fn update_scene_delta(
        &self,
        session_id: &str,
        user_id: &str,
        elements: serde_json::Value,
    ) -> Result<(), AppError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(AppError::SessionNotFound)?;

        // Apply only the delta elements to the indexed structure
        let mut changed_elements = Vec::new();
        if let Some(arr) = elements.as_array() {
            for el in arr {
                if let Some(id) = el.get("id").and_then(|v| v.as_str()) {
                    let incoming_version =
                        el.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
                    let should_update = match session.element_map.get(id) {
                        Some(existing) => {
                            let existing_version = existing
                                .get("version")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            incoming_version >= existing_version
                        }
                        None => {
                            // New element — add to order
                            session.element_order.push(id.to_string());
                            true
                        }
                    };
                    if should_update {
                        session.element_map.insert(id.to_string(), el.clone());
                        changed_elements.push(el.clone());
                    }
                }
            }
        }

        session.scene_seq += 1;

        // Broadcast only the changed elements as a delta
        if !changed_elements.is_empty() {
            let delta_msg = ServerMessage::SceneDelta {
                elements: serde_json::Value::Array(changed_elements),
                from: user_id.to_string(),
                seq: session.scene_seq,
            };
            let _ = session.broadcast_tx.send(delta_msg);
        }

        Ok(())
    }

    /// Merge two element arrays using version-based conflict resolution.
    /// For each element ID, the element with the highest version wins.
    /// Elements only present in one side are kept as-is.
    #[allow(dead_code)]
    fn merge_elements(
        current: &serde_json::Value,
        incoming: &serde_json::Value,
    ) -> serde_json::Value {
        let current_arr = match current.as_array() {
            Some(arr) => arr,
            None => return incoming.clone(),
        };
        let incoming_arr = match incoming.as_array() {
            Some(arr) => arr,
            None => return current.clone(),
        };

        // Build a map of current elements by ID
        let mut element_map: std::collections::HashMap<String, &serde_json::Value> =
            std::collections::HashMap::new();
        // Track insertion order to maintain stable element ordering
        let mut order: Vec<String> = Vec::new();

        for el in current_arr {
            if let Some(id) = el.get("id").and_then(|v| v.as_str()) {
                element_map.insert(id.to_string(), el);
                order.push(id.to_string());
            }
        }

        // Merge incoming elements
        for el in incoming_arr {
            if let Some(id) = el.get("id").and_then(|v| v.as_str()) {
                let incoming_version = el.get("version").and_then(|v| v.as_i64()).unwrap_or(0);

                if let Some(existing) = element_map.get(id) {
                    let existing_version =
                        existing.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
                    // Use incoming if version is higher or equal (equal handles
                    // same-version state changes like isDeleted toggling)
                    if incoming_version >= existing_version {
                        element_map.insert(id.to_string(), el);
                    }
                } else {
                    // New element not in current state — add it
                    element_map.insert(id.to_string(), el);
                    order.push(id.to_string());
                }
            }
        }

        // Reconstruct array in stable order
        let merged: Vec<serde_json::Value> = order
            .iter()
            .filter_map(|id| element_map.get(id).map(|el| (*el).clone()))
            .collect();

        serde_json::Value::Array(merged)
    }

    /// Broadcast a pointer update to all participants.
    pub async fn broadcast_pointer(
        &self,
        session_id: &str,
        user_id: &str,
        x: f64,
        y: f64,
        button: &str,
        tool: Option<String>,
        scroll_x: Option<f64>,
        scroll_y: Option<f64>,
        zoom: Option<f64>,
    ) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or(AppError::SessionNotFound)?;

        let participant = session.participants.get(user_id);
        let name = participant
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        let color_index = participant.map(|p| p.color_index).unwrap_or(0);

        let pointer_msg = ServerMessage::PointerUpdate {
            x,
            y,
            button: button.to_string(),
            tool,
            user_id: user_id.to_string(),
            name,
            color_index,
            scroll_x,
            scroll_y,
            zoom,
        };
        let _ = session.broadcast_tx.send(pointer_msg);

        Ok(())
    }

    /// Update a participant's display name (truncated to 50 chars max).
    pub async fn set_participant_name(
        &self,
        session_id: &str,
        user_id: &str,
        name: &str,
    ) {
        let truncated: String = name.chars().take(50).collect();
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            if let Some(participant) = session.participants.get_mut(user_id) {
                participant.name = truncated;
            }
        }
    }

    /// Get the broadcast sender for a session (used by WS handler).
    #[allow(dead_code)]
    pub async fn get_broadcast_tx(
        &self,
        session_id: &str,
    ) -> Option<broadcast::Sender<ServerMessage>> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.broadcast_tx.clone())
    }

    /// List all active sessions (for admin).
    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .map(|s| SessionInfo {
                session_id: s.session_id.clone(),
                drawing_id: s.drawing_id.clone(),
                created_at: s.created_at,
                participant_count: s.participants.len(),
                participants: s.collaborator_list(),
                password_required: s.password_hash.is_some(),
            })
            .collect()
    }

    /// Clean up expired sessions. Called periodically by background task.
    /// Expired sessions are saved to storage before being removed to prevent data loss.
    pub async fn cleanup_expired(&self, storage: &crate::storage::FileSystemStorage) {
        let now = Utc::now();
        let mut expired_ids = Vec::new();

        {
            let sessions = self.sessions.read().await;
            for (id, session) in sessions.iter() {
                let elapsed = (now - session.created_at).num_seconds() as u64;
                if elapsed > session.timeout_secs {
                    expired_ids.push(id.clone());
                }
            }
        }

        for session_id in expired_ids {
            tracing::info!(session_id = %session_id, "Cleaning up expired collab session (saving changes)");
            match self.end_session(&session_id, true).await {
                Ok(Some((drawing_id, data))) => {
                    // Preserve existing source_path and password_hash from stored drawing
                    let (source_path, password_hash): (Option<String>, Option<String>) = match storage.load(&drawing_id).await {
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
                    if let Err(e) = storage.save(&drawing_id, &data, source_path.as_deref(), password_hash.as_deref()).await {
                        tracing::error!(
                            drawing_id = %drawing_id,
                            error = %e,
                            "Failed to save expired collab session"
                        );
                    } else {
                        tracing::info!(drawing_id = %drawing_id, "Expired collab session saved to storage");
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    tracing::error!(session_id = %session_id, error = %e, "Failed to end expired session");
                }
            }
        }
    }
}
