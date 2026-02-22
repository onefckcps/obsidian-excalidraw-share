mod auth;
mod error;
mod routes;
mod storage;

use axum::{
    middleware,
    routing::{delete, get, post},
    Router,
};
use clap::Parser;
use std::path::PathBuf;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
    limit::RequestBodyLimitLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use auth::ApiKey;
use routes::AppState;
use storage::FileSystemStorage;

#[derive(Parser, Debug)]
#[command(name = "excalidraw-share", about = "Self-hosted Excalidraw sharing server")]
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

    tracing::info!(
        listen = %config.listen_addr,
        data_dir = %config.data_dir.display(),
        base_url = %config.base_url,
        max_upload_mb = config.max_upload_mb,
        "Starting excalidraw-share server"
    );

    let storage = FileSystemStorage::new(&config.data_dir).await?;

    let app_state = AppState {
        storage: storage.clone(),
        base_url: config.base_url.clone(),
    };

    let api_key = ApiKey(config.api_key.clone());
    let body_limit = config.max_upload_mb * 1024 * 1024;

    let index_file = config.frontend_dir.join("index.html");
    let frontend_service = ServeDir::new(&config.frontend_dir)
        .not_found_service(ServeFile::new(&index_file));

    // Public API routes (no auth required)
    let public_api = Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/public/drawings", get(routes::list_drawings_public))
        .route("/api/view/{id}", get(routes::get_drawing));

    // Protected API routes (auth required)
    let protected_api = Router::new()
        .route("/api/upload", post(routes::upload_drawing))
        .route("/api/drawings/{id}", delete(routes::delete_drawing))
        .route("/api/drawings", get(routes::list_drawings))
        .layer(axum::extract::DefaultBodyLimit::max(body_limit))
        .route_layer(middleware::from_fn_with_state(
            api_key.clone(),
            auth::api_key_middleware,
        ));

    let app = Router::new()
        .merge(public_api)
        .merge(protected_api)
        .fallback_service(frontend_service)
        .with_state(app_state)
        .layer(CompressionLayer::new())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!("Listening on {}", config.listen_addr);

    axum::serve(listener, app).await?;

    Ok(())
}
