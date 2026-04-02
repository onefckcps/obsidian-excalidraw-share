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
    pub source_path: Option<String>,
    pub password_protected: bool,
    pub persistent_collab: bool,
}

/// Lightweight sidecar metadata stored alongside each drawing.
/// Avoids reading the full drawing JSON just to list metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SidecarMeta {
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub password_protected: bool,
    #[serde(default)]
    pub persistent_collab: bool,
}

/// Trait abstracting drawing storage – implement this for different backends
/// (filesystem, S3, SQLite, etc.).
#[allow(async_fn_in_trait)]
pub trait DrawingStorage: Send + Sync + 'static {
    async fn save(&self, id: &str, data: &serde_json::Value, source_path: Option<&str>, password_hash: Option<&str>) -> Result<DrawingMeta, AppError>;
    async fn load(&self, id: &str) -> Result<serde_json::Value, AppError>;
    async fn delete(&self, id: &str) -> Result<(), AppError>;
    async fn list(&self) -> Result<Vec<DrawingMeta>, AppError>;
    async fn exists(&self, id: &str) -> Result<bool, AppError>;

    /// Check if a drawing has persistent collab enabled.
    async fn get_persistent_collab_status(&self, id: &str) -> Result<bool, AppError>;

    /// Save with version tracking for persistent collab (atomic write).
    /// Preserves existing internal fields (`_source_path`, `_password_hash`, etc.)
    /// and sets `_persistent_collab_version` to the provided version.
    async fn save_persistent(
        &self,
        id: &str,
        data: &serde_json::Value,
        version: u64,
    ) -> Result<(), AppError>;

    /// List all drawing IDs that have persistent collab enabled.
    async fn list_persistent_collab_drawings(&self) -> Result<Vec<String>, AppError>;
}

/// Filesystem-backed storage. Each drawing is a JSON file named `<id>.json`
/// with a lightweight sidecar `<id>.meta.json` for fast listing.
#[derive(Clone)]
pub struct FileSystemStorage {
    base_path: PathBuf,
}

impl FileSystemStorage {
    pub async fn new(base_path: impl AsRef<Path>) -> Result<Self, AppError> {
        let base_path = base_path.as_ref().to_path_buf();
        fs::create_dir_all(&base_path).await?;

        let storage = Self { base_path };

        // Migrate: generate sidecar files for any existing drawings that lack them
        storage.migrate_sidecars().await;

        Ok(storage)
    }

    fn drawing_path(&self, id: &str) -> PathBuf {
        // Sanitize id to prevent path traversal
        let safe_id: String = id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        self.base_path.join(format!("{safe_id}.json"))
    }

    fn meta_path(&self, id: &str) -> PathBuf {
        let safe_id: String = id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        self.base_path.join(format!("{safe_id}.meta.json"))
    }

    /// Write the sidecar metadata file for a drawing.
    async fn write_sidecar(&self, id: &str, meta: &SidecarMeta) -> Result<(), AppError> {
        let path = self.meta_path(id);
        let json_bytes = serde_json::to_vec(meta)?;
        fs::write(&path, &json_bytes).await?;
        Ok(())
    }

    /// Read the sidecar metadata file for a drawing.
    async fn read_sidecar(&self, id: &str) -> Option<SidecarMeta> {
        let path = self.meta_path(id);
        match fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).ok(),
            Err(_) => None,
        }
    }

    /// One-time migration: generate sidecar files for drawings that don't have them.
    /// This reads the full JSON only once per drawing, then writes a tiny sidecar.
    async fn migrate_sidecars(&self) {
        let mut entries = match fs::read_dir(&self.base_path).await {
            Ok(e) => e,
            Err(_) => return,
        };

        let mut migrated = 0u32;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            // Only process .json files (not .meta.json)
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !filename.ends_with(".json") || filename.ends_with(".meta.json") {
                continue;
            }

            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if id.is_empty() {
                continue;
            }

            // Skip if sidecar already exists
            let meta_path = self.meta_path(&id);
            if meta_path.exists() {
                continue;
            }

            // Read the full drawing to extract metadata
            match fs::read(&path).await {
                Ok(bytes) => {
                    let parsed = serde_json::from_slice::<serde_json::Value>(&bytes)
                        .ok()
                        .map(|json| {
                            let sp = json.get("_source_path")
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            let pw = json.get("_password_hash")
                                .and_then(|v| v.as_str())
                                .is_some();
                            let pc = json.get("_persistent_collab")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            (sp, pw, pc)
                        });

                    let (source_path, password_protected, persistent_collab) = parsed.unwrap_or((None, false, false));

                    // Use file system creation time as best-effort, or fall back to now
                    let created_at = entry.metadata().await
                        .ok()
                        .and_then(|m| m.created().ok())
                        .map(DateTime::from)
                        .unwrap_or_else(Utc::now);

                    let sidecar = SidecarMeta {
                        created_at,
                        source_path,
                        password_protected,
                        persistent_collab,
                    };

                    if let Err(e) = self.write_sidecar(&id, &sidecar).await {
                        tracing::warn!(id = %id, error = %e, "Failed to migrate sidecar metadata");
                    } else {
                        migrated += 1;
                    }
                }
                Err(e) => {
                    tracing::warn!(id = %id, error = %e, "Failed to read drawing for sidecar migration");
                }
            }
        }

        if migrated > 0 {
            tracing::info!(count = migrated, "Migrated sidecar metadata files for existing drawings");
        }
    }
}

