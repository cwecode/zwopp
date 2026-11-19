//! Zwopp from the command line and for AI agents (ADR 0012).
//!
//! The app's own executable runs these when it is started with a command
//! (`zwopp capture …`, `zwopp list`), so installing Zwopp is all it takes;
//! without one it starts the app as usual.

mod ops;
mod paths;

use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use zwopp_core::capture::{self, DesktopRect};
use zwopp_core::library::ListQuery;

use crate::ops::Target;

/// The commands; anything else starts the app.
const COMMANDS: &[&str] = &[
    "capture",
    "list",
    "show",
    "export",
    "export-library",
    "windows",
    "monitors",
    "open",
    "help",
    "--help",
    "-h",
    "--version",
    "-V",
];

/// Where the command line runs.
pub struct Context {
    /// A development build, with its own library (ADR 0008).
    pub dev: bool,
    /// The app's executable, to open a screenshot in the editor.
    pub app_exe: Option<PathBuf>,
}

#[derive(Parser)]
#[command(
    name = "zwopp",
    version,
    about = "Zwopp from the command line: capture, find and export screenshots.",
    after_help = "Without a command, Zwopp starts as usual."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Take a screenshot without the overlay and save it to the library.
    Capture {
        /// A monitor by index (see `zwopp monitors`); the primary one by default.
        #[arg(long, value_name = "INDEX", group = "target")]
        screen: Option<usize>,
        /// The topmost window whose title or application contains TEXT.
        #[arg(long, value_name = "TEXT", group = "target")]
        window: Option<String>,
        /// The window that has the keyboard focus.
        #[arg(long, group = "target")]
        focused: bool,
        /// A rectangle in desktop pixels: X,Y,WIDTH,HEIGHT.
        #[arg(long, value_name = "X,Y,W,H", value_parser = parse_rect, group = "target")]
        region: Option<DesktopRect>,
        #[arg(long)]
        title: Option<String>,
        /// A tag; repeat for several.
        #[arg(long = "tag")]
        tags: Vec<String>,
        /// Also save the image to this file (PNG, JPG, WebP by extension).
        #[arg(long, short)]
        out: Option<PathBuf>,
        /// Print the result as JSON.
        #[arg(long)]
        json: bool,
    },
    /// List screenshots in the library, newest first.
    List {
        /// Words in the title or tags.
        #[arg(long, short)]
        search: Option<String>,
        /// Only screenshots taken in this application.
        #[arg(long)]
        app: Option<String>,
        #[arg(long)]
        favorites: bool,
        #[arg(long, short = 'n', default_value_t = 20)]
        limit: u32,
        #[arg(long)]
        json: bool,
    },
    /// Show one screenshot's details.
    Show {
        id: String,
        #[arg(long)]
        json: bool,
    },
    /// Save a screenshot as a file (PNG, JPG, WebP or GIF by extension).
    Export { id: String, file: PathBuf },
    /// Export the whole library into a new folder in DIR: images with readable names
    /// and XMP metadata, screenshots.json, screenshots.csv and a README.
    ExportLibrary {
        dir: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// List the visible windows, topmost first.
    Windows {
        #[arg(long)]
        json: bool,
    },
    /// List the monitors.
    Monitors {
        #[arg(long)]
        json: bool,
    },
    /// Open a screenshot in the Zwopp editor.
    Open { id: String },
}

/// Runs a command if `args` (with the program name first) has one; `None`
/// means "start the app".
pub fn run_if_command(args: Vec<OsString>, context: &Context) -> Option<i32> {
    let first = args.get(1)?.to_str()?;
    if !COMMANDS.contains(&first) {
        return None;
    }
    attach_console();
    let cli = match Cli::try_parse_from(&args) {
        Ok(cli) => cli,
        Err(e) => {
            let _ = e.print();
            return Some(if e.use_stderr() { 2 } else { 0 });
        }
    };
    Some(match run(cli.command, context) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("zwopp: {e}");
            1
        }
    })
}

