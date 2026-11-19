//! An MCP server over stdio (`zwopp mcp`): AI agents such as Claude Code take
//! screenshots, look at them and find them in the library (ADR 0012).
//!
//! JSON-RPC 2.0, one message per line. Only what the tools need: `initialize`,
//! `tools/list`, `tools/call` and `ping`.

use std::io::{BufRead, Write};
use std::path::PathBuf;

use base64::Engine;
use serde_json::{Value, json};
use zwopp_core::capture::{self, DesktopRect};
use zwopp_core::library::{ItemUpdate, Library, ListQuery};

use crate::ops::{self, Target};

const PROTOCOL_VERSION: &str = "2025-06-18";
/// Images for the agent: about as large as models look at closely.
const PREVIEW_EDGE: u32 = 1568;

pub struct Server {
    library: Library,
    /// The app, for `open_in_editor`.
    app_exe: Option<PathBuf>,
}

impl Server {
    pub fn new(library: Library, app_exe: Option<PathBuf>) -> Self {
        Self { library, app_exe }
    }

    /// Answers requests from stdin on stdout until stdin closes.
    pub fn serve(&self) -> std::io::Result<()> {
        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout();
        for line in stdin.lock().lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            if let Some(reply) = self.handle(&line) {
                writeln!(stdout, "{reply}")?;
                stdout.flush()?;
            }
        }
        Ok(())
    }

    /// The reply to one message; notifications get none.
    pub fn handle(&self, line: &str) -> Option<Value> {
        let message: Value = match serde_json::from_str(line) {
            Ok(message) => message,
            Err(e) => return Some(error(Value::Null, -32700, &format!("parse error: {e}"))),
        };
        let id = message.get("id").cloned()?;
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        Some(match method {
            "initialize" => result(
                id,
                json!({
                    "protocolVersion": params
                        .get("protocolVersion")
                        .and_then(Value::as_str)
                        .unwrap_or(PROTOCOL_VERSION),
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "zwopp", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Zwopp is the user's screenshot tool. Take screenshots of \
                        the screen, a window or a region; every one is saved to the user's \
                        Zwopp library. Find earlier ones with list_screenshots and look at them \
                        with get_screenshot. open_in_editor lets the user annotate one.",
                }),
            ),
            "ping" => result(id, json!({})),
            "tools/list" => result(id, json!({ "tools": tools() })),
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let content = match self.call(name, &args) {
                    Ok(content) => json!({ "content": content, "isError": false }),
                    Err(e) => json!({ "content": [text(&e)], "isError": true }),
                };
                result(id, content)
            }
            _ => error(id, -32601, &format!("unknown method {method}")),
        })
    }

    fn call(&self, name: &str, args: &Value) -> Result<Vec<Value>, String> {
        let str_arg = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_owned);
        let id = || str_arg("id").ok_or("missing argument: id".to_owned());
        match name {
            "take_screenshot" => {
                let target = target(args)?;
                let tags = string_list(args.get("tags"));
                let (item, image) = ops::capture(&self.library, &target, str_arg("title"), tags)?;
                let mut content = vec![json_text(&item)];
                if args.get("include_image").and_then(Value::as_bool) != Some(false) {
                    content.push(image_content(&ops::png(&image, PREVIEW_EDGE)?));
                }
                Ok(content)
            }
            "list_screenshots" => {
                let query = ListQuery {
                    search: str_arg("search"),
                    app: str_arg("app"),
                    favorites_only: args.get("favorites_only").and_then(Value::as_bool)
                        == Some(true),
                    ..ListQuery::default()
                };
                let limit = args
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(20)
                    .min(100) as u32;
                let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0);
                Ok(vec![json_text(&ops::list(
                    &self.library,
                    &query,
                    offset,
                    limit,
                )?)])
            }
            "get_screenshot" => {
                let id = id()?;
                let edge = args
                    .get("max_size")
                    .and_then(Value::as_u64)
                    .map_or(PREVIEW_EDGE, |size| size.clamp(64, 4096) as u32);
                Ok(vec![
                    json_text(&ops::get(&self.library, &id)?),
                    image_content(&ops::preview_png(&self.library, &id, edge)?),
                ])
            }
            "export_screenshot" => {
                let path = PathBuf::from(str_arg("path").ok_or("missing argument: path")?);
                if !path.is_absolute() {
                    return Err("path must be absolute".into());
                }
                let written = ops::export(&self.library, &id()?, &path)?;
                Ok(vec![text(&format!("Saved to {}", written.display()))])
            }
            "update_screenshot" => {
                let update = ItemUpdate {
                    title: str_arg("title"),
                    favorite: args.get("favorite").and_then(Value::as_bool),
                    tags: args.get("tags").map(|tags| string_list(Some(tags))),
                };
                Ok(vec![json_text(&ops::update(
                    &self.library,
                    &id()?,
                    update,
                )?)])
            }
            "list_windows" => Ok(vec![json_text(&capture::list_windows().map_err(ops::err)?)]),
            "list_monitors" => Ok(vec![json_text(&capture::monitors().map_err(ops::err)?)]),
            "open_in_editor" => {
                let id = id()?;
                ops::get(&self.library, &id)?;
                let exe = self
                    .app_exe
                    .as_ref()
                    .ok_or("the Zwopp app is not available here")?;
                std::process::Command::new(exe)
                    .args(["--open", &id])
                    .spawn()
                    .map_err(ops::err)?;
                Ok(vec![text("Opened in the Zwopp editor.")])
            }
            _ => Err(format!("unknown tool {name}")),
        }
    }
}