impl DrawingStorage for FileSystemStorage {
    async fn save(&self, id: &str, data: &serde_json::Value, source_path: Option<&str>, password_hash: Option<&str>) -> Result<DrawingMeta, AppError> {
        let path = self.drawing_path(id);

        // Read existing drawing to preserve persistent collab fields
        let existing = if path.exists() {
            fs::read(&path).await
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        } else {
            None
        };

        let mut data_with_meta = data.clone();
        if let Some(obj) = data_with_meta.as_object_mut() {
            if let Some(sp) = source_path {
                obj.insert("_source_path".to_string(), serde_json::Value::String(sp.to_string()));
            }
            // Store or remove password hash
            if let Some(ph) = password_hash {
                obj.insert("_password_hash".to_string(), serde_json::Value::String(ph.to_string()));
            } else {
                obj.remove("_password_hash");
            }

            // Preserve persistent collab fields from existing drawing if not in new data
            if let Some(ref existing_data) = existing {
                if !obj.contains_key("_persistent_collab") {
                    if let Some(pc) = existing_data.get("_persistent_collab") {
                        obj.insert("_persistent_collab".to_string(), pc.clone());
                    }
                }
                if !obj.contains_key("_persistent_collab_version") {
                    if let Some(pcv) = existing_data.get("_persistent_collab_version") {
                        obj.insert("_persistent_collab_version".to_string(), pcv.clone());
                    }
                }
                if !obj.contains_key("_persistent_collab_password_hash") {
                    if let Some(pcph) = existing_data.get("_persistent_collab_password_hash") {
                        obj.insert("_persistent_collab_password_hash".to_string(), pcph.clone());
                    }
                }
            }
        }

        let json_bytes = serde_json::to_vec(&data_with_meta)?;
        let size_bytes = json_bytes.len() as u64;

        fs::write(&path, &json_bytes).await?;

        // Determine created_at: preserve from existing sidecar, or use now for new drawings
        let existing_sidecar = self.read_sidecar(id).await;
        let created_at = existing_sidecar
            .as_ref()
            .map(|m| m.created_at)
            .unwrap_or_else(Utc::now);

        let password_protected = password_hash.is_some();

        // Determine persistent_collab from the saved data
        let persistent_collab = data_with_meta
            .get("_persistent_collab")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Write/update sidecar metadata (tiny file, fast)
        let sidecar = SidecarMeta {
            created_at,
            source_path: source_path.map(String::from),
            password_protected,
            persistent_collab,
        };
        self.write_sidecar(id, &sidecar).await?;

        Ok(DrawingMeta {
            id: id.to_string(),
            created_at,
            size_bytes,
            source_path: source_path.map(String::from),
            password_protected,
            persistent_collab,
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

        // Also remove sidecar metadata
        let meta_path = self.meta_path(id);
        let _ = fs::remove_file(&meta_path).await; // Ignore error if sidecar doesn't exist

        Ok(())
    }

    /// List all drawings using lightweight sidecar metadata files.
    /// Never reads the full drawing JSON — only the tiny .meta.json files.
    async fn list(&self) -> Result<Vec<DrawingMeta>, AppError> {
        let mut entries = fs::read_dir(&self.base_path).await?;
        let mut drawings = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // Only process .json files (not .meta.json)
            if !filename.ends_with(".json") || filename.ends_with(".meta.json") {
                continue;
            }

            let file_metadata = entry.metadata().await?;
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if id.is_empty() {
                continue;
            }

            // Read the lightweight sidecar (typically < 200 bytes)
            let sidecar = self.read_sidecar(&id).await;

            let (created_at, source_path, password_protected, persistent_collab) = match sidecar {
                Some(meta) => (meta.created_at, meta.source_path, meta.password_protected, meta.persistent_collab),
                None => {
                    // Sidecar missing — use filesystem metadata as fallback
                    let created_at = file_metadata
                        .created()
                        .map(DateTime::from)
                        .unwrap_or_else(|_| Utc::now());
                    (created_at, None, false, false)
                }
            };

            drawings.push(DrawingMeta {
                id,
                created_at,
                size_bytes: file_metadata.len(),
                source_path,
                password_protected,
                persistent_collab,
            });
        }

        drawings.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(drawings)
    }

    async fn exists(&self, id: &str) -> Result<bool, AppError> {
        Ok(self.drawing_path(id).exists())
    }

    async fn get_persistent_collab_status(&self, id: &str) -> Result<bool, AppError> {
        // First check if the drawing exists
        let path = self.drawing_path(id);
        if !path.exists() {
            return Err(AppError::NotFound);
        }

        // Read from sidecar for fast access
        if let Some(sidecar) = self.read_sidecar(id).await {
            return Ok(sidecar.persistent_collab);
        }

        // Fallback: read from the drawing JSON itself
        let bytes = fs::read(&path).await?;
        let data: serde_json::Value = serde_json::from_slice(&bytes)?;
        Ok(data.get("_persistent_collab")
            .and_then(|v| v.as_bool())
            .unwrap_or(false))
    }

    async fn save_persistent(
        &self,
        id: &str,
        data: &serde_json::Value,
        version: u64,
    ) -> Result<(), AppError> {
        let path = self.drawing_path(id);
        if !path.exists() {
            return Err(AppError::NotFound);
        }

        // Load existing drawing to preserve internal fields
        let existing_bytes = fs::read(&path).await?;
        let existing: serde_json::Value = serde_json::from_slice(&existing_bytes)?;

        let mut data_with_meta = data.clone();
        if let Some(obj) = data_with_meta.as_object_mut() {
            // Preserve _source_path from existing
            if let Some(sp) = existing.get("_source_path") {
                obj.insert("_source_path".to_string(), sp.clone());
            }
            // Preserve _password_hash from existing
            if let Some(ph) = existing.get("_password_hash") {
                obj.insert("_password_hash".to_string(), ph.clone());
            }
            // Preserve _persistent_collab_password_hash from existing
            if let Some(pcph) = existing.get("_persistent_collab_password_hash") {
                obj.insert("_persistent_collab_password_hash".to_string(), pcph.clone());
            }
            // Ensure persistent collab flag stays true
            obj.insert("_persistent_collab".to_string(), serde_json::Value::Bool(true));
            // Set the version
            obj.insert("_persistent_collab_version".to_string(), serde_json::json!(version));
        }

        let json_bytes = serde_json::to_vec(&data_with_meta)?;

        // Atomic write: write to tmp file first, then rename
        let tmp_path = self.base_path.join(format!(
            "{}.json.tmp",
            id.chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect::<String>()
        ));
        fs::write(&tmp_path, &json_bytes).await?;
        fs::rename(&tmp_path, &path).await?;

        tracing::debug!(id = %id, version = version, "Persistent collab save completed");

        // Update sidecar metadata
        let existing_sidecar = self.read_sidecar(id).await;
        let created_at = existing_sidecar
            .as_ref()
            .map(|m| m.created_at)
            .unwrap_or_else(Utc::now);
        let source_path = existing_sidecar
            .as_ref()
            .and_then(|m| m.source_path.clone());
        let password_protected = existing_sidecar
            .as_ref()
            .map(|m| m.password_protected)
            .unwrap_or(false);

        let sidecar = SidecarMeta {
            created_at,
            source_path,
            password_protected,
            persistent_collab: true,
        };
        self.write_sidecar(id, &sidecar).await?;

        Ok(())
    }

    async fn list_persistent_collab_drawings(&self) -> Result<Vec<String>, AppError> {
        let mut entries = fs::read_dir(&self.base_path).await?;
        let mut ids = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // Only process .meta.json sidecar files
            if !filename.ends_with(".meta.json") {
                continue;
            }

            // Extract the drawing ID from the sidecar filename
            let id = filename.strip_suffix(".meta.json").unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }

            // Read the sidecar and check persistent_collab flag
            if let Some(sidecar) = self.read_sidecar(&id).await {
                if sidecar.persistent_collab {
                    ids.push(id);
                }
            }
        }

        Ok(ids)
    }
}
