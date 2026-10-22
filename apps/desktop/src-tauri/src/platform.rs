//! Small OS-specific tweaks that Tauri does not expose.

use tauri::WebviewWindow;

/// Makes `hide()` take effect immediately.
///
/// Windows fades windows out over ~200 ms; a capture taken during the fade
/// contains a translucent ghost of our own window.
#[cfg(windows)]
pub fn disable_hide_animation(window: &WebviewWindow) {
    use windows_sys::Win32::Foundation::TRUE;
    use windows_sys::Win32::Graphics::Dwm::{
        DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute,
    };

    let Ok(hwnd) = window.hwnd() else { return };
    let disabled = TRUE;
    // SAFETY: `hwnd` is a live window handle owned by Tauri and the attribute
    // value is a BOOL, as DWMWA_TRANSITIONS_FORCEDISABLED requires.
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_TRANSITIONS_FORCEDISABLED as u32,
            (&raw const disabled).cast(),
            size_of_val(&disabled) as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn disable_hide_animation(_window: &WebviewWindow) {}
