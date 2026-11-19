//! Connecting AI agents and the terminal (ADR 0012): the Claude Code skill,
//! installed with the path of this executable, and the command that makes
//! `zwopp` a terminal command on each system. Nothing here is specific to
//! one system: agents get the full path, so no one depends on the PATH.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// The skill as published in the repository (`skills/zwopp`).
const SKILL: &str = include_str!("../../../../skills/zwopp/SKILL.md");
const REFERENCE: &str = include_str!("../../../../skills/zwopp/reference.md");
/// Where the skill's instructions start, after its front matter.
const FIND_SECTION: &str = "## Find the executable";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSetup {
    /// False in a development build: it would point agents at itself.
    available: bool,
    /// The executable agents and scripts run.
    executable: String,
    /// Where the skill goes for Claude Code (all projects).
    skill_dir: Option<String>,
    skill_installed: bool,
    /// A command for the user's terminal that makes `zwopp` available there;
    /// `None` where it already is (Linux packages install it to /usr/bin).
    terminal_setup: Option<String>,
}

pub fn setup() -> AgentSetup {
    let executable = executable();
    let skill_dir = skill_dir();
    AgentSetup {
        available: !tauri::is_dev(),
        terminal_setup: terminal_setup(&executable),
        executable: executable.to_string_lossy().into_owned(),
        skill_installed: skill_dir
            .as_ref()
            .is_some_and(|dir| dir.join("SKILL.md").is_file()),
        skill_dir: skill_dir.map(|dir| dir.to_string_lossy().into_owned()),
    }
}

/// Installs the skill for Claude Code, telling it where this executable is.
pub fn install_skill() -> Result<(), String> {
    if tauri::is_dev() {
        return Err("a development build does not install the skill".into());
    }
    let dir = skill_dir().ok_or("no home folder")?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    std::fs::write(dir.join("SKILL.md"), skill_for(&executable())).map_err(err)?;
    std::fs::write(dir.join("reference.md"), REFERENCE).map_err(err)
}

pub fn remove_skill() -> Result<(), String> {
    let dir = skill_dir().ok_or("no home folder")?;
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

/// The skill with this computer's path to Zwopp, so the agent need not search.
fn skill_for(executable: &Path) -> String {
    let note = format!(
        "On this computer Zwopp is `{}` (written by Zwopp when it installed this skill).\n\n",
        executable.display()
    );
    SKILL.replacen(FIND_SECTION, &format!("{FIND_SECTION}\n\n{note}"), 1)
}

/// The command that makes `zwopp` available in new terminals, as the user
/// would type it on this system (VS Code and others offer the same).
fn terminal_setup(executable: &Path) -> Option<String> {
    let exe = executable.display();
    if cfg!(windows) {
        let dir = executable.parent()?.display().to_string();
        // Appends the folder to the user's PATH (not the system's) once.
        Some(format!(
            "$dir = \"{dir}\"; $p = [Environment]::GetEnvironmentVariable(\"Path\", \"User\"); \
             if (\";$p;\" -notlike \"*;$dir;*\") {{ [Environment]::SetEnvironmentVariable(\"Path\", \
             (\"$p;$dir\").TrimStart(\";\"), \"User\") }}"
        ))
    } else if cfg!(target_os = "macos") {
        Some(format!("sudo ln -sf \"{exe}\" /usr/local/bin/zwopp"))
    } else if executable.starts_with("/usr/bin") || executable.starts_with("/usr/local/bin") {
        None
    } else {
        Some(format!(
            "mkdir -p ~/.local/bin && ln -sf \"{exe}\" ~/.local/bin/zwopp"
        ))
    }
}

/// This program as the user starts it. An AppImage runs from a temporary
/// mount; the AppImage file itself is what stays.
fn executable() -> PathBuf {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return PathBuf::from(appimage);
    }
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("zwopp"))
}

/// Claude Code's personal skills: `~/.claude/skills/zwopp`.
fn skill_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("skills").join("zwopp"))
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_installed_skill_names_this_executable() {
        let skill = skill_for(Path::new("/opt/Zwopp/zwopp"));
        assert!(skill.starts_with("---") && skill.contains("name: zwopp"));
        let find = skill.find(FIND_SECTION).unwrap();
        let note = skill.find("`/opt/Zwopp/zwopp`").unwrap();
        assert!(note > find);
        assert!(skill.contains("zwopp capture"));
    }

    #[test]
    fn terminal_setup_fits_the_system() {
        if cfg!(windows) {
            let setup =
                terminal_setup(Path::new(r"C:\Users\max\AppData\Local\Zwopp\zwopp.exe")).unwrap();
            assert!(setup.contains(r#"$dir = "C:\Users\max\AppData\Local\Zwopp""#));
            assert!(setup.contains("\"User\""));
        } else if cfg!(target_os = "macos") {
            let setup =
                terminal_setup(Path::new("/Applications/Zwopp.app/Contents/MacOS/zwopp")).unwrap();
            assert!(setup.ends_with("/usr/local/bin/zwopp"));
        } else {
            assert_eq!(terminal_setup(Path::new("/usr/bin/zwopp")), None);
            assert!(
                terminal_setup(Path::new("/home/max/Zwopp.AppImage"))
                    .unwrap()
                    .contains("~/.local/bin")
            );
        }
    }
}
