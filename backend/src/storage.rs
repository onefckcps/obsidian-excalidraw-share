use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

/// Metadata about a stored drawing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingMeta {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub size_bytes: u64,
}

/// Trait abstracting drawing storage – implement this for different backends
/// (filesystem, S3, SQLite, etc.).
#[allow(async_fn_in_trait)]
pub trait DrawingStorage: Send + Sync + 'static {
    async fn save(&self, id: &str, data: &serde_json::Value) -> Result<DrawingMeta, AppError>;
    async fn load(&self, id: &str) -> Result<serde_json::Value, AppError>;
    async fn delete(&self, id: &str) -> Result<(), AppError>;
    async fn list(&self) -> Result<Vec<DrawingMeta>, AppError>;
    async fn exists(&self, id: &str) -> Result<bool, AppError>;
}

/// Filesystem-backed storage. Each drawing is a JSON file named `<id>.json`.
#[derive(Clone)]
pub struct FileSystemStorage {
    base_path: PathBuf,
}

impl FileSystemStorage {
    pub async fn new(base_path: impl AsRef<Path>) -> Result<Self, AppError> {
        let base_path = base_path.as_ref().to_path_buf();
        fs::create_dir_all(&base_path).await?;
        Ok(Self { base_path })
    }

    fn drawing_path(&self, id: &str) -> PathBuf {
        // Sanitize id to prevent path traversal
        let safe_id: String = id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        self.base_path.join(format!("{safe_id}.json"))
    }
}

impl DrawingStorage for FileSystemStorage {
    async fn save(&self, id: &str, data: &serde_json::Value) -> Result<DrawingMeta, AppError> {
        let path = self.drawing_path(id);
        let json_bytes = serde_json::to_vec(data)?;
        let size_bytes = json_bytes.len() as u64;

        fs::write(&path, &json_bytes).await?;

        Ok(DrawingMeta {
            id: id.to_string(),
            created_at: Utc::now(),
            size_bytes,
        })
    }

    async fn load(&self, id: &str) -> Result<serde_json::Value, AppError> {
        let path = self.drawing_path(id);
        if !path.exists() {
            return Err(AppError::NotFound);
        }
        let bytes = fs::read(&path).await?;
        let data: serde_json::Value = serde_json::from_slice(&bytes)?;
        Ok(data)
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        let path = self.drawing_path(id);
        if !path.exists() {
            return Err(AppError::NotFound);
        }
        fs::remove_file(&path).await?;
        Ok(())
    }

    async fn list(&self) -> Result<Vec<DrawingMeta>, AppError> {
        let mut entries = fs::read_dir(&self.base_path).await?;
        let mut drawings = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                let metadata = entry.metadata().await?;
                let id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                let created_at = metadata
                    .created()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

                drawings.push(DrawingMeta {
                    id,
                    created_at: DateTime::from(created_at),
                    size_bytes: metadata.len(),
                });
            }
        }

        drawings.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(drawings)
    }

    async fn exists(&self, id: &str) -> Result<bool, AppError> {
        Ok(self.drawing_path(id).exists())
    }
}
