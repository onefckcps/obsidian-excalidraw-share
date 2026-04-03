mod auth;
mod collab;
mod error;
mod password;
mod routes;
mod storage;
mod ws;

use axum::{
    http::{header, Method},
    middleware,
    routing::{delete, get, post},
    Router,
};
use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use auth::ApiKey;
use collab::SessionManager;
use routes::AppState;
use storage::{DrawingStorage, FileSystemStorage};

#[derive(Parser, Debug)]
#[command(name = "excalishare", about = "Self-hosted Excalidraw sharing server")]
struct Config {
    /// Address to listen on
    #[arg(long, env = "LISTEN_ADDR", default_value = "127.0.0.1:8184")]
    listen_addr: String,

    /// Directory to store drawing JSON files
    #[arg(long, env = "DATA_DIR", default_value = "./data/drawings")]
    data_dir: PathBuf,

    /// API key for upload/delete operations
    #[arg(long, env = "API_KEY")]
    api_key: String,

    /// Public base URL (used to construct share links)
    #[arg(long, env = "BASE_URL", default_value = "http://localhost:8184")]
    base_url: String,

    /// Maximum upload size in megabytes
    #[arg(long, env = "MAX_UPLOAD_MB", default_value = "50")]
    max_upload_mb: usize,

    /// Path to the frontend build directory (static files)
    #[arg(long, env = "FRONTEND_DIR", default_value = "./frontend/dist")]
    frontend_dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "excalidraw_share=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::parse();

    // Warn about insecure default API key
    if config.api_key == "change-me-in-production" {
        tracing::warn!("⚠️  Using default API key 'change-me-in-production' — set API_KEY for production!");
    }

    tracing::info!(
        listen = %config.listen_addr,
        data_dir = %config.data_dir.display(),
        base_url = %config.base_url,
        max_upload_mb = config.max_upload_mb,
        "Starting excalishare server"
    );

    let storage = FileSystemStorage::new(&config.data_dir).await?;
    let session_manager = SessionManager::new();

