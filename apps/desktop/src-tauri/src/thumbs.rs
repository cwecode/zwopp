//! The `thumb://` protocol: serves library thumbnails by item id.
//!
//! `thumb://localhost/<id>?v=<updatedAt>` (`http://thumb.localhost/…` on
//! Windows). The version in the URL changes whenever the item does, so a real
//! thumbnail is sent as immutable and the webview keeps it cached; the
//! original shown until the thumbnail exists must not be cached.

use std::path::Path;

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};
use uuid::Uuid;

use crate::AppState;

pub const SCHEME: &str = "thumb";

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    // Reading files is blocking work; keep it off the webview's thread.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(state) = app.try_state::<AppState>() else {
            return responder.respond(status(StatusCode::SERVICE_UNAVAILABLE));
        };
        let id = request.uri().path().trim_start_matches('/').parse::<Uuid>();
        let Some(path) = id.ok().and_then(|id| state.library.preview_path(id).ok()) else {
            return responder.respond(status(StatusCode::NOT_FOUND));
        };
        responder.respond(match std::fs::read(&path) {
            Ok(bytes) => file(&path, bytes),
            Err(_) => status(StatusCode::NOT_FOUND),
        });
    });
}

fn file(path: &Path, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let is_thumbnail = path.extension().is_some_and(|ext| ext == "webp");
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            if is_thumbnail {
                "image/webp"
            } else {
                "image/png"
            },
        )
        .header(
            header::CACHE_CONTROL,
            if is_thumbnail {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
        )
        .body(bytes)
        .unwrap()
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap()
}
