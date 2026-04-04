use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
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
    FilesUpdate {
        files: serde_json::Value,
    },
    ScreenShareStart,
    ScreenShareStop,
    RtcSignal {
        #[serde(rename = "targetUserId")]
        target_user_id: String,
        /// { type: "offer"|"answer", sdp: String }
        signal: serde_json::Value,
    },
    RtcIceCandidate {
        #[serde(rename = "targetUserId")]
        target_user_id: String,
        /// RTCIceCandidateInit
        candidate: serde_json::Value,
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
    FilesUpdate {
        files: serde_json::Value,
        from: String,
    },
    SessionEnded {
        saved: bool,
    },
    Error {
        message: String,
    },
    ScreenShareStarted {
        #[serde(rename = "userId")]
        user_id: String,
        name: String,
    },
    ScreenShareStopped {
        #[serde(rename = "userId")]
        user_id: String,
    },
    RtcSignal {
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        signal: serde_json::Value,
    },
    RtcIceCandidate {
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        candidate: serde_json::Value,
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
    /// Whether this is a persistent collab session (no timeout, auto-save)
    pub persistent: bool,
    /// Last time any scene change occurred (for idle-based cleanup of persistent sessions)
    pub last_activity: DateTime<Utc>,
    /// Monotonically increasing version counter for persistent disk saves
    pub persistent_version: u64,
    /// Whether the session has unsaved changes since last disk flush
    pub persistent_dirty: bool,
    /// User ID of the participant currently sharing their screen (None if nobody is sharing)
    pub screen_sharer: Option<String>,
    /// Per-user sender channels for targeted WebRTC signaling messages
    pub user_senders: HashMap<String, mpsc::UnboundedSender<ServerMessage>>,
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
    pub persistent: bool,
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
    /// Drawing IDs that have persistent collab enabled (for status queries)
    persistent_drawings: Arc<RwLock<HashSet<String>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            drawing_sessions: Arc::new(RwLock::new(HashMap::new())),
            persistent_drawings: Arc::new(RwLock::new(HashSet::new())),
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
            persistent: false,
            last_activity: Utc::now(),
            persistent_version: 0,
            persistent_dirty: false,
            screen_sharer: None,
            user_senders: HashMap::new(),
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

    /// Register a drawing as having persistent collab enabled.
    /// Called on server startup and when enabling persistent collab.
    pub async fn register_persistent_drawing(&self, drawing_id: String) {
        self.persistent_drawings.write().await.insert(drawing_id);
    }

    /// Unregister a drawing from persistent collab tracking.
    /// Called when disabling persistent collab.
    pub async fn unregister_persistent_drawing(&self, drawing_id: &str) {
        self.persistent_drawings.write().await.remove(drawing_id);
    }

    /// Check if a drawing has persistent collab registered.
    pub async fn is_persistent_drawing(&self, drawing_id: &str) -> bool {
        self.persistent_drawings.read().await.contains(drawing_id)
    }

    /// Create a persistent collaboration session for a drawing.
    /// Unlike ephemeral sessions, persistent sessions have no timeout and auto-save.
    /// Returns the session_id. Fails if a session already exists for this drawing.
    pub async fn create_persistent_session(
        &self,
        drawing_id: &str,
        drawing_data: &serde_json::Value,
        password_hash: Option<String>,
    ) -> Result<String, AppError> {
        let mut drawing_sessions = self.drawing_sessions.write().await;

        if drawing_sessions.contains_key(drawing_id) {
            return Err(AppError::SessionAlreadyExists);
        }

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

        // Read persistent_version from the drawing data (set by save_persistent)
        let persistent_version = drawing_data
            .get("_persistent_collab_version")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let (element_map, element_order) = parse_elements_into_map(&elements);

        let (broadcast_tx, _) = broadcast::channel(256);

        let session = CollabSession {
            session_id: session_id.clone(),
            drawing_id: drawing_id.to_string(),
            created_at: Utc::now(),
            timeout_secs: 0, // No timeout for persistent sessions
            element_map,
            element_order,
            scene_seq: 0,
            app_state,
            files,
            participants: HashMap::new(),
            next_color_index: 0,
            broadcast_tx,
            password_hash,
            persistent: true,
            last_activity: Utc::now(),
            persistent_version,
            persistent_dirty: false,
            screen_sharer: None,
            user_senders: HashMap::new(),
        };

        drawing_sessions.insert(drawing_id.to_string(), session_id.clone());
        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // Register in persistent_drawings if not already registered
        self.persistent_drawings
            .write()
            .await
            .insert(drawing_id.to_string());

        tracing::info!(
            session_id = %session_id,
            drawing_id = %drawing_id,
            persistent_version = persistent_version,
            "Persistent collab session created"
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

    /// Get session status for a drawing, including persistent collab info.
    /// Returns (active, session_id, participant_count, password_required, persistent).
    /// If no active session exists, checks the persistent_drawings registry.
    pub async fn get_session_status_extended(
        &self,
        drawing_id: &str,
    ) -> (bool, Option<String>, usize, bool, bool) {
        let drawing_sessions = self.drawing_sessions.read().await;
        if let Some(session_id) = drawing_sessions.get(drawing_id) {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(session_id) {
                return (
                    true,
                    Some(session_id.clone()),
                    session.participants.len(),
                    session.password_hash.is_some(),
                    session.persistent,
                );
            }
        }
        // No active session — check if drawing has persistent collab registered
        let is_persistent = self.persistent_drawings.read().await.contains(drawing_id);
        (false, None, 0, false, is_persistent)
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

    /// Add a participant to a session. Returns the broadcast receiver, snapshot data,
    /// and optionally a ScreenShareStarted message if someone is currently sharing.
    pub async fn join_session(
        &self,
        session_id: &str,
        user_id: &str,
        name: &str,
    ) -> Result<
        (
            broadcast::Receiver<ServerMessage>,
            ServerMessage,
            Option<ServerMessage>,
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

        // If someone is currently sharing their screen, prepare a ScreenShareStarted
        // message for the new user so they can initiate a WebRTC connection.
        let screen_share_msg = session.screen_sharer.as_ref().and_then(|sharer_id| {
            session.participants.get(sharer_id).map(|p| {
                ServerMessage::ScreenShareStarted {
                    user_id: sharer_id.clone(),
                    name: p.name.clone(),
                }
            })
        });

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

        Ok((rx, snapshot, screen_share_msg))
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

            // Auto-stop screen share if the leaving user was the sharer
            if session.screen_sharer.as_deref() == Some(user_id) {
                session.screen_sharer = None;
                let _ = session.broadcast_tx.send(ServerMessage::ScreenShareStopped {
                    user_id: user_id.to_string(),
                });
            }

            // Clean up the user's per-user sender channel to prevent memory leaks
            session.user_senders.remove(user_id);

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

        // Apply all incoming elements to the indexed structure, tracking which actually changed
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

        // Update persistent session tracking
        if session.persistent {
            session.persistent_dirty = true;
        }
        session.last_activity = Utc::now();

        // Broadcast only the changed elements as a scene_update (delta-efficient).
        // Clients merge these into their local state using version-based resolution.
        if !changed_elements.is_empty() {
            let update_msg = ServerMessage::SceneUpdate {
                elements: serde_json::Value::Array(changed_elements),
                from: user_id.to_string(),
            };
            let _ = session.broadcast_tx.send(update_msg);
        }

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

        // Update persistent session tracking
        if session.persistent {
            session.persistent_dirty = true;
        }
        session.last_activity = Utc::now();

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

    /// Merge incoming files into the session's file store and broadcast new files to other clients.
    /// Files are immutable in Excalidraw (same ID = same content), so this is additive only.
    pub async fn update_files(
        &self,
        session_id: &str,
        user_id: &str,
        files: serde_json::Value,
    ) -> Result<(), AppError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(AppError::SessionNotFound)?;

        // Merge incoming files into session.files (additive only)
        let incoming_map = match files.as_object() {
            Some(map) => map,
            None => return Ok(()), // Not a valid files object
        };

        // Ensure session.files is an object
        if !session.files.is_object() {
            session.files = serde_json::Value::Object(serde_json::Map::new());
        }

        let session_files = session.files.as_object_mut().unwrap();
        let mut new_files = serde_json::Map::new();

        for (file_id, file_data) in incoming_map {
            // Only add files that don't already exist (files are immutable)
            if !session_files.contains_key(file_id) {
                session_files.insert(file_id.clone(), file_data.clone());
                new_files.insert(file_id.clone(), file_data.clone());
            }
        }

        // Only broadcast if there are actually new files
        if !new_files.is_empty() {
            tracing::info!(
                session_id = %session_id,
                user_id = %user_id,
                new_file_count = new_files.len(),
                "Merging new files into collab session"
            );

            // Update persistent session tracking
            if session.persistent {
                session.persistent_dirty = true;
            }
            session.last_activity = Utc::now();

            let files_msg = ServerMessage::FilesUpdate {
                files: serde_json::Value::Object(new_files),
                from: user_id.to_string(),
            };
            let _ = session.broadcast_tx.send(files_msg);
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

    /// Update a participant's display name (sanitized and truncated to 50 chars max).
    pub async fn set_participant_name(
        &self,
        session_id: &str,
        user_id: &str,
        name: &str,
    ) {
        // Sanitize: strip HTML tags and control characters, truncate to 50 chars
        let sanitized: String = {
            let mut result = String::with_capacity(name.len());
            let mut in_tag = false;
            for ch in name.chars() {
                if ch == '<' { in_tag = true; continue; }
                if ch == '>' { in_tag = false; continue; }
                if in_tag { continue; }
                if ch.is_control() && ch != ' ' { continue; }
                result.push(ch);
            }
            result.chars().take(50).collect()
        };
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            if let Some(participant) = session.participants.get_mut(user_id) {
                participant.name = sanitized;
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

    /// Register a per-user sender channel for targeted signaling messages.
    /// Returns the receiver end that the WS handler should listen on.
    /// Returns None if the session doesn't exist (graceful degradation).
    pub async fn register_user_sender(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> Option<mpsc::UnboundedReceiver<ServerMessage>> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id)?;
        let (tx, rx) = mpsc::unbounded_channel();
        session.user_senders.insert(user_id.to_string(), tx);
        Some(rx)
    }

    /// Send a targeted message to a specific user in a session.
    pub async fn send_to_user(
        &self,
        session_id: &str,
        target_user_id: &str,
        message: ServerMessage,
    ) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id).ok_or(AppError::SessionNotFound)?;
        let sender = session
            .user_senders
            .get(target_user_id)
            .ok_or(AppError::SessionNotFound)?;
        sender.send(message).map_err(|_| AppError::SessionNotFound)
    }

    /// Start screen sharing for a user. Broadcasts ScreenShareStarted to all.
    pub async fn start_screen_share(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> Result<(), AppError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(AppError::SessionNotFound)?;

        let name = session
            .participants
            .get(user_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());

        session.screen_sharer = Some(user_id.to_string());

        let _ = session.broadcast_tx.send(ServerMessage::ScreenShareStarted {
            user_id: user_id.to_string(),
            name,
        });

        tracing::info!(
            session_id = %session_id,
            user_id = %user_id,
            "Screen share started"
        );

        Ok(())
    }

    /// Stop screen sharing for a user. Broadcasts ScreenShareStopped to all.
    pub async fn stop_screen_share(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> Result<(), AppError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(AppError::SessionNotFound)?;

        // Only clear if this user is actually the current sharer
        if session.screen_sharer.as_deref() == Some(user_id) {
            session.screen_sharer = None;
        }

        let _ = session.broadcast_tx.send(ServerMessage::ScreenShareStopped {
            user_id: user_id.to_string(),
        });

        tracing::info!(
            session_id = %session_id,
            user_id = %user_id,
            "Screen share stopped"
        );

        Ok(())
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
                persistent: s.persistent,
            })
            .collect()
    }

    /// Get save data for a persistent session if it has unsaved changes.
    /// Returns (drawing_id, scene_data, version) if dirty, None otherwise.
    /// Resets the dirty flag after reading.
    pub async fn get_persistent_save_data(
        &self,
        session_id: &str,
    ) -> Option<(String, serde_json::Value, u64)> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id)?;

        if !session.persistent || !session.persistent_dirty {
            return None;
        }

        // Increment version for this save
        session.persistent_version += 1;
        session.persistent_dirty = false;

        let version = session.persistent_version;
        let drawing_id = session.drawing_id.clone();

        // Reconstruct the full drawing data (same as end_session with save=true)
        let data = serde_json::json!({
            "type": "excalidraw",
            "version": 2,
            "elements": session.elements_as_array(),
            "appState": session.app_state,
            "files": session.files,
        });

        Some((drawing_id, data, version))
    }

    /// Clean up expired sessions. Called periodically by background task.
    /// Expired sessions are saved to storage before being removed to prevent data loss.
    /// Persistent sessions use idle-based cleanup (no participants + 30 min idle)
    /// instead of timeout-based cleanup.
    pub async fn cleanup_expired(&self, storage: &crate::storage::FileSystemStorage) {
        use crate::storage::DrawingStorage;

        let now = Utc::now();
        let mut expired_ephemeral_ids = Vec::new();
        let mut idle_persistent_ids = Vec::new();

        {
            let sessions = self.sessions.read().await;
            for (id, session) in sessions.iter() {
                if session.persistent {
                    // Persistent sessions: idle-based cleanup
                    // Idle = no participants AND last_activity older than 30 minutes
                    if session.participants.is_empty() {
                        let idle_secs = (now - session.last_activity).num_seconds().max(0) as u64;
                        if idle_secs > 1800 {
                            idle_persistent_ids.push((id.clone(), session.drawing_id.clone(), session.persistent_version));
                        }
                    }
                } else {
                    // Ephemeral sessions: timeout-based cleanup (existing logic)
                    let elapsed = (now - session.created_at).num_seconds() as u64;
                    if elapsed > session.timeout_secs {
                        expired_ephemeral_ids.push(id.clone());
                    }
                }
            }
        }

        // Clean up expired ephemeral sessions (existing behavior)
        for session_id in expired_ephemeral_ids {
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

        // Clean up idle persistent sessions: save to disk, remove from memory,
        // but do NOT unregister from persistent_drawings
        for (session_id, drawing_id, version) in idle_persistent_ids {
            tracing::info!(
                session_id = %session_id,
                drawing_id = %drawing_id,
                "Cleaning up idle persistent collab session (saving to disk)"
            );

            // Get save data before ending the session
            if let Some((did, data, ver)) = self.get_persistent_save_data(&session_id).await {
                if let Err(e) = storage.save_persistent(&did, &data, ver).await {
                    tracing::error!(
                        drawing_id = %did,
                        error = %e,
                        "Failed to save idle persistent session to disk"
                    );
                } else {
                    tracing::info!(drawing_id = %did, version = ver, "Idle persistent session saved to disk");
                }
            } else {
                // Session wasn't dirty — still save with current version to be safe
                let sessions = self.sessions.write().await;
                if let Some(session) = sessions.get(&session_id) {
                    let data = serde_json::json!({
                        "type": "excalidraw",
                        "version": 2,
                        "elements": session.elements_as_array(),
                        "appState": session.app_state,
                        "files": session.files,
                    });
                    if let Err(e) = storage.save_persistent(&drawing_id, &data, version).await {
                        tracing::error!(
                            drawing_id = %drawing_id,
                            error = %e,
                            "Failed to save idle persistent session to disk"
                        );
                    } else {
                        tracing::info!(drawing_id = %drawing_id, version = version, "Idle persistent session saved to disk (clean)");
                    }
                }
                drop(sessions);
            }

            // Remove session from memory (end_session handles broadcast + cleanup)
            match self.end_session(&session_id, false).await {
                Ok(_) => {
                    tracing::info!(
                        session_id = %session_id,
                        drawing_id = %drawing_id,
                        "Idle persistent session removed from memory"
                    );
                }
                Err(e) => {
                    tracing::error!(
                        session_id = %session_id,
                        error = %e,
                        "Failed to end idle persistent session"
                    );
                }
            }
        }
    }
}