    // Scan for persistent collab drawings and register them
    let persistent_ids = storage.list_persistent_collab_drawings().await
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "Failed to scan for persistent collab drawings");
            vec![]
        });
    if !persistent_ids.is_empty() {
        tracing::info!(count = persistent_ids.len(), "Registering persistent collab drawings");
        for id in persistent_ids {
            session_manager.register_persistent_drawing(id).await;
        }
    }

    let app_state = AppState {
        storage: storage.clone(),
        base_url: config.base_url.clone(),
        session_manager: session_manager.clone(),
        api_key: config.api_key.clone(),
    };

    let api_key = ApiKey(config.api_key.clone());
    let body_limit = config.max_upload_mb * 1024 * 1024;

    let index_file = config.frontend_dir.join("index.html");
    let frontend_service = ServeDir::new(&config.frontend_dir)
        .not_found_service(ServeFile::new(&index_file));

    // Rate limiting: 120 req/sec per IP for public, 30 req/sec per IP for protected
    let public_rate_limit = GovernorLayer {
        config: Arc::new(
            GovernorConfigBuilder::default()
                .per_second(1)
                .burst_size(120)
                .finish()
                .expect("Failed to build public rate limiter"),
        ),
    };
    let protected_rate_limit = GovernorLayer {
        config: Arc::new(
            GovernorConfigBuilder::default()
                .per_second(1)
                .burst_size(30)
                .finish()
                .expect("Failed to build protected rate limiter"),
        ),
    };
    // Strict rate limit for password verification (brute-force protection): 5 req/sec per IP
    let password_rate_limit = GovernorLayer {
        config: Arc::new(
            GovernorConfigBuilder::default()
                .per_second(1)
                .burst_size(5)
                .finish()
                .expect("Failed to build password rate limiter"),
        ),
    };
    // Rate limit for WebSocket connections: 10 connections/sec per IP
    let ws_rate_limit = GovernorLayer {
        config: Arc::new(
            GovernorConfigBuilder::default()
                .per_second(1)
                .burst_size(10)
                .finish()
                .expect("Failed to build WebSocket rate limiter"),
        ),
    };

    // Password verification route (stricter rate limit for brute-force protection)
    let password_api = Router::new()
        .route(
            "/api/collab/verify-password",
            post(routes::verify_collab_password),
        )
        .layer(password_rate_limit);

    // Public API routes (no auth required)
    let public_api = Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/public/drawings", get(routes::list_drawings_public))
        .route("/api/view/{id}", get(routes::get_drawing))
        .route(
            "/api/collab/status/{drawing_id}",
            get(routes::collab_status),
        )
        .route(
            "/api/persistent-collab/activate/{drawing_id}",
            post(routes::activate_persistent_collab),
        )
        .layer(public_rate_limit);

    // Protected API routes (auth required)
    let protected_api = Router::new()
        .route("/api/upload", post(routes::upload_drawing))
        .route("/api/drawings/{id}", delete(routes::delete_drawing))
        .route("/api/drawings", get(routes::list_drawings))
        .route("/api/lookup", get(routes::lookup_by_source_path))
        .route("/api/collab/start", post(routes::start_collab))
        .route("/api/collab/stop", post(routes::stop_collab))
        .route("/api/collab/sessions", get(routes::list_collab_sessions))
        .route(
            "/api/persistent-collab/enable",
            post(routes::enable_persistent_collab),
        )
        .route(
            "/api/persistent-collab/disable",
            post(routes::disable_persistent_collab),
        )
        .layer(axum::extract::DefaultBodyLimit::max(body_limit))
        .layer(protected_rate_limit)
        .route_layer(middleware::from_fn_with_state(
            api_key.clone(),
            auth::api_key_middleware,
        ));

    // WebSocket route (rate limited, no auth but session must exist)
    let ws_state = ws::WsState {
        session_manager: session_manager.clone(),
        api_key: config.api_key.clone(),
    };
    let ws_routes = Router::new()
        .route(
            "/ws/collab/{session_id}",
            get(ws::ws_collab_handler),
        )
        .layer(ws_rate_limit)
        .with_state(ws_state);

    // Restrict CORS to the configured BASE_URL origin and Obsidian's app origin.
    // This prevents arbitrary websites from making cross-origin requests while
    // allowing the frontend (same-origin) and the Obsidian plugin to work.
    let allowed_origins = [
        config
            .base_url
            .parse()
            .expect("BASE_URL must be a valid header value for CORS origin"),
        "app://obsidian.md"
            .parse()
            .expect("Obsidian origin must be valid"),
    ];
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let app = Router::new()
        .merge(password_api)
        .merge(public_api)
        .merge(protected_api)
        .with_state(app_state)
        .merge(ws_routes)
        .fallback_service(frontend_service)
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Spawn background task for session cleanup (every 60 seconds).
    // Expired sessions are saved to storage before being removed.
    let cleanup_manager = session_manager.clone();
    let cleanup_storage = storage.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup_manager.cleanup_expired(&cleanup_storage).await;
        }
    });

    // Spawn background task for persistent collab auto-save (every 2 seconds).
    // Saves dirty persistent sessions to disk without interrupting active collaboration.
    let autosave_manager = session_manager.clone();
    let autosave_storage = storage.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            // Get all active persistent session IDs
            let session_ids: Vec<String> = autosave_manager.list_sessions().await
                .into_iter()
                .filter(|s| s.persistent)
                .map(|s| s.session_id)
                .collect();

            for session_id in session_ids {
                if let Some((drawing_id, data, version)) =
                    autosave_manager.get_persistent_save_data(&session_id).await
                {
                    if let Err(e) = autosave_storage.save_persistent(&drawing_id, &data, version).await {
                        tracing::error!(
                            drawing_id = %drawing_id,
                            error = %e,
                            "Failed to auto-save persistent collab session"
                        );
                    }
                }
            }
        }
    });

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!("Listening on {}", config.listen_addr);

    // Use into_make_service_with_connect_info so tower_governor can extract peer IP
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;

    Ok(())
}
