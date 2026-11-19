//! Where the app keeps its settings and library, found the same way Tauri
//! does (data and config folder + the app's identifier), so the command line
//! works on the library the app shows.

use std::path::PathBuf;

use zwopp_core::library::Library;
use zwopp_core::settings::Settings;

/// tauri.conf.json's identifier; a development build adds ".dev" (ADR 0008).
const IDENTIFIER: &str = "digital.weier.zwopp";
/// Points the app and the command line at another library (see README).
const LIBRARY_ENV: &str = "ZWOPP_LIBRARY_DIR";

fn identifier(dev: bool) -> String {
    if dev {
        format!("{IDENTIFIER}.dev")
    } else {
        IDENTIFIER.to_owned()
    }
}

/// The library folder: `ZWOPP_LIBRARY_DIR`, else the one in the settings,
/// else the default in the app's data folder.
pub fn library_dir(dev: bool) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os(LIBRARY_ENV) {
        return Ok(PathBuf::from(dir));
    }
    let id = identifier(dev);
    let settings_file = dirs::config_dir().map(|dir| dir.join(&id).join("settings.json"));
    if let Some(dir) = settings_file
        .and_then(|file| Settings::load(&file).ok())
        .and_then(|settings| settings.library_dir)
    {
        return Ok(dir);
    }
    dirs::data_dir()
        .map(|dir| dir.join(id).join("library"))
        .ok_or_else(|| "no data folder on this system".to_owned())
}

/// Opens the library without scanning all item folders (the app does that).
pub fn open_library(dev: bool) -> Result<Library, String> {
    Library::open_index(library_dir(dev)?).map_err(|e| e.to_string())
}
