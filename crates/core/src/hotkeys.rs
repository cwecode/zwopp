//! Which capture hotkeys are allowed (ADR 0014). A global hotkey takes its key
//! combination away from every other program, so combinations people rely on
//! everywhere – copy, paste, save, switching windows, the system's own
//! shortcuts – are refused, whatever the user presses.

use serde::Serialize;

/// The system the hotkey is for; `CommandOrControl` is ⌘ on macOS, Ctrl elsewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Macos,
    Linux,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Linux
        }
    }
}

/// Why a combination cannot be the capture hotkey.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reserved {
    /// A key that types (or a function key apps use) without a modifier.
    Typing,
    /// A shortcut nearly every program uses (copy, paste, save, undo …).
    AppShortcut,
    /// A shortcut of the operating system (switch windows, lock, quit …).
    System,
    /// Not a combination Zwopp understands.
    Invalid,
}

#[derive(Default)]
struct Combo<'a> {
    command: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    key: &'a str,
}

fn parse(accelerator: &str) -> Option<Combo<'_>> {
    let mut combo = Combo::default();
    for part in accelerator.split('+').map(str::trim) {
        match part.to_ascii_lowercase().as_str() {
            "commandorcontrol" | "cmdorctrl" | "control" | "ctrl" | "command" | "cmd" => {
                combo.command = true
            }
            "alt" | "option" => combo.alt = true,
            "shift" => combo.shift = true,
            "super" | "meta" | "win" => combo.meta = true,
            _ if combo.key.is_empty() && !part.is_empty() => combo.key = part,
            _ => return None,
        }
    }
    (!combo.key.is_empty()).then_some(combo)
}

/// Keys every program uses with Ctrl (⌘ on macOS) alone.
const APP_KEYS: &[&str] = &[
    "A",
    "C",
    "V",
    "X",
    "Z",
    "Y",
    "S",
    "P",
    "F",
    "N",
    "O",
    "W",
    "T",
    "Q",
    "R",
    "H",
    "M",
    "B",
    "I",
    "U",
    "L",
    "K",
    "E",
    "G",
    "D",
    "J",
    "Tab",
    "Space",
    "Enter",
    "Backspace",
    "Delete",
    "Escape",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Insert",
    "Plus",
    "Minus",
    "Equal",
    "Digit0",
    "0",
];

/// Keys every program uses with Ctrl (⌘) and Shift.
const APP_SHIFT_KEYS: &[&str] = &["Z", "T", "N", "P", "S", "V", "Tab", "Escape", "Delete"];

/// Function keys apps use alone (help, rename, search, refresh, full screen, dev tools).
const FUNCTION_KEYS_IN_USE: &[&str] = &[
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
];

