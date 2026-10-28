//! User settings, stored as one JSON file outside the library folder (the
//! folder itself is one of the settings).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Result;
use crate::error::IoContext;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// UI language ("de", "en"); `None` follows the system.
    pub language: Option<String>,
    /// Capture hotkey as a Tauri accelerator, e.g. `CommandOrControl+Shift+X`;
    /// `None` takes the first free one of the built-in defaults.
    pub capture_hotkey: Option<String>,
    /// Library folder; `None` uses the default in the app's data folder.
    pub library_dir: Option<PathBuf>,
    /// Copy every capture to the clipboard.
    pub copy_after_capture: bool,
    /// Open every capture in the editor.
    pub edit_after_capture: bool,
    /// Editor defaults and quick styles. Only the UI reads them, so the core
    /// stores them as they come.
    pub editor: serde_json::Value,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: None,
            capture_hotkey: None,
            library_dir: None,
            copy_after_capture: true,
            edit_after_capture: true,
            editor: serde_json::Value::Object(Default::default()),
        }
    }
}

impl Settings {
    /// Reads the settings; a missing file gives the defaults, missing fields
    /// their default values.
    pub fn load(path: &Path) -> Result<Self> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e).at(path),
        }
    }

    /// Writes the settings; a crash midway leaves the previous file intact.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).at(dir)?;
        }
        let partial = path.with_extension("json.partial");
        std::fs::write(&partial, serde_json::to_vec_pretty(self)?).at(&partial)?;
        std::fs::rename(&partial, path).at(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings::load(&dir.path().join("settings.json")).unwrap();
        assert_eq!(settings, Settings::default());
        assert!(settings.copy_after_capture && settings.edit_after_capture);
    }

    #[test]
    fn round_trips_and_fills_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let settings = Settings {
            language: Some("en".into()),
            capture_hotkey: Some("CommandOrControl+Alt+S".into()),
            library_dir: Some(dir.path().join("shots")),
            edit_after_capture: false,
            editor: serde_json::json!({ "quickStyles": [{ "name": "Rot" }] }),
            ..Settings::default()
        };
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), settings);
        assert!(!path.with_extension("json.partial").exists());

        std::fs::write(&path, r#"{ "language": "de" }"#).unwrap();
        let older = Settings::load(&path).unwrap();
        assert_eq!(older.language.as_deref(), Some("de"));
        assert!(older.copy_after_capture);
    }

    #[test]
    fn broken_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(Settings::load(&path).is_err());
    }
}
