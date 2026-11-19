# ADR 0012: Command line and MCP server

- Status: accepted; the MCP server (points 3, 5 and 6) removed again, see *Update*
- Date: 2026-11-19

## Update (2026-11-19): no MCP server

The MCP server is gone again; agents use the command line, Claude Code through the
skill. Zwopp is meant to stay small, local and easy to check: one way in for agents
is less code to keep secure and current with a changing protocol, and the command line
already does everything the tools did except setting a title or tags afterwards.
Agents without a terminal (Claude Desktop and the like) cannot use Zwopp for now.
`zwopp mcp`, the MCP part of the settings and the dependencies only it needed
(`base64`, `image` in `crates/cli`) were removed in 1.4.1. The text below is the
original decision.

## Context

Screenshots are part of much automated work: a bug report with the broken screen, a
pull request with the new dialog, documentation that stays current. AI agents such as
Claude Code do this work more and more, but cannot press a hotkey and drag a rectangle.
The plan always had a CLI, an HTTP API and an MCP server for v2 (PLAN.md); video tools
such as OpenScreen already ship a CLI and an MCP server.

## Decision

1. **One executable.** `zwopp.exe` (the app's binary on every system) runs a command
   when started with one (`zwopp capture …`, `zwopp list`, `zwopp mcp`); otherwise it
   starts the app. Installing Zwopp is all an agent or script needs, and there is one
   path to configure. On Windows the release build is a GUI program; a command attaches
   to the terminal it was started from (`AttachConsole`), the MCP server uses the pipes
   it is given. A standalone `zwopp-cli` binary (`crates/cli`) serves development and
   systems without the app.
2. **Commands** (`crates/cli`, on `zwopp-core`): `capture` (a monitor, a window by title
   or application, the focused window or a rectangle; without the overlay, saved to the
   library like any capture, optionally also to a file), `list`, `show`, `export`,
   `windows`, `monitors`, `open` (shows a screenshot in the app's editor, via
   `--open <id>` and the single-instance handoff), `mcp`. `--json` everywhere output is
   meant for scripts.
3. **MCP server over stdio** (`zwopp mcp`), written by hand (JSON-RPC 2.0, one message
   per line; `initialize`, `tools/list`, `tools/call`, `ping`) instead of an SDK: eight
   tools with little protocol around them, and no dependency to follow. Tools:
   `take_screenshot`, `list_screenshots`, `get_screenshot` (returns the image, at most
   1568 px, the size models look at closely), `export_screenshot`, `update_screenshot`,
   `list_windows`, `list_monitors`, `open_in_editor`. Nothing deletes.
4. **Same library as the app.** The command line finds it like the app does: the
   `ZWOPP_LIBRARY_DIR` variable, the library folder from `settings.json`, or the default
   in the data folder (`.dev` for a development build, ADR 0008). SQLite in WAL mode lets
   both write; the library refreshes when its window comes back into focus.
5. **A skill for Claude Code, recommended over MCP there.** Agents with a terminal run
   the command line directly; a skill (`skills/zwopp/SKILL.md`, Agent Skills format, with
   `reference.md` loaded only when needed) tells them when and how, and costs context only
   when used, while an MCP server's tool descriptions load into every session. MCP stays
   for agents without a terminal. *Install skill* in the settings writes it to
   `~/.claude/skills/zwopp` with this installation's path, so the agent need not search.
6. **Settings › AI agents and command line** offers both ways side by side, with the real
   path of the executable: the skill, `claude mcp add zwopp -- "<exe>" mcp` and the JSON
   for other clients, and the command that makes `zwopp` a terminal command once, for
   each system (Windows: the user's PATH; macOS: a link in `/usr/local/bin`; Linux: a link
   in `~/.local/bin`, not needed for the packages). Zwopp does not change the PATH itself:
   that would work on one system only, and agents get the full path anyway. An AppImage
   reports its own file (`$APPIMAGE`), not its temporary mount.

## Consequences

- Agents get screenshots with no user interaction. A screenshot can contain anything on
  screen; MCP clients ask the user before a tool runs, and every capture is in the library,
  where the user sees and deletes it.
- Annotating from the command line needs a renderer outside the webview (the editor draws
  with Konva); until then agents hand a screenshot to the user with `open_in_editor`.
- No HTTP API yet: MCP and the command line cover the known uses.
