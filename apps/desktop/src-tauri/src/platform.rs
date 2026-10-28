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

/// Leaves the window out of screen captures (`true`) while it stays visible
/// to the user, or puts it back (`false`); Windows 10 2004 and later. Returns
/// false where that is not possible: the window then has to be hidden.
///
/// Only for the moment of our own capture, since it also hides the window
/// from screen sharing and other screenshot tools. Hiding is what it avoids:
/// a hidden WebView2 is throttled and took about a second to wake up and
/// open the editor after a capture.
#[cfg(windows)]
pub fn exclude_from_capture(window: &WebviewWindow, exclude: bool) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let affinity = if exclude {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    // SAFETY: `hwnd` is a live top-level window owned by this process, as
    // SetWindowDisplayAffinity requires.
    unsafe { SetWindowDisplayAffinity(hwnd.0, affinity) != 0 }
}

#[cfg(not(windows))]
pub fn exclude_from_capture(_window: &WebviewWindow, _exclude: bool) -> bool {
    false
}
