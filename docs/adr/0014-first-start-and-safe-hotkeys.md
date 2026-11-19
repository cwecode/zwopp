# ADR 0014: First start and safe hotkeys

- Status: accepted
- Date: 2026-11-19

## Context

A new user should pick the language and the capture hotkey before the first capture, not
find them later in the settings. Anyone can press any combination, so a careless choice
could take over keys people rely on: plain letters while typing, Ctrl+C/V/S/Z, Alt+Tab,
or system keys. One takeover is wanted, though: Print, which Windows hands to the
Snipping Tool, should start Zwopp instead.

The installers (NSIS, MSI, DMG, AppImage, deb, rpm) cannot share one setup page, and
their own pages would exist on one system only.

## Decision

1. **The setup runs in the app**, on the first start, on every system: three steps
   (language, hotkey, ready with *Start at login*). Skip is always possible; the defaults
   then apply. It is marked done in the settings (`setupDone`); someone updating with
   screenshots in the library does not see it.
2. **Reserved hotkeys are refused** (`zwopp_core::hotkeys::reserved`, per system), both in
   the picker and when saving the settings, and a reserved one in an old settings file
   falls back to the default:
   - *typing*: no Ctrl/⌘ or Alt, except function keys F13+, Print and Pause;
   - *app shortcuts*: Ctrl/⌘ with copy, paste, save, undo, find, print, new, open,
     close, tabs and the like; Alt+letter (menus on Windows/Linux);
   - *system*: the Windows/Super key, Alt+Tab/F4/Space, Ctrl+Alt+Delete, Ctrl+Shift+Esc,
     ⌘Tab/Space/Q, ⌘⇧3–6 and the like.
   The picker names the reason.
3. **Print on Windows:** the picker offers to take over Print from the Snipping Tool. It
   switches `HKCU\Control Panel\Keyboard\PrintScreenKeyForSnippingEnabled` off (the
   same switch as Windows' own setting) and sets Print as Zwopp's hotkey; *give back*
   switches it on again. Only the user's own setting is touched; no admin rights.
4. **Win+Shift+S stays Windows'.** The system keeps it for itself; no app can register
   it. macOS (⌘⇧3–5) and the Linux desktops keep their screenshot keys too.

## Consequences

- The defaults (Ctrl+Shift+X, …) are allowed; a typo-prone or harmful choice is not.
- Windows may need a moment, or a new sign-in, before Print stops opening the Snipping
  Tool.
- New system or app shortcuts need a line in `hotkeys.rs`; an uncommon app's shortcut is
  not known and only shows up as "already in use".
