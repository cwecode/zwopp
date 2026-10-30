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

/// Edge length of application icons, in pixels.
pub const APP_ICON_SIZE: u32 = 48;

/// The icon of the program that runs process `pid`, APP_ICON_SIZE square.
/// Elsewhere than on Windows there is none yet; the library then shows the
/// application's initial.
#[cfg(windows)]
pub fn app_icon(pid: u32) -> Option<image::RgbaImage> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, PrivateExtractIconsW};

    let mut path = [0u16; 1024];
    // One less than the buffer, so the path stays NUL-terminated.
    let mut len = path.len() as u32 - 1;
    // SAFETY: the handle is checked and closed; `path` holds `len` u16s.
    let found = unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let found =
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut len);
        CloseHandle(process);
        found != 0
    };
    if !found {
        return None;
    }
    let size = APP_ICON_SIZE as i32;
    let mut icon = null_mut();
    // SAFETY: `path` is NUL-terminated and `icon` receives one handle, which
    // is destroyed below.
    let count =
        unsafe { PrivateExtractIconsW(path.as_ptr(), 0, size, size, &mut icon, null_mut(), 1, 0) };
    if count == 0 || count == u32::MAX || icon.is_null() {
        return None;
    }
    // SAFETY: `icon` is the valid icon handle extracted above.
    let image = unsafe { icon_image(icon) };
    unsafe { DestroyIcon(icon) };
    image
}

#[cfg(not(windows))]
pub fn app_icon(_pid: u32) -> Option<image::RgbaImage> {
    None
}

/// The pixels of an APP_ICON_SIZE icon. Old icons without an alpha channel
/// take their transparency from the mask.
///
/// # Safety
/// `icon` must be a valid icon handle.
#[cfg(windows)]
unsafe fn icon_image(
    icon: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
) -> Option<image::RgbaImage> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
        DeleteObject, GetDIBits, HBITMAP, HDC,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let size = APP_ICON_SIZE;
    // SAFETY (whole block): `info` is filled by GetIconInfo, and its bitmaps
    // are read into buffers of size × size BGRA pixels, then deleted.
    unsafe {
        let mut info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(icon, &mut info) == 0 {
            return None;
        }
        let dc = CreateCompatibleDC(null_mut());
        let read = |bitmap: HBITMAP, dc: HDC| -> Option<Vec<u8>> {
            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size as i32,
                // Negative: rows top to bottom.
                biHeight: -(size as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            };
            let mut pixels = vec![0u8; (size * size * 4) as usize];
            let lines = GetDIBits(
                dc,
                bitmap,
                0,
                size,
                pixels.as_mut_ptr().cast(),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            (lines == size as i32).then_some(pixels)
        };
        let color = (!info.hbmColor.is_null())
            .then(|| read(info.hbmColor, dc))
            .flatten();
        let mask = (!info.hbmMask.is_null())
            .then(|| read(info.hbmMask, dc))
            .flatten();
        DeleteDC(dc);
        DeleteObject(info.hbmColor);
        DeleteObject(info.hbmMask);

        let mut pixels = color?;
        let has_alpha = pixels.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
        for (i, pixel) in pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            pixel.swap(0, 2); // BGRA → RGBA
            if !has_alpha {
                // In the mask, black is opaque and white transparent.
                let opaque = mask.as_ref().is_none_or(|m| m[i * 4] == 0);
                pixel[3] = if opaque { 255 } else { 0 };
            }
        }
        image::RgbaImage::from_raw(size, size, pixels)
    }
}
