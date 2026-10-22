use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::{CAPTURE_SHORTCUT, capture, show_main};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let capture = MenuItem::with_id(
        app,
        "capture",
        "Screenshot aufnehmen",
        true,
        Some(CAPTURE_SHORTCUT),
    )?;
    let library = MenuItem::with_id(app, "library", "Bibliothek öffnen", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
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
    Ok(())
}
