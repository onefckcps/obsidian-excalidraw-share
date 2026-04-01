use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

use crate::error::AppError;

// ──────────────────────────────────────────────
// WebSocket message types
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    SceneUpdate {
        elements: serde_json::Value,
    },
    PointerUpdate {
        x: f64,
        y: f64,
        button: String,
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
    PointerUpdate {
        x: f64,
        y: f64,
        button: String,
        #[serde(rename = "userId")]
        user_id: String,
        name: String,
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
}

// ──────────────────────────────────────────────
// Session types
// ──────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Participant {
    pub user_id: String,
    pub name: String,
}

#[derive(Debug)]
pub struct CollabSession {
    pub session_id: String,
    pub drawing_id: String,
    pub created_at: DateTime<Utc>,
    pub timeout_secs: u64,
    /// Current scene elements (updated on every scene_update)
    pub current_elements: serde_json::Value,
    /// Original appState from the drawing
    pub app_state: serde_json::Value,
    /// Original files from the drawing
    pub files: serde_json::Value,
    /// Connected participants
    pub participants: HashMap<String, Participant>,
    /// Broadcast channel for sending messages to all connected clients
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
}

impl CollabSession {
    pub fn collaborator_list(&self) -> Vec<CollaboratorInfo> {
        self.participants
            .values()
            .map(|p| CollaboratorInfo {
                id: p.user_id.clone(),
                name: p.name.clone(),
            })
            .collect()
    }
}

/// Admin-facing session info (serializable)
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub drawing_id: String,
    pub created_at: DateTime<Utc>,
    pub participant_count: usize,
    pub participants: Vec<CollaboratorInfo>,
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
    ) -> Result<String, AppError> {
        let mut drawing_sessions = self.drawing_sessions.write().await;

        if drawing_sessions.contains_key(drawing_id) {
            return Err(AppError::SessionAlreadyExists);
        }

        let session_id = Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("unknown")
            .to_string();

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

        // Create broadcast channel with generous buffer
        let (broadcast_tx, _) = broadcast::channel(256);

        let session = CollabSession {
            session_id: session_id.clone(),
            drawing_id: drawing_id.to_string(),
            created_at: Utc::now(),
            timeout_secs,
            current_elements: elements,
            app_state,
            files,
            participants: HashMap::new(),
            broadcast_tx,
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
            // Reconstruct the full drawing data
            let data = serde_json::json!({
                "type": "excalidraw",
                "version": 2,
                "elements": session.current_elements,
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
    pub async fn get_session_status(&self, drawing_id: &str) -> Option<(String, usize)> {
        let drawing_sessions = self.drawing_sessions.read().await;
        if let Some(session_id) = drawing_sessions.get(drawing_id) {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(session_id) {
                return Some((session_id.clone(), session.participants.len()));
            }
        }
        None
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

        let participant = Participant {
            user_id: user_id.to_string(),
            name: name.to_string(),
        };

        session
            .participants
            .insert(user_id.to_string(), participant);

        let snapshot = ServerMessage::Snapshot {
            elements: session.current_elements.clone(),
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

        // Version-based merge of incoming elements with stored elements
        let merged = Self::merge_elements(&session.current_elements, &elements);
        session.current_elements = merged.clone();

        // Broadcast the merged state to all participants
        let update_msg = ServerMessage::SceneUpdate {
            elements: merged,
            from: user_id.to_string(),
        };
        let _ = session.broadcast_tx.send(update_msg);

        Ok(())
    }

    /// Merge two element arrays using version-based conflict resolution.
    /// For each element ID, the element with the highest version wins.
    /// Elements only present in one side are kept as-is.
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
    ) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or(AppError::SessionNotFound)?;

        let name = session
            .participants
            .get(user_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());

        let pointer_msg = ServerMessage::PointerUpdate {
            x,
            y,
            button: button.to_string(),
            user_id: user_id.to_string(),
            name,
        };
        let _ = session.broadcast_tx.send(pointer_msg);

        Ok(())
    }

    /// Update a participant's display name.
    pub async fn set_participant_name(
        &self,
        session_id: &str,
        user_id: &str,
        name: &str,
    ) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            if let Some(participant) = session.participants.get_mut(user_id) {
                participant.name = name.to_string();
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
            })
            .collect()
    }

    /// Clean up expired sessions. Called periodically by background task.
    pub async fn cleanup_expired(&self) {
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
            tracing::info!(session_id = %session_id, "Cleaning up expired collab session");
            // End without saving (timeout = discard)
            let _ = self.end_session(&session_id, false).await;
        }
    }
}
