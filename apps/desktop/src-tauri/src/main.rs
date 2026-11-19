// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `zwopp capture …`, `zwopp list` and the other commands run without the
    // app (ADR 0012); anything else starts it.
    let context = zwopp_cli::Context {
        dev: tauri::is_dev(),
        // An AppImage runs from a temporary mount; the file itself stays.
        app_exe: std::env::var_os("APPIMAGE")
            .map(Into::into)
            .or_else(|| std::env::current_exe().ok()),
    };
    if let Some(code) = zwopp_cli::run_if_command(std::env::args_os().collect(), &context) {
        std::process::exit(code);
    }
    zwopp_lib::run()
}