fn run(command: Command, context: &Context) -> Result<(), String> {
    match command {
        Command::Capture {
            screen,
            window,
            focused,
            region,
            title,
            tags,
            out,
            json,
        } => {
            let target = match (window, focused, region) {
                (Some(window), _, _) => Target::Window(window),
                (_, true, _) => Target::Focused,
                (_, _, Some(rect)) => Target::Region(rect),
                _ => Target::Screen(screen),
            };
            let library = paths::open_library(context.dev)?;
            let item = ops::capture(&library, &target, title, tags)?;
            if let Some(out) = out {
                ops::export(&library, &item.id.to_string(), &out)?;
            }
            if json {
                print_json(&item);
            } else {
                println!(
                    "{}  {}×{}  {}",
                    item.id,
                    item.width,
                    item.height,
                    item.file.display()
                );
            }
        }
        Command::List {
            search,
            app,
            favorites,
            limit,
            json,
        } => {
            let library = paths::open_library(context.dev)?;
            let query = ListQuery {
                search,
                app,
                favorites_only: favorites,
                ..ListQuery::default()
            };
            let items = ops::list(&library, &query, limit)?;
            if json {
                print_json(&items);
            } else {
                for item in items {
                    println!(
                        "{}  {}  {:>5}×{:<5}  {:<16}  {}",
                        item.id,
                        item.created_at[..16].replace('T', " "),
                        item.width,
                        item.height,
                        item.app.unwrap_or_default(),
                        item.title
                    );
                }
            }
        }
        Command::Show { id, json } => {
            let item = ops::get(&paths::open_library(context.dev)?, &id)?;
            if json {
                print_json(&item);
            } else {
                println!("{:#?}", item);
            }
        }
        Command::Export { id, file } => {
            let written = ops::export(&paths::open_library(context.dev)?, &id, &file)?;
            println!("{}", written.display());
        }
        Command::ExportLibrary { dir, json } => {
            let library = paths::open_library(context.dev)?;
            let export = ops::export_library(&library, &dir, |done, total| {
                if !json && (done % 100 == 0 || done == total) {
                    eprint!("\r{done}/{total}");
                }
            })?;
            if json {
                print_json(&export);
            } else {
                eprintln!();
                println!("{} screenshots → {}", export.count, export.dir.display());
            }
        }
        Command::Windows { json } => {
            let windows = capture::list_windows().map_err(ops::err)?;
            if json {
                print_json(&windows);
            } else {
                for w in windows {
                    let focus = if w.focused { "*" } else { " " };
                    println!(
                        "{focus} {:<20}  {}  ({},{} {}×{})",
                        w.app.unwrap_or_default(),
                        w.title,
                        w.rect.x,
                        w.rect.y,
                        w.rect.width,
                        w.rect.height
                    );
                }
            }
        }
        Command::Monitors { json } => {
            let monitors = capture::monitors().map_err(ops::err)?;
            if json {
                print_json(&monitors);
            } else {
                for (index, m) in monitors.iter().enumerate() {
                    let primary = if m.is_primary { " (primary)" } else { "" };
                    println!(
                        "{index}  {}  {},{} {}×{}{primary}",
                        m.name, m.x, m.y, m.width, m.height
                    );
                }
            }
        }
        Command::Open { id } => {
            ops::get(&paths::open_library(context.dev)?, &id)?;
            let exe = context
                .app_exe
                .as_ref()
                .ok_or("the Zwopp app is not available here")?;
            std::process::Command::new(exe)
                .args(["--open", &id])
                .spawn()
                .map_err(ops::err)?;
        }
    }
    Ok(())
}

fn parse_rect(text: &str) -> Result<DesktopRect, String> {
    let parts: Vec<i64> = text
        .split(',')
        .map(|part| part.trim().parse::<i64>())
        .collect::<Result<_, _>>()
        .map_err(|_| "expected X,Y,WIDTH,HEIGHT, e.g. 0,0,800,600".to_owned())?;
    match parts[..] {
        [x, y, width, height] if width > 0 && height > 0 => Ok(DesktopRect {
            x: x as i32,
            y: y as i32,
            width: width as u32,
            height: height as u32,
        }),
        _ => Err("expected X,Y,WIDTH,HEIGHT with a positive size".into()),
    }
}

fn print_json(value: &impl serde::Serialize) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

/// The app is a GUI program on Windows, without a console of its own; a
/// command started from a terminal writes to that terminal. Output that is
/// already redirected (a script, an agent reading a pipe) stays where it goes.
#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::System::Console::{
        ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE,
    };
    // SAFETY: GetStdHandle only reads this process's standard handle;
    // AttachConsole only attaches it to its parent's console, if any.
    unsafe {
        let stdout = GetStdHandle(STD_OUTPUT_HANDLE);
        if stdout.is_null() || stdout == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(windows))]
fn attach_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn only_commands_are_taken() {
        let context = Context {
            dev: true,
            app_exe: None,
        };
        assert_eq!(run_if_command(args(&["zwopp"]), &context), None);
        assert_eq!(
            run_if_command(args(&["zwopp", "--autostart"]), &context),
            None
        );
        assert_eq!(
            run_if_command(args(&["zwopp", "--open", "x"]), &context),
            None
        );
        assert_eq!(
            run_if_command(args(&["zwopp", "--version"]), &context),
            Some(0)
        );
        assert_eq!(
            run_if_command(args(&["zwopp", "capture", "--nonsense"]), &context),
            Some(2)
        );
    }

    #[test]
    fn regions_are_parsed() {
        assert_eq!(
            parse_rect("-1920, 0, 800,600"),
            Ok(DesktopRect {
                x: -1920,
                y: 0,
                width: 800,
                height: 600
            })
        );
        assert!(parse_rect("0,0,0,10").is_err());
        assert!(parse_rect("1,2,3").is_err());
    }
}
