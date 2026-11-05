//! "Report a problem": what Zwopp can say about itself for an issue on
//! GitHub. Nothing is sent from here; the UI opens GitHub's issue form,
//! filled in with this, and the user reviews and submits it there (ADR 0011).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// The log file, in the app's log folder (`tauri-plugin-log`).
pub const LOG_FILE: &str = "zwopp";
/// Issues can only be opened here.
const ISSUES: &str = "https://github.com/cwecode/zwopp/issues/new";
/// The end of the log that goes into a report; a prefilled link must stay
/// within the length browsers and GitHub accept.
const LOG_LINES: usize = 40;
const LOG_CHARS: usize = 3000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportInfo {
    version: String,
    /// One of the operating systems of the bug form's dropdown.
    os: &'static str,
    /// System, architecture and monitors, e.g. "… [64-bit], x86_64, 2 monitor(s): …".
    os_details: String,
    /// The last lines of the log, with the user's name and home folder left out.
    log: String,
}

pub fn info(app: &AppHandle) -> ReportInfo {
    let system = os_info::get();
    let monitors = app
        .available_monitors()
        .map(|monitors| {
            let list: Vec<String> = monitors
                .iter()
                .map(|m| {
                    format!(
                        "{}×{} at {} %",
                        m.size().width,
                        m.size().height,
                        (m.scale_factor() * 100.0).round()
                    )
                })
                .collect();
            format!("{} monitor(s): {}", list.len(), list.join(", "))
        })
        .unwrap_or_default();
    ReportInfo {
        version: app.package_info().version.to_string(),
        os: os_option(&system),
        // E.g. "Windows 10.0.26200 (Windows 11 Professional) [64-bit]".
        os_details: format!("{system}, {}, {monitors}", std::env::consts::ARCH),
        log: log_tail(app),
    }
}

/// Opens a prefilled issue form in the browser; other addresses are refused.
pub fn open_issue(app: &AppHandle, url: &str) -> Result<(), String> {
    if !url.starts_with(&format!("{ISSUES}?")) {
        return Err("not an issue form of Zwopp".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows the log folder in the file manager.
pub fn open_log_folder(app: &AppHandle) -> Result<(), String> {
    let dir = log_dir(app).ok_or("no log folder")?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn log_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok()
}

/// The matching option of the "Operating system" dropdown in bug_report.yml.
fn os_option(system: &os_info::Info) -> &'static str {
    match system.os_type() {
        os_info::Type::Windows => {
            // Windows 11 still reports itself as 10.0, from build 22000 on.
            let build = match system.version() {
                os_info::Version::Semantic(_, _, build) => *build,
                _ => 0,
            };
            if build >= 22000 {
                "Windows 11"
            } else {
                "Windows 10"
            }
        }
        os_info::Type::Macos if cfg!(target_arch = "aarch64") => "macOS (Apple silicon)",
        os_info::Type::Macos => "macOS (Intel)",
        _ if std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s == "wayland") => "Linux (Wayland)",
        _ => "Linux (X11)",
    }
}

/// The end of the log, without the home folder and user name.
fn log_tail(app: &AppHandle) -> String {
    let Some(path) = log_dir(app).map(|dir| dir.join(format!("{LOG_FILE}.log"))) else {
        return String::new();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let mut tail = lines[lines.len().saturating_sub(LOG_LINES)..].join("\n");
    if tail.len() > LOG_CHARS {
        let cut = tail.len() - LOG_CHARS;
        let start = tail[cut..].find('\n').map_or(cut, |i| cut + i + 1);
        tail = tail[start..].to_owned();
    }
    redact(&tail, app.path().home_dir().ok(), user_name())
}

fn user_name() -> Option<String> {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .filter(|name| name.len() >= 2)
}

/// Replaces the home folder with "~" and the user name with "<user>".
fn redact(text: &str, home: Option<PathBuf>, user: Option<String>) -> String {
    let mut text = text.to_owned();
    if let Some(home) = home {
        let home = home.to_string_lossy().into_owned();
        text = text.replace(&home, "~");
        // Logs also contain paths with the other kind of slash.
        text = text.replace(&home.replace('\\', "/"), "~");
    }
    if let Some(user) = user {
        text = text.replace(&user, "<user>");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_folder_and_user_name_are_left_out() {
        let text = r"could not save C:\Users\maxm\Pictures\a.png; C:/Users/maxm/x; maxm logged in";
        let redacted = redact(
            text,
            Some(PathBuf::from(r"C:\Users\maxm")),
            Some("maxm".into()),
        );
        assert_eq!(
            redacted,
            r"could not save ~\Pictures\a.png; ~/x; <user> logged in"
        );
    }
}
