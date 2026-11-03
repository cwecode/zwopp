# ADR 0008: Running in the background

- Status: accepted
- Date: 2026-11-03

## Context

A screenshot tool has to be there the moment the hotkey is pressed, so it runs all
day, typically started at login. While it waits it should cost next to nothing: no CPU,
little memory. Most of Zwopp's memory is its webviews; the library window with
thumbnails and the editor is by far the largest.

Developers also run a development build next to the installed app. Until now both used
the same identifier, so the same settings, library, webview data and hotkey; a database
migration in a development build could have made the library unreadable for the
installed version.

## Decision

1. **Start at login, in the tray.** `tauri-plugin-autostart` registers Zwopp with the
   system (Windows: the user's *Run* key, macOS: a launch agent, Linux: an autostart
   entry) with the argument `--autostart`. Started that way, Zwopp opens no window. The
   setting is under *Settings › General* and off by default; the system keeps it, not
   `settings.json`, so turning it off in the task manager shows in Zwopp.
2. **One instance.** `tauri-plugin-single-instance`: starting Zwopp again brings the
   running one to the front.
3. **The main window lives only while it is used** (`main_window.rs`). It is created
   on demand (`create: false` in tauri.conf.json). Closing hides it; after two minutes
   closed it is destroyed, which frees its webview. Reopening within that time is
   instant, later it takes a moment. A view requested meanwhile (the editor after a
   capture, the settings) waits in the backend until the window takes it
   (`take_view`), so a window still loading does not miss it. Quitting is only possible
   from the tray menu; closing the last window never ends the app.
4. **The capture overlays stay loaded**, hidden, so a capture still appears at once. They
   load only their own code (the bundle is split by window), not the library and the
   editor. Hidden, they run no timers.
5. **A development build is a separate app.** When built for `tauri dev` (no
   `custom-protocol` feature) the identifier gets `.dev` and the name becomes
   *Zwopp Dev*. It has its own settings, library, webview data and single-instance lock,
   and it never registers itself to start at login. Both can run at the same time; the
   one started second gets the next free default hotkey.

## Consequences

- While waiting, Zwopp is the Rust process with tray and hotkey plus the hidden
  overlays; it uses no CPU.
- Opening the library after a long pause loads the window anew.
- A development build starts with an empty library; `ZWOPP_LIBRARY_DIR` or the library
  setting points it at test data.