fn target(args: &Value) -> Result<Target, String> {
    let kind = args
        .get("target")
        .and_then(Value::as_str)
        .unwrap_or("screen");
    Ok(match kind {
        "screen" => Target::Screen(
            args.get("monitor")
                .and_then(Value::as_u64)
                .map(|m| m as usize),
        ),
        "window" => Target::Window(
            args.get("window")
                .and_then(Value::as_str)
                .ok_or("target \"window\" needs the argument window (part of its title or app)")?
                .to_owned(),
        ),
        "focused_window" => Target::Focused,
        "region" => {
            let region = args
                .get("region")
                .ok_or("target \"region\" needs the argument region")?;
            let num = |key: &str| {
                region
                    .get(key)
                    .and_then(Value::as_i64)
                    .ok_or(format!("region needs {key}"))
            };
            Target::Region(DesktopRect {
                x: num("x")? as i32,
                y: num("y")? as i32,
                width: num("width")?.max(1) as u32,
                height: num("height")?.max(1) as u32,
            })
        }
        other => return Err(format!("unknown target {other}")),
    })
}

fn tools() -> Value {
    let id = json!({ "type": "string", "description": "The screenshot's id, from list_screenshots or take_screenshot." });
    json!([
        {
            "name": "take_screenshot",
            "description": "Takes a screenshot without any user interaction and saves it to the user's Zwopp library. Returns its id and metadata, and the image itself.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": { "type": "string", "enum": ["screen", "window", "focused_window", "region"], "description": "What to capture; default: the primary screen." },
                    "monitor": { "type": "integer", "description": "For target screen: the monitor's index (list_monitors); default: the primary one." },
                    "window": { "type": "string", "description": "For target window: part of the window's title or application name (list_windows)." },
                    "region": {
                        "type": "object",
                        "description": "For target region: a rectangle in desktop pixels (list_monitors gives the monitors' positions).",
                        "properties": { "x": { "type": "integer" }, "y": { "type": "integer" }, "width": { "type": "integer" }, "height": { "type": "integer" } },
                        "required": ["x", "y", "width", "height"]
                    },
                    "title": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "include_image": { "type": "boolean", "description": "Return the image too (default true)." }
                }
            }
        },
        {
            "name": "list_screenshots",
            "description": "Lists screenshots in the user's Zwopp library, newest first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "search": { "type": "string", "description": "Words in the title or tags." },
                    "app": { "type": "string", "description": "Only screenshots taken in this application." },
                    "favorites_only": { "type": "boolean" },
                    "limit": { "type": "integer", "description": "Default 20, at most 100." },
                    "offset": { "type": "integer" }
                }
            }
        },
        {
            "name": "get_screenshot",
            "description": "Returns a screenshot from the library (with its annotations, if any) and its metadata.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": id, "max_size": { "type": "integer", "description": "Longest edge of the returned image in pixels; default 1568." } },
                "required": ["id"]
            }
        },
        {
            "name": "export_screenshot",
            "description": "Saves a screenshot as a file (PNG, JPG, WebP or GIF by the extension), e.g. to attach it to an issue.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": id, "path": { "type": "string", "description": "Absolute file path." } },
                "required": ["id", "path"]
            }
        },
        {
            "name": "update_screenshot",
            "description": "Changes a screenshot's title, tags or favorite flag.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": id,
                    "title": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" }
                },
                "required": ["id"]
            }
        },
        {
            "name": "list_windows",
            "description": "Lists the visible windows (title, application, position), topmost first, to pick one for take_screenshot.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_monitors",
            "description": "Lists the monitors with their index, position and size.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "open_in_editor",
            "description": "Opens a screenshot in the Zwopp editor for the user, e.g. to annotate it.",
            "inputSchema": { "type": "object", "properties": { "id": id }, "required": ["id"] }
        }
    ])
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn text(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

fn json_text(value: &impl serde::Serialize) -> Value {
    text(&serde_json::to_string_pretty(value).unwrap_or_default())
}

fn image_content(png: &[u8]) -> Value {
    json!({
        "type": "image",
        "mimeType": "image/png",
        "data": base64::engine::general_purpose::STANDARD.encode(png),
    })
}

fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> (tempfile::TempDir, Server) {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path()).unwrap();
        library.add(&image::RgbaImage::new(40, 30)).unwrap();
        (dir, Server::new(library, None))
    }

    fn call(server: &Server, request: Value) -> Value {
        server.handle(&request.to_string()).unwrap()
    }

    #[test]
    fn initialize_and_list_tools() {
        let (_dir, server) = server();
        let init = call(
            &server,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }),
        );
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "zwopp");
        // Notifications get no reply.
        assert!(
            server
                .handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
                .is_none()
        );
        let tools = call(
            &server,
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        );
        let names: Vec<&str> = tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"take_screenshot") && names.contains(&"get_screenshot"));
    }

    #[test]
    fn list_get_and_update_screenshots() {
        let (_dir, server) = server();
        let tool = |name: &str, arguments: Value| {
            call(&server, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": name, "arguments": arguments } }))["result"].clone()
        };
        let list = tool("list_screenshots", json!({}));
        let items: Value =
            serde_json::from_str(list["content"][0]["text"].as_str().unwrap()).unwrap();
        let id = items[0]["id"].as_str().unwrap().to_owned();

        let got = tool("get_screenshot", json!({ "id": id }));
        assert_eq!(got["isError"], false);
        assert_eq!(got["content"][1]["type"], "image");
        assert_eq!(got["content"][1]["mimeType"], "image/png");

        let updated = tool(
            "update_screenshot",
            json!({ "id": id, "title": "Login", "tags": ["bug"] }),
        );
        let item: Value =
            serde_json::from_str(updated["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(item["title"], "Login");
        assert_eq!(item["tags"], json!(["bug"]));

        let bad = tool("get_screenshot", json!({ "id": "nope" }));
        assert_eq!(bad["isError"], true);
        let relative = tool("export_screenshot", json!({ "id": id, "path": "out.png" }));
        assert_eq!(relative["isError"], true);
    }

    #[test]
    fn unknown_methods_are_errors() {
        let (_dir, server) = server();
        let reply = call(
            &server,
            json!({ "jsonrpc": "2.0", "id": 9, "method": "resources/list" }),
        );
        assert_eq!(reply["error"]["code"], -32601);
        let broken = server.handle("{ nope").unwrap();
        assert_eq!(broken["error"]["code"], -32700);
    }
}
