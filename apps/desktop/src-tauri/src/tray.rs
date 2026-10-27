use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::{capture, show_main};

/// The tray menu entries, kept to translate them when the UI language changes.
pub struct TrayMenu {
    capture: MenuItem<Wry>,
    library: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Capture, library and quit entries in `language` ("de" or anything else for English).
/// The web UI decides the language and reports it via `set_language`.
fn texts(language: &str) -> [&'static str; 3] {
    match language {
        "de" => ["Screenshot aufnehmen", "Bibliothek öffnen", "Beenden"],
        _ => ["Take screenshot", "Open library", "Quit"],
    }
}

pub fn create(app: &AppHandle, capture_shortcut: Option<&str>) -> tauri::Result<()> {
    // English until the main window reports its language, right after it loaded.
    let [capture_text, library_text, quit_text] = texts("en");
    let capture = MenuItem::with_id(app, "capture", capture_text, true, capture_shortcut)?;
    let library = MenuItem::with_id(app, "library", library_text, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_text, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture, &library, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Screenbook")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => capture::start_in_background(app.clone()),
            "library" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
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
        library,
        quit,
    });
    Ok(())
}

/// Translates the tray menu.
pub fn set_language(menu: &TrayMenu, language: &str) -> tauri::Result<()> {
    let [capture, library, quit] = texts(language);
    menu.capture.set_text(capture)?;
    menu.library.set_text(library)?;
    menu.quit.set_text(quit)
}
