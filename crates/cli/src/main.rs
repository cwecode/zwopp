//! `zwopp-cli`: the command line on its own, for development and systems
//! without the app. Installed users run the same commands with the app's
//! executable (`zwopp capture …`).

fn main() {
    let context = zwopp_cli::Context {
        dev: cfg!(debug_assertions),
        app_exe: None,
    };
    let mut args: Vec<_> = std::env::args_os().collect();
    if args.len() < 2 {
        args.push("--help".into());
    }
    std::process::exit(zwopp_cli::run_if_command(args, &context).unwrap_or(2));
}
