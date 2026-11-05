//! Updates on request: Zwopp looks for a new release shortly after the start
//! and then every few hours, and offers it in the library and the tray menu.
//! It is only downloaded and installed when the user says so (see ADR 0010).
//!
//! Releases publish a `latest.json` with signed installers (tauri-plugin-updater);
//! the public key in tauri.conf.json checks the signature before installing.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Updater, UpdaterExt};

use crate::tray;

/// The first look, once the start is over.
const FIRST_CHECK: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// Points a build at another `latest.json`, e.g. a local one to try the flow.
const ENDPOINT_ENV: &str = "ZWOPP_UPDATE_ENDPOINT";

/// A newer version on offer.
#[derive(Clone, Serialize)]
pub struct Available {
    pub version: String,
    /// The release notes, if the release has them.
    pub notes: Option<String>,
}

/// Download progress, for the library.
#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Default)]
pub struct Updates {
    available: Mutex<Option<Available>>,
    installing: AtomicBool,
}

/// Whether this build looks for updates: an installed one does, a development
/// build only when pointed at an endpoint (it would replace itself otherwise).
pub fn enabled() -> bool {
    !tauri::is_dev() || std::env::var_os(ENDPOINT_ENV).is_some()
}

/// Looks for updates now and then, in the background.
pub fn watch(app: AppHandle) {
    if !enabled() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        pause(FIRST_CHECK).await;
        loop {
            if let Err(e) = check(&app).await {
                eprintln!("could not look for updates: {e}");
            }
            pause(CHECK_EVERY).await;
        }
    });
}

/// The update on offer, if any (as found by the last check).
pub fn available(app: &AppHandle) -> Option<Available> {
    app.state::<Updates>().available.lock().unwrap().clone()
}

/// Looks for an update and, if there is one, offers it.
pub async fn check(app: &AppHandle) -> Result<Option<Available>, String> {
    if !enabled() {
        return Ok(None);
    }
    let Some(update) = updater(app)?.check().await.map_err(err)? else {
        return Ok(None);
    };
    let available = Available {
        version: update.version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
    };
    *app.state::<Updates>().available.lock().unwrap() = Some(available.clone());
    if let Err(e) = tray::offer_update(&app.state::<tray::TrayMenu>(), &available.version) {
        eprintln!("could not offer the update in the tray: {e}");
    }
    let _ = app.emit("update:available", &available);
    Ok(Some(available))
}

/// Downloads and installs the update, then starts the new version. On
/// Windows the installer shows its progress and closes Zwopp itself.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Updates>();
    if state.installing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = download_and_install(app).await;
    state.installing.store(false, Ordering::SeqCst);
    result?;
    app.restart();
}

pub fn install_in_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = install(&app).await {
            eprintln!("update failed: {e}");
            let _ = app.emit("update:failed", e);
        }
    });
}

async fn download_and_install(app: &AppHandle) -> Result<(), String> {
    let update = updater(app)?
        .check()
        .await
        .map_err(err)?
        .ok_or("no update available")?;
    let mut downloaded = 0;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("update:progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(err)
}

fn updater(app: &AppHandle) -> Result<Updater, String> {
    let mut builder = app.updater_builder();
    if let Some(endpoint) = std::env::var_os(ENDPOINT_ENV) {
        let url = endpoint.to_string_lossy().parse().map_err(err)?;
        builder = builder.endpoints(vec![url]).map_err(err)?;
    }
    builder.build().map_err(err)
}

/// Waits without holding an async worker.
async fn pause(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
