use std::time::Duration;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::{capture, show_main};

/// Delays offered for a capture, in seconds.
pub const DELAYS: [u64; 3] = [3, 5, 10];

/// The tray menu entries, kept to translate them when the UI language changes.
pub struct TrayMenu {
    capture: MenuItem<Wry>,
    delayed: Submenu<Wry>,
    delays: Vec<MenuItem<Wry>>,
    library: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Menu texts in a language ("de" or anything else for English).
struct Texts {
    capture: &'static str,
    delayed: &'static str,
    seconds: fn(u64) -> String,
    library: &'static str,
    settings: &'static str,
    quit: &'static str,
}

/// The web UI decides the language and reports it via `set_language`.
fn texts(language: &str) -> Texts {
    match language {
        "de" => Texts {
            capture: "Screenshot aufnehmen",
            delayed: "Verzögert aufnehmen",
            seconds: |s| format!("In {s} Sekunden"),
            library: "Bibliothek öffnen",
            settings: "Einstellungen",
            quit: "Beenden",
        },
        _ => Texts {
            capture: "Take screenshot",
            delayed: "Take screenshot with delay",
            seconds: |s| format!("In {s} seconds"),
            library: "Open library",
            settings: "Settings",
            quit: "Quit",
        },
    }
}

pub fn create(app: &AppHandle, capture_shortcut: Option<&str>) -> tauri::Result<()> {
    // English until the main window reports its language, right after it loaded.
    let text = texts("en");
    let capture = MenuItem::with_id(app, "capture", text.capture, true, capture_shortcut)?;
    let delays = DELAYS
        .iter()
        .map(|s| {
            MenuItem::with_id(
                app,
                format!("delay-{s}"),
                (text.seconds)(*s),
                true,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let delay_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        delays.iter().map(|item| item as _).collect();
    let delayed = Submenu::with_items(app, text.delayed, true, &delay_refs)?;
    let library = MenuItem::with_id(app, "library", text.library, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", text.settings, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture, &delayed, &library, &settings, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Screenbook")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => capture::start_in_background(app.clone(), Duration::ZERO),
            "library" => show_main(app),
            "settings" => {
                show_main(app);
                let _ = app.emit_to("main", "app:settings", ());
            }
            "quit" => app.exit(0),
            id => {
                if let Some(seconds) = id.strip_prefix("delay-").and_then(|s| s.parse().ok()) {
                    capture::start_in_background(app.clone(), Duration::from_secs(seconds));
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayMenu {
        capture,
        delayed,
        delays,
        library,
        settings,
        quit,
    });
    Ok(())
}

/// Translates the tray menu.
pub fn set_language(menu: &TrayMenu, language: &str) -> tauri::Result<()> {
    let text = texts(language);
    menu.capture.set_text(text.capture)?;
    menu.delayed.set_text(text.delayed)?;
    for (item, seconds) in menu.delays.iter().zip(DELAYS) {
        item.set_text((text.seconds)(seconds))?;
    }
    menu.library.set_text(text.library)?;
    menu.settings.set_text(text.settings)?;
    menu.quit.set_text(text.quit)
}

/// Shows the capture hotkey next to the capture entry.
pub fn set_shortcut(menu: &TrayMenu, accelerator: Option<&str>) -> tauri::Result<()> {
    menu.capture.set_accelerator(accelerator)
}
