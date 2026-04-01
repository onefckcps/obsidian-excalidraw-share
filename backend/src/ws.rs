use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use uuid::Uuid;

use crate::collab::{ClientMessage, ServerMessage, SessionManager};

#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(default = "default_name")]
    pub name: String,
}

fn default_name() -> String {
    let adjectives = ["Swift", "Bright", "Calm", "Bold", "Keen"];
    let nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk"];
    let adj = adjectives[rand_index(adjectives.len())];
    let noun = nouns[rand_index(nouns.len())];
    format!("{adj} {noun}")
}

fn rand_index(max: usize) -> usize {
    // Simple pseudo-random using time
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as usize;
    nanos % max
}

/// WebSocket upgrade handler for collab sessions.
pub async fn ws_collab_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Query(query): Query<WsQuery>,
    State(session_manager): State<SessionManager>,
) -> impl IntoResponse {
    let name = if query.name.is_empty() {
        default_name()
    } else {
        query.name
    };

    ws.on_upgrade(move |socket| handle_ws_connection(socket, session_id, name, session_manager))
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
            // Don't send scene_update messages back to the sender
            match &msg {
                ServerMessage::SceneUpdate { from, .. } if from == &user_id_for_send => continue,
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
    }
}
