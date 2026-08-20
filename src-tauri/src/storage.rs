use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const STORAGE_SCHEMA_VERSION: u32 = 1;
pub const FOUNDATION_MIGRATION: &str = include_str!("storage/migrations/0001_foundation.sql");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageLayout {
    root: PathBuf,
}

impl StorageLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join("prompt-arena.sqlite3")
    }

    pub fn artifact_root(&self) -> PathBuf {
        self.root.join("artifacts")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactStore {
    layout: StorageLayout,
}

impl ArtifactStore {
    pub fn new(layout: StorageLayout) -> Self {
        Self { layout }
    }

    pub fn layout(&self) -> &StorageLayout {
        &self.layout
    }

    /// Resolve a validated relative artifact path without creating, deleting,
    /// or following anything on disk. Byte I/O belongs to a later phase.
    pub fn resolve(&self, artifact: &ArtifactRef) -> Result<PathBuf, StorageError> {
        validate_relative_path(&artifact.relative_path)?;
        Ok(self.layout.artifact_root().join(&artifact.relative_path))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    pub artifact_id: String,
    pub relative_path: String,
    pub schema_version: u32,
    pub sha256: Option<String>,
}

impl ArtifactRef {
    pub fn new(
        artifact_id: impl Into<String>,
        relative_path: impl Into<String>,
    ) -> Result<Self, StorageError> {
        let artifact = Self {
            artifact_id: artifact_id.into(),
            relative_path: relative_path.into(),
            schema_version: STORAGE_SCHEMA_VERSION,
            sha256: None,
        };
        validate_relative_path(&artifact.relative_path)?;
        Ok(artifact)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub artifact_id: String,
    pub kind: String,
    pub relative_path: String,
    pub schema_version: u32,
    pub sha256: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    EmptyArtifactPath,
    AbsoluteArtifactPath,
    TraversalArtifactPath,
    NonPortableArtifactPath,
}

fn validate_relative_path(relative_path: &str) -> Result<(), StorageError> {
    if relative_path.is_empty() {
        return Err(StorageError::EmptyArtifactPath);
    }
    if relative_path.contains('\\') {
        return Err(StorageError::NonPortableArtifactPath);
    }

    let path = Path::new(relative_path);
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir | Component::ParentDir => {
                return Err(StorageError::TraversalArtifactPath)
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(StorageError::AbsoluteArtifactPath)
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ArtifactRef, ArtifactStore, StorageError, StorageLayout, FOUNDATION_MIGRATION};

    #[test]
    fn resolves_only_portable_relative_artifacts() {
        let layout = StorageLayout::new("prompt-arena-data");
        let store = ArtifactStore::new(layout.clone());
        let artifact =
            ArtifactRef::new("case-1", "runs/run-1/output.json").expect("valid artifact");
        assert!(store
            .resolve(&artifact)
            .expect("resolved")
            .ends_with("artifacts/runs/run-1/output.json"));
        assert_eq!(
            layout.database_path(),
            std::path::PathBuf::from("prompt-arena-data/prompt-arena.sqlite3")
        );
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        assert_eq!(
            ArtifactRef::new("bad", "../outside"),
            Err(StorageError::TraversalArtifactPath)
        );
        assert_eq!(
            ArtifactRef::new("bad", "folder\\outside"),
            Err(StorageError::NonPortableArtifactPath)
        );
        assert_eq!(
            ArtifactRef::new("bad", "/outside"),
            Err(StorageError::AbsoluteArtifactPath)
        );
    }

    #[test]
    fn migration_is_schema_only_and_contains_no_destructive_history_operation() {
        assert!(FOUNDATION_MIGRATION.contains("CREATE TABLE"));
        assert!(!FOUNDATION_MIGRATION
            .to_ascii_uppercase()
            .contains("DROP TABLE"));
        assert!(!FOUNDATION_MIGRATION
            .to_ascii_uppercase()
            .contains("DELETE FROM"));
    }
}