/// Why `accelerator` cannot be the capture hotkey on `os`, or `None` if it can.
pub fn reserved(accelerator: &str, os: Os) -> Option<Reserved> {
    let Some(c) = parse(accelerator) else {
        return Some(Reserved::Invalid);
    };
    let key = c.key;
    let is = |k: &str| key.eq_ignore_ascii_case(k);
    let any = |keys: &[&str]| keys.iter().any(|k| is(k));

    // The Windows key and Super belong to the desktop.
    if c.meta {
        return Some(Reserved::System);
    }
    // Alone or with Shift only, a key types or does its job everywhere;
    // Print and Pause (and F13+) are made for this.
    if !c.command && !c.alt {
        let free = any(&["PrintScreen", "Print", "Pause"])
            || (key.len() > 2
                && key.starts_with('F')
                && !any(FUNCTION_KEYS_IN_USE)
                && key[1..].parse::<u8>().is_ok());
        if !free {
            return Some(Reserved::Typing);
        }
        return None;
    }

    // The system's own combinations.
    let system = match os {
        Os::Windows | Os::Linux => {
            (c.alt && !c.command && any(&["Tab", "Escape", "Space", "F4", "F2"]))
                || (c.command && c.alt && any(&["Delete", "T", "L", "Tab"]))
                || (c.command && !c.alt && any(&["Escape"]))
                || (c.command && c.shift && is("Escape"))
        }
        Os::Macos => {
            (c.command && !c.alt && !c.shift && any(&["Tab", "Space", "Q", "W", "H", "M"]))
                || (c.command
                    && c.shift
                    && any(&[
                        "3", "4", "5", "6", "Digit3", "Digit4", "Digit5", "Digit6", "Q",
                    ]))
                || (c.command && c.alt && any(&["Escape", "D", "Space"]))
        }
    };
    if system {
        return Some(Reserved::System);
    }

    // Shortcuts of nearly every program.
    if c.command && !c.alt && !c.shift && any(APP_KEYS) {
        return Some(Reserved::AppShortcut);
    }
    if c.command && c.shift && !c.alt && any(APP_SHIFT_KEYS) {
        return Some(Reserved::AppShortcut);
    }
    // Alt alone with a letter opens menus on Windows and Linux (Alt+F = File).
    if c.alt && !c.command && !c.shift && os != Os::Macos && key.len() == 1 {
        return Some(Reserved::AppShortcut);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_are_allowed_everywhere() {
        for os in [Os::Windows, Os::Macos, Os::Linux] {
            for hotkey in [
                "CommandOrControl+Shift+X",
                "CommandOrControl+Alt+X",
                "CommandOrControl+Shift+2",
            ] {
                assert_eq!(reserved(hotkey, os), None, "{hotkey} on {os:?}");
            }
        }
        assert_eq!(reserved("PrintScreen", Os::Windows), None);
        assert_eq!(reserved("Shift+PrintScreen", Os::Linux), None);
        assert_eq!(reserved("F13", Os::Windows), None);
    }

    #[test]
    fn everyday_shortcuts_are_refused() {
        for hotkey in [
            "CommandOrControl+C",
            "CommandOrControl+V",
            "CommandOrControl+S",
            "CommandOrControl+Z",
            "CommandOrControl+Shift+Z",
            "CommandOrControl+Shift+T",
        ] {
            assert_eq!(
                reserved(hotkey, Os::Windows),
                Some(Reserved::AppShortcut),
                "{hotkey}"
            );
        }
        assert_eq!(reserved("Alt+F", Os::Windows), Some(Reserved::AppShortcut));
        assert_eq!(reserved("X", Os::Windows), Some(Reserved::Typing));
        assert_eq!(reserved("Shift+X", Os::Windows), Some(Reserved::Typing));
        assert_eq!(reserved("F5", Os::Windows), Some(Reserved::Typing));
    }

    #[test]
    fn system_shortcuts_are_refused() {
        assert_eq!(reserved("Alt+Tab", Os::Windows), Some(Reserved::System));
        assert_eq!(reserved("Alt+F4", Os::Windows), Some(Reserved::System));
        assert_eq!(
            reserved("CommandOrControl+Alt+Delete", Os::Windows),
            Some(Reserved::System)
        );
        assert_eq!(
            reserved("CommandOrControl+Shift+Escape", Os::Windows),
            Some(Reserved::System)
        );
        assert_eq!(
            reserved("Super+Shift+S", Os::Windows),
            Some(Reserved::System)
        );
        assert_eq!(
            reserved("CommandOrControl+Alt+T", Os::Linux),
            Some(Reserved::System)
        );
        assert_eq!(
            reserved("CommandOrControl+Shift+4", Os::Macos),
            Some(Reserved::System)
        );
        assert_eq!(
            reserved("CommandOrControl+Space", Os::Macos),
            Some(Reserved::System)
        );
        assert_eq!(
            reserved("CommandOrControl+Tab", Os::Macos),
            Some(Reserved::System)
        );
    }

    #[test]
    fn nonsense_is_invalid() {
        assert_eq!(reserved("", Os::Windows), Some(Reserved::Invalid));
        assert_eq!(
            reserved("CommandOrControl+X+Y", Os::Windows),
            Some(Reserved::Invalid)
        );
        assert_eq!(reserved("Shift", Os::Windows), Some(Reserved::Invalid));
    }
}
