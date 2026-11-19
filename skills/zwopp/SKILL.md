---
name: zwopp
description: Takes, finds and shares screenshots with Zwopp, the user's screenshot tool, from the command line. Use when the user asks for a screenshot of the screen, a window or an app, wants a screenshot attached to an issue, pull request or document, or refers to screenshots in their Zwopp library ("the screenshot I took this morning").
---

# Zwopp

Zwopp is the user's screenshot tool. Its executable takes commands: it captures without
any user interaction, and every capture lands in the user's Zwopp library, where they see
it and can annotate it.

## Find the executable

Use the first that works:

1. `zwopp` on the PATH (`zwopp --version`).
2. Windows: `$env:LOCALAPPDATA\Zwopp\zwopp.exe` (PowerShell) or
   `"$LOCALAPPDATA/Zwopp/zwopp.exe"` (bash).
3. macOS: `/Applications/Zwopp.app/Contents/MacOS/zwopp`.
4. Linux: `/usr/bin/zwopp` (deb, rpm), or the AppImage the user downloaded.

If none exists, tell the user Zwopp is not installed (https://github.com/cwecode/zwopp)
instead of guessing.

## Take a screenshot

Prefer the narrowest target, so nothing unrelated or private ends up in the picture:

```bash
zwopp windows --json                                   # pick a window first
zwopp capture --window "Firefox" --title "Login error" --tag bug --out ./login.png --json
zwopp capture --focused --json                         # the active window
zwopp capture --region 0,0,1280,720 --json             # desktop pixels; see `zwopp monitors`
zwopp capture --screen 0 --json                        # a whole monitor: only when asked
```

`--json` prints the screenshot's `id` and its `file`. Look at the image (read the file)
before you use it, to check it shows what was meant: windows can be covered or
minimized.

## Use screenshots

- Attach to an issue, PR or docs: `zwopp export <id> docs/img/login.png` (PNG, JPG, WebP
  or GIF by extension), or `--out` while capturing.
- Find earlier ones: `zwopp list --search "login" --json`, `--app Firefox`, `-n 50`.
- Let the user annotate (arrows, numbers, blur): `zwopp open <id>` opens it in the Zwopp
  editor. Annotations from the command line are not supported.

## Care

- A screenshot shows whatever is on screen. Do not capture a whole monitor unless the
  user asked for it; never capture password managers, banking or private messages.
- Captures stay in the user's library. Say which screenshots you took (title or id).
- Never delete anything; there is no delete command, the user decides in Zwopp.

All commands and options: [reference.md](reference.md).
