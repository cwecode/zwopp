use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::{capture, main_window, update};

/// Delays offered for a capture, in seconds.
pub const DELAYS: [u64; 3] = [3, 5, 10];

/// The tray menu entries, kept to translate them when the UI language changes.
pub struct TrayMenu {
    menu: Menu<Wry>,
    capture: MenuItem<Wry>,
    delayed: Submenu<Wry>,
    delays: Vec<MenuItem<Wry>>,
    library: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    /// "Install update …", at the top of the menu while an update is offered.
    update: MenuItem<Wry>,
    /// The version offered, and the current language, to word `update`.
    offered: Mutex<Option<String>>,
    language: Mutex<String>,
}

/// Menu texts in a language ("de" or anything else for English).
struct Texts {
    capture: &'static str,
    delayed: &'static str,
    seconds: fn(u64) -> String,
    library: &'static str,
    settings: &'static str,
    quit: &'static str,
    update: fn(&str) -> String,
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
            update: |v| format!("Update auf {v} installieren"),
        },
        _ => Texts {
            capture: "Take screenshot",
            delayed: "Take screenshot with delay",
            seconds: |s| format!("In {s} seconds"),
            library: "Open library",
            settings: "Settings",
            quit: "Quit",
            update: |v| format!("Install update {v}"),
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
    // Added to the menu only while an update is offered (`offer_update`).
    let update = MenuItem::with_id(app, "update", "", true, None::<&str>)?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(crate::app_name(app))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => capture::start_in_background(app.clone(), Duration::ZERO),
            "library" => main_window::show(app),
            "settings" => main_window::show_view(app, main_window::View::Settings),
            "update" => update::install_in_background(app.clone()),
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
                main_window::show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayMenu {
        menu,
        capture,
        delayed,
        delays,
        library,
        settings,
        quit,
        update,
        offered: Mutex::default(),
        language: Mutex::new("en".into()),
    });
    Ok(())
}

/// Puts "Install update `version`" at the top of the menu (once).
pub fn offer_update(menu: &TrayMenu, version: &str) -> tauri::Result<()> {
    let first_offer = menu
        .offered
        .lock()
        .unwrap()
        .replace(version.to_owned())
        .is_none();
    let language = menu.language.lock().unwrap().clone();
    menu.update.set_text((texts(&language).update)(version))?;
    if first_offer {
        menu.menu.prepend(&menu.update)?;
    }
    Ok(())
}

/// Translates the tray menu.
pub fn set_language(menu: &TrayMenu, language: &str) -> tauri::Result<()> {
    let text = texts(language);
    *menu.language.lock().unwrap() = language.to_owned();
    if let Some(version) = menu.offered.lock().unwrap().as_deref() {
        menu.update.set_text((text.update)(version))?;
    }
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
