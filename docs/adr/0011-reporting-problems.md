# ADR 0011: Reporting problems

- Status: accepted
- Date: 2026-11-05

## Context

A bug report is only useful with the version, the system and what went wrong just before.
Most users do not know where to find these, and until now Zwopp wrote its warnings to a
console nobody sees. At the same time a screenshot tool must not send anything on its own:
a library is full of private images.

## Decision

1. **A log file.** Warnings and errors (and a line per start with version and system) go to
   `zwopp.log` in the app's log folder (`tauri-plugin-log`; Windows:
   `%LOCALAPPDATA%\digital.weier.zwopp\logs`). It is started anew beyond 512 KB, keeping the
   previous one. A panic is logged before the app ends.
2. **"Report a problem …"** in the tray menu and the settings opens a page that shows what a
   report would contain: version, operating system, monitors and, if wanted, the last
   40 lines of the log with the home folder replaced by `~` and the user name by `<user>`.
3. **GitHub's issue forms, filled in.** "Report a bug on GitHub" and "Suggest an idea" open
   the forms in `.github/ISSUE_TEMPLATE` in the browser, with fields filled from the URL
   (`?template=bug_report.yml&version=…&os-details=…&logs=…`). The user reviews and edits
   everything there and submits it; Zwopp itself sends nothing and needs no token. The bug
   form asks for steps and, optionally, an idea for a fix. Only issue forms of the Zwopp
   repository can be opened this way (`report::open_issue`).
4. **Without a GitHub account:** "Copy details" puts the same text on the clipboard, and
   "Open the log folder" shows the file.

## Consequences

- Reports arrive with version, system and log in the same place every time.
- Reporting needs a GitHub account; there is no own server and no telemetry.
- The log never contains screenshots or their titles, only what the code logs; new log
  lines must keep it that way.
