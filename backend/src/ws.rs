use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::collab::{ClientMessage, ServerMessage, SessionManager};
use crate::error::AppError;

#[derive(Clone)]
pub struct WsState {
    pub session_manager: SessionManager,
    pub api_key: String,
}

#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(default = "default_name")]
    pub name: String,
    #[serde(default)]
    pub password: Option<String>,
    /// Optional API key for admin bypass of session password
    #[serde(default)]
    pub api_key: Option<String>,
}

fn default_name() -> String {
    use rand::Rng;
    let adjectives = ["Swift", "Bright", "Calm", "Bold", "Keen"];
    let nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk"];
    let mut rng = rand::thread_rng();
    let adj = adjectives[rng.gen_range(0..adjectives.len())];
    let noun = nouns[rng.gen_range(0..nouns.len())];
    format!("{adj} {noun}")
}

/// Sanitize a display name: strip HTML tags and control characters,
/// keeping only printable text. Truncates to `max_len` characters.
fn sanitize_display_name(name: &str, max_len: usize) -> String {
    // Strip anything that looks like an HTML tag
    let mut result = String::with_capacity(name.len());
    let mut in_tag = false;
    for ch in name.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if in_tag {
            continue;
        }
        // Skip control characters (except space)
        if ch.is_control() && ch != ' ' {
            continue;
        }
        result.push(ch);
    }
    result.chars().take(max_len).collect()
}

/// WebSocket upgrade handler for collab sessions.
/// Verifies session password BEFORE upgrading the connection.
/// Admin (valid API key) bypasses the session password.
pub async fn ws_collab_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Query(query): Query<WsQuery>,
    State(ws_state): State<WsState>,
) -> Result<impl IntoResponse, AppError> {
    // Check if the request carries a valid API key (admin bypass)
    let has_valid_api_key = query.api_key.as_ref().map_or(false, |key| {
        let key_bytes = key.as_bytes();
        let expected_bytes = ws_state.api_key.as_bytes();
        key_bytes.len() == expected_bytes.len() && key_bytes.ct_eq(expected_bytes).into()
    });

    // Verify password before upgrading to WebSocket (admin bypasses)
    if !has_valid_api_key {
        let password_valid = ws_state.session_manager
            .verify_session_password(&session_id, query.password.as_deref())
            .await?;

        if !password_valid {
            return Err(if query.password.is_some() {
                AppError::InvalidPassword
            } else {
                AppError::PasswordRequired
            });
        }
    }

    let name = if query.name.is_empty() {
        default_name()
    } else {
        sanitize_display_name(&query.name, 50)
    };

    let session_manager = ws_state.session_manager.clone();
    Ok(ws.on_upgrade(move |socket| handle_ws_connection(socket, session_id, name, session_manager)))
}

async fn handle_ws_connection(
    socket: WebSocket,
    session_id: String,
    name: String,
    session_manager: SessionManager,
) {
    let user_id = Uuid::new_v4()
        .to_string()
        .split('-')
        .next()
        .unwrap_or("unknown")
        .to_string();

    tracing::info!(
        session_id = %session_id,
        user_id = %user_id,
        name = %name,
        "WebSocket connection established"
    );

    // Join the session
    let (mut broadcast_rx, snapshot) = match session_manager
        .join_session(&session_id, &user_id, &name)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::warn!(
                session_id = %session_id,
                error = %e,
                "Failed to join session"
            );
            // Send error and close
            let (mut sender, _) = socket.split();
            let error_msg = ServerMessage::Error {
                message: e.to_string(),
            };
            if let Ok(json) = serde_json::to_string(&error_msg) {
                let _ = sender.send(Message::Text(json.into())).await;
            }
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Send the initial snapshot
    if let Ok(json) = serde_json::to_string(&snapshot) {
        if ws_sender.send(Message::Text(json.into())).await.is_err() {
            session_manager.leave_session(&session_id, &user_id).await;
            return;
        }
    }

    let user_id_for_send = user_id.clone();

    // Task: forward broadcast messages to this WebSocket client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            // Don't send scene_update/scene_delta/files_update messages back to the sender
            match &msg {
                ServerMessage::SceneUpdate { from, .. } if from == &user_id_for_send => continue,
                ServerMessage::SceneDelta { from, .. } if from == &user_id_for_send => continue,
                ServerMessage::FilesUpdate { from, .. } if from == &user_id_for_send => continue,
                ServerMessage::PointerUpdate { user_id: uid, .. } if uid == &user_id_for_send => {
                    continue
                }
                _ => {}
            }

            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }

            // If session ended, close after sending the message
            if matches!(msg, ServerMessage::SessionEnded { .. }) {
                break;
            }
        }
    });

    let session_manager_clone = session_manager.clone();
    let session_id_recv = session_id.clone();
    let user_id_recv = user_id.clone();

    // Task: receive messages from this WebSocket client
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    let text_str: &str = &text;
                    // Reject oversized messages (5 MB max) to prevent memory abuse
                    if text_str.len() > 5 * 1024 * 1024 {
                        tracing::warn!(
                            user_id = %user_id_recv,
                            size = text_str.len(),
                            "WebSocket message too large, ignoring"
                        );
                        continue;
                    }
                    match serde_json::from_str::<ClientMessage>(text_str) {
                        Ok(client_msg) => {
                            handle_client_message(
                                &session_manager_clone,
                                &session_id_recv,
                                &user_id_recv,
                                client_msg,
                            )
                            .await;
                        }
                        Err(e) => {
                            tracing::warn!(
                                user_id = %user_id_recv,
                                error = %e,
                                "Invalid WebSocket message"
                            );
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {} // Ignore binary, ping, pong
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => {
            recv_task.abort();
        }
        _ = &mut recv_task => {
            send_task.abort();
        }
    }

    // Clean up: remove participant from session
    session_manager.leave_session(&session_id, &user_id).await;

    tracing::info!(
        session_id = %session_id,
        user_id = %user_id,
        "WebSocket connection closed"
    );
}

async fn handle_client_message(
    session_manager: &SessionManager,
    session_id: &str,
    user_id: &str,
    msg: ClientMessage,
) {
    match msg {
        ClientMessage::SceneUpdate { elements } => {
            if let Err(e) = session_manager
                .update_scene(session_id, user_id, elements)
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    user_id = %user_id,
                    error = %e,
                    "Failed to update scene"
                );
            }
        }
        ClientMessage::SceneDelta { elements, seq: _ } => {
            if let Err(e) = session_manager
                .update_scene_delta(session_id, user_id, elements)
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    user_id = %user_id,
                    error = %e,
                    "Failed to update scene delta"
                );
            }
        }
        ClientMessage::PointerUpdate { x, y, button, tool, scroll_x, scroll_y, zoom } => {
            if let Err(e) = session_manager
                .broadcast_pointer(session_id, user_id, x, y, &button, tool, scroll_x, scroll_y, zoom)
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    user_id = %user_id,
                    error = %e,
                    "Failed to broadcast pointer"
                );
            }
        }
        ClientMessage::SetName { name } => {
            session_manager
                .set_participant_name(session_id, user_id, &name)
                .await;
        }
        ClientMessage::FilesUpdate { files } => {
            if let Err(e) = session_manager
                .update_files(session_id, user_id, files)
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    user_id = %user_id,
                    error = %e,
                    "Failed to update files"
                );
            }
        }
    }
}
